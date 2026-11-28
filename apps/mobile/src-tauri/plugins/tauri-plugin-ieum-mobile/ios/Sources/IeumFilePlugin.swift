import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

struct ReadUriArgs: Decodable {
    let uri: String
}

struct WriteUriArgs: Decodable {
    let uri: String
    let bytesBase64: String
}

struct ShareFileArgs: Decodable {
    let suggestedName: String
    let mime: String
    let bytesBase64: String
}

/**
 * iOS UIDocumentPicker, security-scoped bookmark, NSFileCoordinator, and UIActivityViewController bridge.
 */
public final class IeumFilePlugin: Plugin {
    private var pendingOpenUrls: [[String: Any]] = []
    private let lock = NSLock()

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
            invoke.resolve(["file": next])
        } else {
            invoke.resolve([:])
        }
    }

    @objc public func readUriBytes(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ReadUriArgs.self)
        guard let url = resolveUrl(from: args.uri) else {
            invoke.reject("PERMISSION_DENIED: invalid bookmark or URL")
            return
        }
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        var coordinatorError: NSError?
        var readData: Data?
        var readError: Error?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { coordinatedUrl in
            do {
                readData = try Data(contentsOf: coordinatedUrl)
            } catch {
                readError = error
            }
        }
        if let err = coordinatorError ?? readError {
            invoke.reject("PERMISSION_DENIED: \(err.localizedDescription)")
            return
        }
        guard let data = readData else {
            invoke.reject("INTERNAL_ERROR: empty read result")
            return
        }
        invoke.resolve(["bytesBase64": data.base64EncodedString()])
    }

    @objc public func writeUriBytesAtomic(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WriteUriArgs.self)
        guard let url = resolveUrl(from: args.uri),
              let data = Data(base64Encoded: args.bytesBase64) else {
            invoke.reject("INVALID_ARGUMENT: invalid bookmark or base64 payload")
            return
        }
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        var coordinatorError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatorError) { coordinatedUrl in
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
        invoke.resolve(["ok": true])
    }

    @objc public func shareFileBytes(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ShareFileArgs.self)
        guard let data = Data(base64Encoded: args.bytesBase64) else {
            invoke.reject("INVALID_ARGUMENT: invalid base64 payload")
            return
        }
        let safeName = args.suggestedName.replacingOccurrences(of: "/", with: "_")
        let tmpUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent("share-out", isDirectory: true)
        try FileManager.default.createDirectory(at: tmpUrl, withIntermediateDirectories: true)
        let fileUrl = tmpUrl.appendingPathComponent(safeName)
        try data.write(to: fileUrl, options: .atomic)

        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("INTERNAL_ERROR: missing presenter")
                return
            }
            let controller = UIActivityViewController(activityItems: [fileUrl], applicationActivities: nil)
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
