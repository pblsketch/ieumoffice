//! Lightweight, ZIP-safe document thumbnail extraction and disk cache for the mobile home
//! and folder browsers (Android + iOS).
//!
//! Protected documents (encrypted/distribution HWP/HWPX, encrypted PDF, encrypted OOXML)
//! never produce or cache thumbnails. Every ZIP archive read enforces strict entry count,
//! uncompressed size, bounded `take()` reads, compression ratio, and path normalization limits.

use crate::hwp::inspect_hwp_container;
use crate::storage::MobileDocFormat;
use crate::storage::print::pdf_bytes_have_encrypt_dict;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use hwp5_wasm::{inspect_hwp5_inner, read_stream_inner};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri_plugin_ieum_mobile::fs::{NativeFileBridge, THUMBS_RELATIVE_DIR};
use uuid::Uuid;

/// Hard ZIP safety bounds aligned with `@genoffice/zip-gate`.
const MAX_ZIP_ENTRIES: usize = 10_000;
const MAX_THUMB_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_XML_BYTES: usize = 512 * 1024;
const MAX_TEXT_READ_BYTES: usize = 16 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;
const SMALL_RATIO_EXEMPT_BYTES: u64 = 64 * 1024;

/// Disk cache eviction bounds under `<cache>/ieum-tmp/thumbs/`.
const MAX_CACHE_ENTRIES: usize = 120;
const MAX_CACHE_TOTAL_BYTES: u64 = 24 * 1024 * 1024;

const MAX_SNIPPET_CHARS: usize = 280;
const MAX_TITLE_CHARS: usize = 80;

const PNG_SIG: &[u8; 8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG: &[u8; 3] = &[0xff, 0xd8, 0xff];
const GIF87_SIG: &[u8; 6] = b"GIF87a";
const GIF89_SIG: &[u8; 6] = b"GIF89a";
const BMP_SIG: &[u8; 2] = b"BM";
const OLE2_SIG: &[u8; 8] = &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/// Thumbnail payload returned to the mobile WebView.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ThumbnailPayload {
    Image {
        mime: String,
        #[serde(rename = "dataBase64")]
        data_base64: String,
    },
    Text {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        snippet: String,
    },
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedThumbnailRecord {
    fingerprint: String,
    payload: ThumbnailPayload,
}

/// Detects supported raster image formats by magic bytes and rejects 1x1 blank placeholder PNGs.
pub fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.is_empty() || bytes.len() > MAX_THUMB_IMAGE_BYTES {
        return None;
    }
    if bytes.len() >= 24 && bytes.starts_with(PNG_SIG) {
        // IHDR width/height live at bytes 16..24; ignore 1x1 blank placeholders.
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        if width <= 1 && height <= 1 {
            return None;
        }
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes.starts_with(JPEG_SIG) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 6 && (bytes.starts_with(GIF87_SIG) || bytes.starts_with(GIF89_SIG)) {
        return Some("image/gif");
    }
    if bytes.len() >= 26 && bytes.starts_with(BMP_SIG) {
        return Some("image/bmp");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

fn image_payload(bytes: &[u8]) -> Option<ThumbnailPayload> {
    let mime = detect_image_mime(bytes)?;
    Some(ThumbnailPayload::Image {
        mime: mime.to_string(),
        data_base64: B64.encode(bytes),
    })
}

/// Extracts a lightweight thumbnail from raw document bytes without spinning up heavy engines.
/// Returns `ThumbnailPayload::None` for encrypted/distribution documents or unknown formats.
pub fn extract_thumbnail_from_bytes(
    format: Option<MobileDocFormat>,
    is_picture: bool,
    bytes: &[u8],
) -> ThumbnailPayload {
    if is_picture {
        return image_payload(bytes).unwrap_or(ThumbnailPayload::None);
    }
    let Some(fmt) = format else {
        return ThumbnailPayload::None;
    };
    match fmt {
        MobileDocFormat::Hwp => extract_hwp5_thumbnail(bytes),
        MobileDocFormat::Hwpx => extract_hwpx_thumbnail(bytes),
        MobileDocFormat::Epub => extract_epub_thumbnail(bytes),
        MobileDocFormat::Pptx | MobileDocFormat::Xlsx | MobileDocFormat::Xlsm => {
            extract_ooxml_thumbnail(bytes)
        }
        MobileDocFormat::Md | MobileDocFormat::Txt => extract_markdown_or_text_thumbnail(bytes),
        MobileDocFormat::Html => extract_html_thumbnail(bytes),
        MobileDocFormat::Csv => extract_csv_thumbnail(bytes),
        MobileDocFormat::Pdf | MobileDocFormat::Xls => ThumbnailPayload::None,
    }
}

fn extract_hwp5_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return ThumbnailPayload::None;
    }
    if let Some(img) = read_stream_inner(bytes, "/PrvImage", false)
        && let Some(payload) = image_payload(&img)
    {
        return payload;
    }
    if let Some(raw_text) = read_stream_inner(bytes, "/PrvText", false) {
        let text = decode_utf16le_snippet(&raw_text);
        if !text.is_empty() {
            return ThumbnailPayload::Text {
                title: None,
                snippet: text,
            };
        }
    }
    ThumbnailPayload::None
}

fn extract_hwpx_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let info = inspect_hwp_container(bytes, MobileDocFormat::Hwpx);
    if info.encrypted || info.distribution {
        return ThumbnailPayload::None;
    }
    let Ok(mut archive) = open_safe_zip(bytes) else {
        return ThumbnailPayload::None;
    };
    if archive_has_hwpx_encryption(&mut archive) {
        return ThumbnailPayload::None;
    }
    for candidate in [
        "Preview/PrvImage.png",
        "Preview/PrvImage.jpg",
        "Preview/PrvImage.jpeg",
        "Preview/PrvImage.gif",
        "Preview/PrvImage.bmp",
    ] {
        if let Some(img) = read_zip_entry_bounded(&mut archive, candidate, MAX_THUMB_IMAGE_BYTES)
            && let Some(payload) = image_payload(&img)
        {
            return payload;
        }
    }
    if let Some(txt_bytes) =
        read_zip_entry_bounded(&mut archive, "Preview/PrvText.txt", MAX_TEXT_READ_BYTES)
    {
        let snippet = normalize_snippet(&String::from_utf8_lossy(&txt_bytes));
        if !snippet.is_empty() {
            return ThumbnailPayload::Text {
                title: None,
                snippet,
            };
        }
    }
    ThumbnailPayload::None
}

/// Returns true when an OOXML document (`.xlsx`, `.xlsm`, `.pptx`) is wrapped in an OLE2
/// compound container (indicating password encryption).
pub(crate) fn is_ole2_encrypted_ooxml(bytes: &[u8]) -> bool {
    bytes.starts_with(OLE2_SIG)
}

fn extract_ooxml_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    // Encrypted OOXML files are wrapped in an OLE2 compound container (`EncryptedPackage`).
    if is_ole2_encrypted_ooxml(bytes) {
        return ThumbnailPayload::None;
    }
    let Ok(mut archive) = open_safe_zip(bytes) else {
        return ThumbnailPayload::None;
    };
    for candidate in [
        "docProps/thumbnail.jpeg",
        "docProps/thumbnail.jpg",
        "docProps/thumbnail.png",
        "docProps/thumbnail.gif",
        "docProps/thumbnail.bmp",
    ] {
        if let Some(img) = read_zip_entry_bounded(&mut archive, candidate, MAX_THUMB_IMAGE_BYTES)
            && let Some(payload) = image_payload(&img)
        {
            return payload;
        }
    }
    ThumbnailPayload::None
}

fn extract_epub_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let Ok(mut archive) = open_safe_zip(bytes) else {
        return ThumbnailPayload::None;
    };
    let Some(container_bytes) =
        read_zip_entry_bounded(&mut archive, "META-INF/container.xml", MAX_XML_BYTES)
    else {
        return ThumbnailPayload::None;
    };
    let container_xml = String::from_utf8_lossy(&container_bytes);
    let Some(opf_raw) = extract_xml_attr(&container_xml, "full-path") else {
        return ThumbnailPayload::None;
    };
    let Some(opf_path) = normalize_zip_path("", &opf_raw) else {
        return ThumbnailPayload::None;
    };
    let Some(opf_bytes) = read_zip_entry_bounded(&mut archive, &opf_path, MAX_XML_BYTES) else {
        return ThumbnailPayload::None;
    };
    let opf_xml = String::from_utf8_lossy(&opf_bytes);
    let opf_dir = opf_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("");

    if let Some(cover_href) = find_epub_cover_href(&opf_xml)
        && let Some(cover_path) = normalize_zip_path(opf_dir, &cover_href)
        && let Some(img) = read_zip_entry_bounded(&mut archive, &cover_path, MAX_THUMB_IMAGE_BYTES)
        && let Some(payload) = image_payload(&img)
    {
        return payload;
    }

    let title = extract_xml_tag_text(&opf_xml, "dc:title")
        .or_else(|| extract_xml_tag_text(&opf_xml, "title"))
        .map(|t| truncate_chars(&normalize_snippet(&t), MAX_TITLE_CHARS))
        .filter(|t| !t.is_empty());

    if let Some(first_href) = find_epub_first_spine_href(&opf_xml)
        && let Some(xhtml_path) = normalize_zip_path(opf_dir, &first_href)
        && let Some(xhtml_bytes) =
            read_zip_entry_bounded(&mut archive, &xhtml_path, MAX_TEXT_READ_BYTES)
    {
        let snippet = strip_html_to_snippet(&String::from_utf8_lossy(&xhtml_bytes));
        if !snippet.is_empty() || title.is_some() {
            return ThumbnailPayload::Text { title, snippet };
        }
    }

    if let Some(title) = title {
        return ThumbnailPayload::Text {
            title: Some(title),
            snippet: String::new(),
        };
    }
    ThumbnailPayload::None
}

fn extract_markdown_or_text_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let slice = &bytes[..bytes.len().min(MAX_TEXT_READ_BYTES)];
    let Ok(raw) = std::str::from_utf8(slice) else {
        // Fallback when slicing mid-UTF-8 char boundary.
        let valid_up_to = match std::str::from_utf8(slice) {
            Ok(_) => slice.len(),
            Err(e) => e.valid_up_to(),
        };
        if valid_up_to == 0 {
            return ThumbnailPayload::None;
        }
        return build_markdown_text_payload(&String::from_utf8_lossy(&slice[..valid_up_to]));
    };
    build_markdown_text_payload(raw)
}

fn build_markdown_text_payload(raw: &str) -> ThumbnailPayload {
    // Strip AI-redaction HTML span wrappers while keeping the underlying visible text.
    let cleaned = strip_redaction_span_tags(raw);
    let mut title: Option<String> = None;
    let mut body_lines: Vec<String> = Vec::new();
    for line in cleaned.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if title.is_none() && trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                title = Some(truncate_chars(heading, MAX_TITLE_CHARS));
                continue;
            }
        }
        let plain = trimmed
            .trim_start_matches(['>', '-', '*', '+'])
            .trim()
            .replace("**", "")
            .replace("__", "")
            .replace('`', "");
        if !plain.is_empty() {
            body_lines.push(plain);
        }
        if body_lines.len() >= 8 {
            break;
        }
    }
    let snippet = truncate_chars(&body_lines.join(" "), MAX_SNIPPET_CHARS);
    if title.is_none() && snippet.is_empty() {
        return ThumbnailPayload::None;
    }
    ThumbnailPayload::Text { title, snippet }
}

fn extract_html_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let slice = &bytes[..bytes.len().min(MAX_TEXT_READ_BYTES)];
    let valid_up_to = match std::str::from_utf8(slice) {
        Ok(_) => slice.len(),
        Err(e) => e.valid_up_to(),
    };
    if valid_up_to == 0 {
        return ThumbnailPayload::None;
    }
    let raw = &String::from_utf8_lossy(&slice[..valid_up_to]);
    let title = extract_xml_tag_text(raw, "title")
        .map(|t| truncate_chars(&normalize_snippet(&t), MAX_TITLE_CHARS))
        .filter(|t| !t.is_empty());
    let snippet = strip_html_to_snippet(raw);
    if title.is_none() && snippet.is_empty() {
        return ThumbnailPayload::None;
    }
    ThumbnailPayload::Text { title, snippet }
}

fn extract_csv_thumbnail(bytes: &[u8]) -> ThumbnailPayload {
    let slice = &bytes[..bytes.len().min(MAX_TEXT_READ_BYTES)];
    let valid_up_to = match std::str::from_utf8(slice) {
        Ok(_) => slice.len(),
        Err(e) => e.valid_up_to(),
    };
    if valid_up_to == 0 {
        return ThumbnailPayload::None;
    }
    let text = String::from_utf8_lossy(&slice[..valid_up_to]);
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let title = lines
        .next()
        .map(|h| truncate_chars(&h.replace(',', " · "), MAX_TITLE_CHARS));
    let body: Vec<String> = lines.take(5).map(|r| r.replace(',', " · ")).collect();
    let snippet = truncate_chars(&body.join("\n"), MAX_SNIPPET_CHARS);
    if title.is_none() && snippet.is_empty() {
        return ThumbnailPayload::None;
    }
    ThumbnailPayload::Text { title, snippet }
}

/// Manages `<cache>/ieum-tmp/thumbs/` disk cache and PDF native thumbnail generation.
pub struct ThumbnailCache;

impl ThumbnailCache {
    fn thumbs_dir(cache_dir: &Path) -> PathBuf {
        cache_dir.join(THUMBS_RELATIVE_DIR)
    }

    fn cache_file(cache_dir: &Path, doc_key: &str) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(doc_key.as_bytes());
        let hex = format!("{:x}", hasher.finalize());
        Self::thumbs_dir(cache_dir).join(format!("{hex}.json"))
    }

    /// Reads a cached thumbnail if its fingerprint matches.
    pub fn get(cache_dir: &Path, doc_key: &str, fingerprint: &str) -> Option<ThumbnailPayload> {
        let path = Self::cache_file(cache_dir, doc_key);
        let raw = std::fs::read(&path).ok()?;
        let record: CachedThumbnailRecord = serde_json::from_slice(&raw).ok()?;
        if record.fingerprint == fingerprint {
            Some(record.payload)
        } else {
            None
        }
    }

    /// Writes a thumbnail record to disk and enforces cache size/count bounds.
    pub fn put(
        cache_dir: &Path,
        doc_key: &str,
        fingerprint: &str,
        payload: &ThumbnailPayload,
    ) {
        let dir = Self::thumbs_dir(cache_dir);
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        let record = CachedThumbnailRecord {
            fingerprint: fingerprint.to_string(),
            payload: payload.clone(),
        };
        let Ok(json) = serde_json::to_vec(&record) else {
            return;
        };
        let target = Self::cache_file(cache_dir, doc_key);
        let tmp = dir.join(format!(".tmp-{}.json", Uuid::new_v4()));
        if std::fs::write(&tmp, &json).is_ok() {
            if std::fs::rename(&tmp, &target).is_err() {
                let _ = std::fs::remove_file(&tmp);
            } else {
                Self::prune(&dir);
            }
        }
    }

    /// Deletes any cached thumbnail associated with `doc_key`.
    pub fn evict(cache_dir: &Path, doc_key: &str) {
        let path = Self::cache_file(cache_dir, doc_key);
        let _ = std::fs::remove_file(path);
    }

    /// Removes leftover `.pdf-src-*`, `.pdf-out-*`, and `.tmp-*` files from previous crashed runs.
    pub fn cleanup_stale_temp_files(cache_dir: &Path) {
        let dir = Self::thumbs_dir(cache_dir);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with(".pdf-src-")
                || name.starts_with(".pdf-out-")
                || name.starts_with(".tmp-")
            {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    /// Renders page 0 of a local/URI PDF through the native bridge (`PdfRenderer` / `PDFKit`)
    /// after verifying the PDF is not encrypted.
    pub fn render_pdf_bytes(
        cache_dir: &Path,
        pdf_bytes: &[u8],
        max_px: u32,
        bridge: &dyn NativeFileBridge,
    ) -> ThumbnailPayload {
        if pdf_bytes.len() < 5 || &pdf_bytes[..5] != b"%PDF-" {
            return ThumbnailPayload::None;
        }
        if pdf_bytes_have_encrypt_dict(pdf_bytes) {
            return ThumbnailPayload::None;
        }
        let dir = Self::thumbs_dir(cache_dir);
        if std::fs::create_dir_all(&dir).is_err() {
            return ThumbnailPayload::None;
        }
        let id = Uuid::new_v4();
        let src = dir.join(format!(".pdf-src-{id}.pdf"));
        let dest = dir.join(format!(".pdf-out-{id}.png"));
        let result = (|| -> ThumbnailPayload {
            if std::fs::write(&src, pdf_bytes).is_err() {
                return ThumbnailPayload::None;
            }
            let rendered = bridge
                .render_pdf_thumbnail(&src, &dest, max_px.clamp(64, 1024))
                .unwrap_or(false);
            if !rendered {
                return ThumbnailPayload::None;
            }
            let Ok(png) = std::fs::read(&dest) else {
                return ThumbnailPayload::None;
            };
            image_payload(&png).unwrap_or(ThumbnailPayload::None)
        })();
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&dest);
        result
    }

    fn prune(dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut files: Vec<(PathBuf, u64, u64)> = Vec::new();
        let mut total: u64 = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str())
                && (name.starts_with(".pdf-src-")
                    || name.starts_with(".pdf-out-")
                    || name.starts_with(".tmp-"))
            {
                let stale = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > 300);
                if stale {
                    let _ = std::fs::remove_file(&path);
                }
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let len = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            total = total.saturating_add(len);
            files.push((path, len, modified));
        }
        if files.len() <= MAX_CACHE_ENTRIES && total <= MAX_CACHE_TOTAL_BYTES {
            return;
        }
        // Oldest first.
        files.sort_by_key(|(_, _, m)| *m);
        let mut count = files.len();
        for (path, len, _) in files {
            if count <= MAX_CACHE_ENTRIES && total <= MAX_CACHE_TOTAL_BYTES {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                count = count.saturating_sub(1);
                total = total.saturating_sub(len);
            }
        }
    }
}

// --- ZIP safety helpers ---

fn open_safe_zip(bytes: &[u8]) -> Result<zip::ZipArchive<Cursor<&[u8]>>, ()> {
    let archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| ())?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(());
    }
    Ok(archive)
}

fn read_zip_entry_bounded(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    let entry = archive.by_name(name).ok()?;
    let declared = entry.size();
    let compressed = entry.compressed_size();
    if declared > max_bytes as u64 {
        return None;
    }
    if declared > SMALL_RATIO_EXEMPT_BYTES
        && (compressed == 0 || declared / compressed > MAX_COMPRESSION_RATIO)
    {
        return None;
    }
    let mut out = Vec::with_capacity((declared as usize).min(max_bytes));
    let limit = (max_bytes as u64).saturating_add(1);
    if entry.take(limit).read_to_end(&mut out).is_err() {
        return None;
    }
    if out.len() > max_bytes {
        return None;
    }
    if out.len() as u64 > SMALL_RATIO_EXEMPT_BYTES
        && (compressed == 0 || (out.len() as u64) / compressed > MAX_COMPRESSION_RATIO)
    {
        return None;
    }
    Some(out)
}

fn archive_has_hwpx_encryption(archive: &mut zip::ZipArchive<Cursor<&[u8]>>) -> bool {
    let Some(manifest) = read_zip_entry_bounded(archive, "META-INF/manifest.xml", MAX_XML_BYTES)
    else {
        return false;
    };
    let text = String::from_utf8_lossy(&manifest);
    text.contains("encryption-data") || text.contains("EncryptedKey")
}

/// Normalizes a relative ZIP path under `base_dir`, refusing absolute paths and `..` traversal.
fn normalize_zip_path(base_dir: &str, href: &str) -> Option<String> {
    let cleaned = href.split(['#', '?']).next().unwrap_or("").trim();
    if cleaned.is_empty() || cleaned.starts_with('/') || cleaned.starts_with('\\') {
        return None;
    }
    if cleaned.contains(':') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for seg in base_dir.split('/').filter(|s| !s.is_empty()) {
        parts.push(seg);
    }
    let normalized = cleaned.replace('\\', "/");
    for seg in normalized.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

// --- Lightweight XML / HTML / UTF-16 helpers ---

fn decode_utf16le_snippet(raw: &[u8]) -> String {
    let units: Vec<u16> = raw
        .chunks_exact(2)
        .take(MAX_SNIPPET_CHARS * 2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    normalize_snippet(&String::from_utf16_lossy(&units))
}

fn normalize_snippet(text: &str) -> String {
    let mut out = String::new();
    let mut last_space = true;
    for ch in text.chars() {
        if ch.is_whitespace() || ch.is_control() {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
        } else {
            out.push(ch);
            last_space = false;
        }
        if out.chars().count() >= MAX_SNIPPET_CHARS {
            break;
        }
    }
    out.trim().to_string()
}

fn truncate_chars(text: &str, max: usize) -> String {
    let mut iter = text.chars();
    let head: String = iter.by_ref().take(max).collect();
    if iter.next().is_some() {
        format!("{}…", head.trim_end())
    } else {
        head.trim().to_string()
    }
}

fn extract_xml_attr(xml: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=");
    let idx = xml.find(&needle)?;
    let rest = xml[idx + needle.len()..].trim_start();
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let inner = &rest[1..];
    let end = inner.find(quote)?;
    Some(inner[..end].to_string())
}

fn extract_xml_tag_text(xml: &str, tag: &str) -> Option<String> {
    let lower = xml.to_ascii_lowercase();
    let open = format!("<{}", tag.to_ascii_lowercase());
    let start = lower.find(&open)?;
    let after_open = start + open.len();
    let gt = xml[after_open..].find('>')? + after_open + 1;
    let close = format!("</{}>", tag.to_ascii_lowercase());
    let end = lower[gt..].find(&close)? + gt;
    Some(decode_basic_entities(&xml[gt..end]))
}

fn find_epub_cover_href(opf: &str) -> Option<String> {
    let mut cover_id: Option<String> = None;
    // Scan `<meta ...>` tags for `<meta name="cover" content="id"/>`.
    let mut cursor = opf;
    while let Some(pos) = cursor.find("<meta") {
        let rest = &cursor[pos..];
        let Some(end) = rest.find('>') else { break };
        let tag = &rest[..=end];
        if extract_xml_attr(tag, "name").as_deref() == Some("cover")
            && let Some(id) = extract_xml_attr(tag, "content")
        {
            cover_id = Some(id);
            break;
        }
        cursor = &rest[end + 1..];
    }

    // Scan `<item ...>` tags for `properties="...cover-image..."` or matching cover id.
    let mut fallback_href: Option<String> = None;
    let mut cursor = opf;
    while let Some(pos) = cursor.find("<item") {
        let rest = &cursor[pos..];
        let after = rest.as_bytes().get(5).copied();
        if !matches!(after, Some(b' ' | b'\t' | b'\r' | b'\n')) {
            cursor = &rest[5..];
            continue;
        }
        let Some(end) = rest.find('>') else { break };
        let tag = &rest[..=end];
        let href = extract_xml_attr(tag, "href");
        if let Some(props) = extract_xml_attr(tag, "properties")
            && props.split_whitespace().any(|p| p == "cover-image")
            && let Some(h) = href
        {
            return Some(h);
        }
        if fallback_href.is_none()
            && let (Some(cid), Some(id), Some(h)) = (
                cover_id.as_deref(),
                extract_xml_attr(tag, "id"),
                href,
            )
            && id == cid
        {
            fallback_href = Some(h);
        }
        cursor = &rest[end + 1..];
    }
    fallback_href
}

fn find_epub_first_spine_href(opf: &str) -> Option<String> {
    let spine_pos = opf.find("<itemref")?;
    let rest = &opf[spine_pos..];
    let end = rest.find('>')?;
    let idref = extract_xml_attr(&rest[..=end], "idref")?;

    let mut cursor = opf;
    while let Some(pos) = cursor.find("<item") {
        let rest = &cursor[pos..];
        let after = rest.as_bytes().get(5).copied();
        if !matches!(after, Some(b' ' | b'\t' | b'\r' | b'\n')) {
            cursor = &rest[5..];
            continue;
        }
        let Some(end) = rest.find('>') else { break };
        let tag = &rest[..=end];
        if extract_xml_attr(tag, "id").as_deref() == Some(idref.as_str()) {
            return extract_xml_attr(tag, "href");
        }
        cursor = &rest[end + 1..];
    }
    None
}

fn strip_redaction_span_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find("<span") {
        let after = &rest[start..];
        let Some(gt) = after.find('>') else {
            out.push_str(rest);
            return out;
        };
        let open_tag = &after[..=gt];
        if open_tag.contains("redact-span") || open_tag.contains("data-redaction") {
            out.push_str(&rest[..start]);
            let inner = &after[gt + 1..];
            if let Some(close) = inner.find("</span>") {
                out.push_str(&inner[..close]);
                rest = &inner[close + "</span>".len()..];
                continue;
            }
        }
        out.push_str(&rest[..start + gt + 1]);
        rest = &after[gt + 1..];
    }
    out.push_str(rest);
    out
}

fn starts_with_html_tag(tail: &str, tag: &str) -> bool {
    if !tail.starts_with(tag) {
        return false;
    }
    matches!(
        tail.as_bytes().get(tag.len()).copied(),
        Some(b'>' | b'/' | b' ' | b'\t' | b'\r' | b'\n') | None
    )
}

fn strip_html_to_snippet(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut cleaned = String::with_capacity(html.len().min(MAX_TEXT_READ_BYTES));
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let tail = &lower[i..];
            let skip_block = if starts_with_html_tag(tail, "<script") {
                Some("</script>")
            } else if starts_with_html_tag(tail, "<style") {
                Some("</style>")
            } else if starts_with_html_tag(tail, "<noscript") {
                Some("</noscript>")
            } else if starts_with_html_tag(tail, "<head") {
                Some("</head>")
            } else {
                None
            };
            if let Some(end_tag) = skip_block {
                if let Some(pos) = tail.find(end_tag) {
                    i += pos + end_tag.len();
                    continue;
                } else {
                    break;
                }
            }
            if let Some(gt) = html[i..].find('>') {
                cleaned.push(' ');
                i += gt + 1;
                continue;
            } else {
                break;
            }
        }
        let ch = html[i..].chars().next().unwrap_or(' ');
        cleaned.push(ch);
        i += ch.len_utf8();
    }
    normalize_snippet(&decode_basic_entities(&cleaned))
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tauri_plugin_ieum_mobile::fs::HostFileBridge;

    fn sample_png_2x2() -> Vec<u8> {
        let mut png = Vec::new();
        png.extend_from_slice(PNG_SIG);
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&2u32.to_be_bytes());
        png.extend_from_slice(&2u32.to_be_bytes());
        png.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
        png
    }

    fn blank_png_1x1() -> Vec<u8> {
        let mut png = Vec::new();
        png.extend_from_slice(PNG_SIG);
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&1u32.to_be_bytes());
        png.extend_from_slice(&1u32.to_be_bytes());
        png.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
        png
    }

    fn sample_bmp() -> Vec<u8> {
        let mut bmp = vec![0u8; 32];
        bmp[0] = b'B';
        bmp[1] = b'M';
        bmp
    }

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cur = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut cur);
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in entries {
                writer.start_file(*name, opts).unwrap();
                writer.write_all(data).unwrap();
            }
            writer.finish().unwrap();
        }
        cur.into_inner()
    }

    #[test]
    fn detects_png_jpeg_gif_bmp_and_ignores_1x1_placeholder() {
        assert_eq!(detect_image_mime(&sample_png_2x2()), Some("image/png"));
        assert_eq!(detect_image_mime(&blank_png_1x1()), None);
        assert_eq!(detect_image_mime(&sample_bmp()), Some("image/bmp"));
        assert_eq!(detect_image_mime(b"\xff\xd8\xff\xe0rest"), Some("image/jpeg"));
        assert_eq!(detect_image_mime(b"GIF89a1234"), Some("image/gif"));
    }

    #[test]
    fn extracts_hwpx_preview_image_and_falls_back_to_prvtext_when_blank() {
        let png = sample_png_2x2();
        let hwpx = build_zip(&[
            ("mimetype", b"application/hwp+zip"),
            ("Preview/PrvImage.png", &png),
            ("Preview/PrvText.txt", "Hello Hangul".as_bytes()),
        ]);
        let res = extract_thumbnail_from_bytes(Some(MobileDocFormat::Hwpx), false, &hwpx);
        match res {
            ThumbnailPayload::Image { mime, data_base64 } => {
                assert_eq!(mime, "image/png");
                assert_eq!(B64.decode(data_base64).unwrap(), png);
            }
            other => panic!("expected image, got {other:?}"),
        }

        let blank_hwpx = build_zip(&[
            ("mimetype", b"application/hwp+zip"),
            ("Preview/PrvImage.png", &blank_png_1x1()),
            ("Preview/PrvText.txt", "Fallback preview text".as_bytes()),
        ]);
        assert_eq!(
            extract_thumbnail_from_bytes(Some(MobileDocFormat::Hwpx), false, &blank_hwpx),
            ThumbnailPayload::Text {
                title: None,
                snippet: "Fallback preview text".to_string(),
            }
        );
    }

    #[test]
    fn refuses_encrypted_hwpx_and_encrypted_ooxml() {
        let enc_hwpx = build_zip(&[
            ("mimetype", b"application/hwp+zip"),
            (
                "META-INF/manifest.xml",
                b"<manifest><encryption-data/></manifest>",
            ),
            ("Preview/PrvImage.png", &sample_png_2x2()),
        ]);
        assert_eq!(
            extract_thumbnail_from_bytes(Some(MobileDocFormat::Hwpx), false, &enc_hwpx),
            ThumbnailPayload::None
        );

        let mut ole_encrypted = OLE2_SIG.to_vec();
        ole_encrypted.extend_from_slice(&[0u8; 64]);
        assert_eq!(
            extract_thumbnail_from_bytes(Some(MobileDocFormat::Xlsx), false, &ole_encrypted),
            ThumbnailPayload::None
        );
    }

    #[test]
    fn extracts_epub_cover_and_blocks_path_traversal() {
        let png = sample_png_2x2();
        let epub = build_zip(&[
            (
                "META-INF/container.xml",
                br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
            ),
            (
                "OEBPS/content.opf",
                br#"<package><metadata><dc:title>My Book</dc:title></metadata><manifest><item id="c" href="img/cover.png" properties="cover-image"/></manifest></package>"#,
            ),
            ("OEBPS/img/cover.png", &png),
        ]);
        match extract_thumbnail_from_bytes(Some(MobileDocFormat::Epub), false, &epub) {
            ThumbnailPayload::Image { mime, .. } => assert_eq!(mime, "image/png"),
            other => panic!("expected epub cover image, got {other:?}"),
        }

        assert_eq!(normalize_zip_path("OEBPS", "../../etc/passwd"), None);
        assert_eq!(normalize_zip_path("OEBPS", "/abs.png"), None);
    }

    #[test]
    fn extracts_ooxml_thumbnail_and_markdown_html_snippets() {
        let jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF".to_vec();
        let pptx = build_zip(&[("docProps/thumbnail.jpeg", &jpeg)]);
        match extract_thumbnail_from_bytes(Some(MobileDocFormat::Pptx), false, &pptx) {
            ThumbnailPayload::Image { mime, .. } => assert_eq!(mime, "image/jpeg"),
            other => panic!("expected pptx thumbnail, got {other:?}"),
        }

        let md = b"# Release Plan\nHello <span class=\"redact-span\" data-redaction=\"\" data-label=\"name\">Alice</span> world\n";
        assert_eq!(
            extract_thumbnail_from_bytes(Some(MobileDocFormat::Md), false, md),
            ThumbnailPayload::Text {
                title: Some("Release Plan".to_string()),
                snippet: "Hello Alice world".to_string(),
            }
        );

        let html = b"<html><head><title>Notice</title><script>alert(1)</script></head><body><header>Banner</header><p>Body &amp; text</p></body></html>";
        assert_eq!(
            extract_thumbnail_from_bytes(Some(MobileDocFormat::Html), false, html),
            ThumbnailPayload::Text {
                title: Some("Notice".to_string()),
                snippet: "Banner Body & text".to_string(),
            }
        );
    }

    #[test]
    fn disk_cache_evicts_by_doc_key_and_respects_encrypted_pdf_refusal() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_pdf_thumbnail_stub(Some(sample_png_2x2()));

        // Plain PDF renders via native bridge.
        let plain_pdf = b"%PDF-1.4\n1 0 obj << >> endobj\n%%EOF";
        match ThumbnailCache::render_pdf_bytes(tmp.path(), plain_pdf, 320, &bridge) {
            ThumbnailPayload::Image { mime, .. } => assert_eq!(mime, "image/png"),
            other => panic!("expected rendered pdf png, got {other:?}"),
        }
        assert_eq!(bridge.pdf_thumbnail_calls(), 1);

        // Encrypted PDF never reaches the native bridge.
        let enc_pdf = b"%PDF-1.7\ntrailer << /Encrypt 2 0 R >>\n%%EOF";
        assert_eq!(
            ThumbnailCache::render_pdf_bytes(tmp.path(), enc_pdf, 320, &bridge),
            ThumbnailPayload::None
        );
        assert_eq!(bridge.pdf_thumbnail_calls(), 1);

        // Cache put, get, fingerprint mismatch, and evict.
        let payload = ThumbnailPayload::Text {
            title: Some("Doc".to_string()),
            snippet: "Body".to_string(),
        };
        ThumbnailCache::put(tmp.path(), "doc-1", "fp-1", &payload);
        assert_eq!(
            ThumbnailCache::get(tmp.path(), "doc-1", "fp-1"),
            Some(payload)
        );
        assert_eq!(ThumbnailCache::get(tmp.path(), "doc-1", "fp-2"), None);
        ThumbnailCache::evict(tmp.path(), "doc-1");
        assert_eq!(ThumbnailCache::get(tmp.path(), "doc-1", "fp-1"), None);
    }
}
