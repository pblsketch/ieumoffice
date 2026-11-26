import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

struct ReadUriArgs: Decodable {
    let uri: String
}

/// A document and a local file inside the app's own directories (bytes travel through the file).
struct UriPathArgs: Decodable {
    let uri: String
    let path: String
}

struct SharePathArgs: Decodable {
    let path: String
    let suggestedName: String
    let mime: String
}

struct FolderListArgs: Decodable {
    let uri: String
    let subPath: [String]
}

struct NameArgs: Decodable {
    let uri: String
    let newName: String
}

struct UrisArgs: Decodable {
    let uris: [String]
}

struct KeepScreenOnArgs: Decodable {
    let on: Bool
}

struct UrlArgs: Decodable {
    let url: String
}

/// A resolved document location plus the security scope held while using it. For documents
/// under a linked folder the scope is the folder's; otherwise it is the document's own.
private final class ScopedLocation {
    let url: URL
    let root: URL
    let treeBookmark: String?
    let relativePath: String?
    let accessed: Bool

    init(url: URL, root: URL, treeBookmark: String?, relativePath: String?) {
        self.url = url
        self.root = root
        self.treeBookmark = treeBookmark
        self.relativePath = relativePath
        self.accessed = root.startAccessingSecurityScopedResource()
    }

    func stop() {
        if accessed { root.stopAccessingSecurityScopedResource() }
    }
}

/// Retains the folder picker's delegate until the user picks or cancels.
private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
    private let done: (URL?) -> Void

    init(done: @escaping (URL?) -> Void) {
        self.done = done
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        done(urls.first)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        done(nil)
    }
}

/**
 * iOS UIDocumentPicker, security-scoped bookmark, NSFileCoordinator, and UIActivityViewController bridge.
 *
 * Documents under a linked folder are addressed by `ieum-tree:<folder bookmark>#<relative path>`
 * tokens, so one folder bookmark covers every document inside it.
 */
public final class IeumFilePlugin: Plugin {
    private static let treePrefix = "ieum-tree:"

    private var pendingOpenUrls: [[String: Any]] = []
    private let lock = NSLock()
    private var folderPickerDelegate: FolderPickerDelegate?

    public func enqueueIncomingUrl(_ url: URL, openInPlace: Bool) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        let bookmark = try? url.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        let uriToken = bookmark?.base64EncodedString() ?? url.absoluteString
        let entry: [String: Any] = [
            "uri": uriToken,
            "name": url.lastPathComponent,
            "writable": openInPlace && bookmark != nil,
            "ephemeral": !openInPlace || bookmark == nil
        ]
        lock.lock()
        pendingOpenUrls.append(entry)
        lock.unlock()
    }

    @objc public func takePendingOpenIntent(_ invoke: Invoke) {
        lock.lock()
        let next = pendingOpenUrls.isEmpty ? nil : pendingOpenUrls.removeFirst()
        lock.unlock()
        if let next {
            // The Rust side reads the picked file itself, not a wrapper object.
            let payload: JsonObject = next
            invoke.resolve(payload)
        } else {
            invoke.resolve([:])
        }
    }

    /// Received batches (several files or pictures) are Android-only in the first release.
    @objc public func takePendingIncomingBatch(_ invoke: Invoke) {
        invoke.resolve([:])
    }

    @objc public func openPersistentUri(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ReadUriArgs.self)
        guard let location = resolveScoped(args.uri) else {
            invoke.reject("PERMISSION_DENIED: invalid bookmark or URL")
            return
        }
        defer { location.stop() }
        let path = location.url.path
        guard FileManager.default.isReadableFile(atPath: path) else {
            invoke.reject("PERMISSION_DENIED: document is not readable")
            return
        }
        invoke.resolve([
            "uri": args.uri,
            "name": location.url.lastPathComponent,
            "writable": FileManager.default.isWritableFile(atPath: path),
            "ephemeral": false
        ])
    }

    /// A file URL inside the app's Caches or tmp directory, or nil for any other path.
    private func appLocalFile(_ path: String) -> URL? {
        let file = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        let roots = [
            FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
            FileManager.default.temporaryDirectory
        ].compactMap { $0?.standardizedFileURL.resolvingSymlinksInPath().path }
        return roots.contains(where: { file.path.hasPrefix($0 + "/") }) ? file : nil
    }

    /// Copies a document into a local file (replaced if it exists). No size limit: the bytes never
    /// travel as one string argument.
    @objc public func copyUriToFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UriPathArgs.self)
        guard let dest = appLocalFile(args.path) else {
            invoke.reject("INVALID_ARGUMENT: the copy must go into the app's own directories")
            return
        }
        guard let location = resolveScoped(args.uri) else {
            invoke.reject("PERMISSION_DENIED: invalid bookmark or URL")
            return
        }
        defer { location.stop() }
        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: location.url, options: [], error: &coordinatorError) { coordinatedUrl in
            do {
                try FileManager.default.createDirectory(
                    at: dest.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                if FileManager.default.fileExists(atPath: dest.path) {
                    try FileManager.default.removeItem(at: dest)
                }
                try FileManager.default.copyItem(at: coordinatedUrl, to: dest)
            } catch {
                copyError = error
            }
        }
        if let err = coordinatorError ?? copyError {
            invoke.reject("PERMISSION_DENIED: \(err.localizedDescription)")
            return
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?
            .int64Value ?? 0
        invoke.resolve(["size": size])
    }

    /// Writes a local file over a document. The write itself is atomic here (temporary file, then
    /// replace); the Rust side also keeps a copy of the original and checks the result.
    @objc public func writeUriFromFile(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UriPathArgs.self)
        guard let src = appLocalFile(args.path) else {
            invoke.reject("INVALID_ARGUMENT: the source must be in the app's own directories")
            return
        }
        guard let location = resolveScoped(args.uri) else {
            invoke.reject("INVALID_ARGUMENT: invalid bookmark or URL")
            return
        }
        defer { location.stop() }
        let data: Data
        do {
            data = try Data(contentsOf: src, options: .mappedIfSafe)
        } catch {
            invoke.reject("INTERNAL_ERROR: \(error.localizedDescription)")
            return
        }
        var coordinatorError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: location.url, options: .forReplacing, error: &coordinatorError) { coordinatedUrl in
            do {
                try data.write(to: coordinatedUrl, options: .atomic)
            } catch {
                writeError = error
            }
        }
        if let err = coordinatorError ?? writeError {
            invoke.reject("READ_ONLY_URI: \(err.localizedDescription)")
            return
        }
        invoke.resolve(["size": data.count])
    }

    /// Shares one file the Rust side wrote into the share-out directory.
    @objc public func shareFileFromPath(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SharePathArgs.self)
        guard let file = appLocalFile(args.path), FileManager.default.fileExists(atPath: file.path) else {
            invoke.reject("INVALID_ARGUMENT: nothing to share at this location")
            return
        }
        presentShareSheet(items: [file], invoke: invoke)
    }

    @objc public func pickFolder(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("INTERNAL_ERROR: missing presenter")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.allowsMultipleSelection = false
            let delegate = FolderPickerDelegate { [weak self] url in
                self?.folderPickerDelegate = nil
                guard let url else {
                    invoke.reject("USER_CANCELLED: user cancelled folder picker")
                    return
                }
                let accessed = url.startAccessingSecurityScopedResource()
                defer {
                    if accessed { url.stopAccessingSecurityScopedResource() }
                }
                do {
                    let bookmark = try url.bookmarkData(
                        options: [],
                        includingResourceValuesForKeys: nil,
                        relativeTo: nil
                    )
                    invoke.resolve([
                        "uri": bookmark.base64EncodedString(),
                        "name": url.lastPathComponent
                    ])
                } catch {
                    invoke.reject("PERMISSION_DENIED: \(error.localizedDescription)")
                }
            }
            self.folderPickerDelegate = delegate
            picker.delegate = delegate
            presenter.present(picker, animated: true)
        }
    }

    /// The bookmark lives only in the app's own storage; dropping it there is enough.
    @objc public func releaseFolder(_ invoke: Invoke) {
        invoke.resolve(["ok": true])
    }

    @objc public func checkFolderGrant(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ReadUriArgs.self)
        guard let root = resolveBookmark(args.uri) else {
            invoke.resolve(["state": "missing"])
            return
        }
        let accessed = root.startAccessingSecurityScopedResource()
        defer {
            if accessed { root.stopAccessingSecurityScopedResource() }
        }
        if !accessed {
            invoke.resolve(["state": "revoked"])
            return
        }
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir)
        invoke.resolve(["state": exists && isDir.boolValue ? "alive" : "missing"])
    }

    @objc public func listFolder(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FolderListArgs.self)
        guard let root = resolveBookmark(args.uri) else {
            invoke.reject("PERMISSION_DENIED: folder missing")
            return
        }
        let accessed = root.startAccessingSecurityScopedResource()
        defer {
            if accessed { root.stopAccessingSecurityScopedResource() }
        }
        if !accessed {
            invoke.reject("PERMISSION_DENIED: folder grant lost")
            return
        }
        var dir = root
        for name in args.subPath {
            guard isValidName(name) else {
                invoke.reject("NOT_FOUND: invalid sub folder name")
                return
            }
            dir = dir.appendingPathComponent(name, isDirectory: true)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else {
                invoke.reject("NOT_FOUND: sub folder missing")
                return
            }
        }
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: keys,
                options: [.skipsHiddenFiles]
            )
        } catch {
            invoke.reject("PERMISSION_DENIED: \(error.localizedDescription)")
            return
        }
        var entries: [[String: Any]] = []
        for item in contents {
            let values = try? item.resourceValues(forKeys: Set(keys))
            let isDir = values?.isDirectory ?? false
            let name = item.lastPathComponent
            let relative = (args.subPath + [name]).joined(separator: "/")
            var entry: [String: Any] = [
                "uri": treeToken(bookmark: args.uri, relativePath: relative),
                "name": name,
                "isDir": isDir
            ]
            if !isDir {
                if let mime = UTType(filenameExtension: item.pathExtension)?.preferredMIMEType {
                    entry["mime"] = mime
                }
                if let size = values?.fileSize {
                    entry["sizeBytes"] = size
                }
            }
            if let modified = values?.contentModificationDate {
                entry["modifiedMs"] = Int64(modified.timeIntervalSince1970 * 1000)
            }
            entries.append(entry)
        }
        invoke.resolve(["entries": entries])
    }

    @objc public func renameDocument(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(NameArgs.self)
        guard isValidName(args.newName) else {
            invoke.reject("INVALID_ARGUMENT: invalid document name")
            return
        }
        guard let location = resolveHomeDocument(args.uri, invoke: invoke) else { return }
        defer { location.stop() }
        let parent = location.url.deletingLastPathComponent()
        if nameTaken(in: parent, name: args.newName, except: location.url.lastPathComponent) {
            invoke.reject("NAME_TAKEN: name already used in this folder")
            return
        }
        let destination = parent.appendingPathComponent(args.newName)
        var coordinatorError: NSError?
        var moveError: Error?
        let coordinator = NSFileCoordinator()
        coordinator.coordinate(
            writingItemAt: location.url,
            options: .forMoving,
            writingItemAt: destination,
            options: .forReplacing,
            error: &coordinatorError
        ) { source, target in
            do {
                coordinator.item(at: source, willMoveTo: target)
                try FileManager.default.moveItem(at: source, to: target)
                coordinator.item(at: source, didMoveTo: target)
            } catch {
                moveError = error
            }
        }
        if let err = coordinatorError ?? moveError {
            invoke.reject(homeFailure(err))
            return
        }
        invoke.resolve(["uri": siblingToken(location, name: args.newName)])
    }

    @objc public func copyDocument(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(NameArgs.self)
        guard isValidName(args.newName) else {
            invoke.reject("INVALID_ARGUMENT: invalid document name")
            return
        }
        guard let location = resolveHomeDocument(args.uri, invoke: invoke) else { return }
        defer { location.stop() }
        let parent = location.url.deletingLastPathComponent()
        if nameTaken(in: parent, name: args.newName, except: nil) {
            invoke.reject("NAME_TAKEN: name already used in this folder")
            return
        }
        let destination = parent.appendingPathComponent(args.newName)
        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(
            readingItemAt: location.url,
            options: [],
            writingItemAt: destination,
            options: .forReplacing,
            error: &coordinatorError
        ) { source, target in
            do {
                try FileManager.default.copyItem(at: source, to: target)
            } catch {
                copyError = error
            }
        }
        if let err = coordinatorError ?? copyError {
            invoke.reject(homeFailure(err))
            return
        }
        invoke.resolve(["uri": siblingToken(location, name: args.newName)])
    }

    @objc public func deleteDocument(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ReadUriArgs.self)
        guard let location = resolveHomeDocument(args.uri, invoke: invoke) else { return }
        defer { location.stop() }
        var coordinatorError: NSError?
        var trashError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: location.url,
            options: .forDeleting,
            error: &coordinatorError
        ) { target in
            do {
                try FileManager.default.trashItem(at: target, resultingItemURL: nil)
            } catch {
                trashError = error
            }
        }
        if let err = coordinatorError ?? trashError {
            invoke.reject(homeFailure(err))
            return
        }
        invoke.resolve(["ok": true])
    }

    @objc public func shareFiles(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UrisArgs.self)
        guard !args.uris.isEmpty else {
            invoke.reject("INVALID_ARGUMENT: nothing to share")
            return
        }
        let batchDir = shareTempDirectory().appendingPathComponent(UUID().uuidString, isDirectory: true)
        var items: [URL] = []
        do {
            for (index, raw) in args.uris.enumerated() {
                let dir = batchDir.appendingPathComponent(String(index), isDirectory: true)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                if raw.hasPrefix("/") {
                    // A received file copied into the app's own storage.
                    let source = URL(fileURLWithPath: raw)
                    guard isInsideAppTemp(source), FileManager.default.fileExists(atPath: source.path) else {
                        invoke.reject("NOT_FOUND: nothing to share at this location")
                        return
                    }
                    let target = dir.appendingPathComponent(safeFileName(source.lastPathComponent))
                    try FileManager.default.copyItem(at: source, to: target)
                    items.append(target)
                    continue
                }
                guard let location = resolveScoped(raw) else {
                    invoke.reject("NOT_FOUND: nothing to share at this location")
                    return
                }
                defer { location.stop() }
                let target = dir.appendingPathComponent(safeFileName(location.url.lastPathComponent))
                var coordinatorError: NSError?
                var copyError: Error?
                NSFileCoordinator().coordinate(readingItemAt: location.url, options: [], error: &coordinatorError) { source in
                    do {
                        try FileManager.default.copyItem(at: source, to: target)
                    } catch {
                        copyError = error
                    }
                }
                if let err = coordinatorError ?? copyError {
                    throw err
                }
                items.append(target)
            }
        } catch {
            invoke.reject(homeFailure(error))
            return
        }
        presentShareSheet(items: items, invoke: invoke)
    }

    @objc public func setKeepScreenOn(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(KeepScreenOnArgs.self)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = args.on
            invoke.resolve(["ok": true])
        }
    }

    @objc public func openExternalUrl(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(UrlArgs.self)
        guard isOpenableExternalUrl(args.url), let url = URL(string: args.url) else {
            invoke.reject("INVALID_ARGUMENT: only http, https, and mailto URLs are opened")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    invoke.resolve(["ok": true])
                } else {
                    invoke.reject("NOT_SUPPORTED: no app can open the URL")
                }
            }
        }
    }

    @objc public func getNativeDirs(_ invoke: Invoke) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        invoke.resolve([
            "cacheDir": caches.path,
            "shareTempDir": shareTempDirectory().path
        ])
    }

    // MARK: - Helpers

    private func shareTempDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("share-out", isDirectory: true)
    }

    private func presentShareSheet(items: [URL], invoke: Invoke) {
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("INTERNAL_ERROR: missing presenter")
                return
            }
            let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let popover = controller.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1
                )
            }
            presenter.present(controller, animated: true) {
                invoke.resolve(["ok": true])
            }
        }
    }

    private func treeToken(bookmark: String, relativePath: String) -> String {
        let encoded = relativePath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? relativePath
        return "\(Self.treePrefix)\(bookmark)#\(encoded)"
    }

    /// The token of `name` next to a document under a linked folder.
    private func siblingToken(_ location: ScopedLocation, name: String) -> String {
        var parts = (location.relativePath ?? "").split(separator: "/").map(String.init)
        if !parts.isEmpty { parts.removeLast() }
        parts.append(name)
        return treeToken(bookmark: location.treeBookmark ?? "", relativePath: parts.joined(separator: "/"))
    }

    private func resolveBookmark(_ base64: String) -> URL? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        var stale = false
        return try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
    }

    /// Resolves a token and starts its security scope; callers must call `stop()`.
    private func resolveScoped(_ token: String) -> ScopedLocation? {
        if token.hasPrefix(Self.treePrefix) {
            let body = token.dropFirst(Self.treePrefix.count)
            guard let hash = body.firstIndex(of: "#") else { return nil }
            let bookmark = String(body[..<hash])
            let encoded = String(body[body.index(after: hash)...])
            let relative = encoded.removingPercentEncoding ?? encoded
            guard let root = resolveBookmark(bookmark) else { return nil }
            let child = root.appendingPathComponent(relative)
            // Refuse paths that climb out of the linked folder.
            let rootPath = root.standardizedFileURL.path
            let childPath = child.standardizedFileURL.path
            guard childPath.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/") else { return nil }
            return ScopedLocation(url: child, root: root, treeBookmark: bookmark, relativePath: relative)
        }
        guard let url = resolveUrl(from: token) else { return nil }
        return ScopedLocation(url: url, root: url, treeBookmark: nil, relativePath: nil)
    }

    /// Resolves a document under a linked folder for rename/copy/delete, or rejects the invoke
    /// (`NOT_SUPPORTED` outside linked folders, `PERMISSION_DENIED` when the folder grant is
    /// gone, `NOT_FOUND` when the document is gone) and returns nil.
    private func resolveHomeDocument(_ token: String, invoke: Invoke) -> ScopedLocation? {
        guard token.hasPrefix(Self.treePrefix) else {
            invoke.reject("NOT_SUPPORTED: document is not under a linked folder")
            return nil
        }
        guard let location = resolveScoped(token) else {
            invoke.reject("PERMISSION_DENIED: folder missing")
            return nil
        }
        if !location.accessed {
            location.stop()
            invoke.reject("PERMISSION_DENIED: folder grant lost")
            return nil
        }
        guard FileManager.default.fileExists(atPath: location.url.path) else {
            location.stop()
            invoke.reject("NOT_FOUND: document missing")
            return nil
        }
        return location
    }

    private func nameTaken(in folder: URL, name: String, except: String?) -> Bool {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.contains { existing in
            existing != except && existing.caseInsensitiveCompare(name) == .orderedSame
        }
    }

    private func isValidName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed != "." && trimmed != ".." &&
            !name.contains("/") && !name.contains("\\") &&
            name.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
    }

    private func safeFileName(_ raw: String) -> String {
        let cleaned = String(raw.unicodeScalars.map { scalar -> Character in
            if scalar == "/" || scalar == "\\" || CharacterSet.controlCharacters.contains(scalar) {
                return "_"
            }
            return Character(scalar)
        }).trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "file" : cleaned
    }

    /// True for files inside the app's Caches or temporary directory.
    private func isInsideAppTemp(_ url: URL) -> Bool {
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        var roots = [FileManager.default.temporaryDirectory]
        if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            roots.append(caches)
        }
        return roots.contains { root in
            let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
            return path.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/")
        }
    }

    private func isOpenableExternalUrl(_ raw: String) -> Bool {
        if raw.unicodeScalars.contains(where: {
            CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
        }) {
            return false
        }
        guard let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased() else {
            return false
        }
        switch scheme {
        case "https", "http":
            guard let host = components.host, !host.isEmpty,
                  components.user == nil, components.password == nil else {
                return false
            }
            return true
        case "mailto":
            return !components.path.isEmpty
        default:
            return false
        }
    }

    private func homeFailure(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain {
            switch ns.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError:
                return "NOT_FOUND: \(ns.localizedDescription)"
            case NSFileWriteFileExistsError:
                return "NAME_TAKEN: \(ns.localizedDescription)"
            case NSFeatureUnsupportedError, NSFileWriteVolumeReadOnlyError,
                 NSFileReadNoPermissionError, NSFileWriteNoPermissionError:
                return "NOT_SUPPORTED: \(ns.localizedDescription)"
            default:
                break
            }
        }
        return "INTERNAL_ERROR: \(ns.localizedDescription)"
    }

    private func resolveUrl(from token: String) -> URL? {
        if let bookmarkData = Data(base64Encoded: token) {
            var stale = false
            if let url = try? URL(
                resolvingBookmarkData: bookmarkData,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ) {
                return url
            }
        }
        return URL(string: token)
    }
}

@_cdecl("init_plugin_ieum_file")
func initPluginIeumFile() -> Plugin {
    return IeumFilePlugin()
}
