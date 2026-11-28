use crate::storage::MobileDocFormat;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use hwp5_wasm::{inspect_hwp5_inner, read_stream_inner, rewrite_streams_inner};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};

pub const PREVIEW_TEXT_CHARS: usize = 1022;
pub const MAX_PREVIEW_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const PNG_SIGNATURE: &[u8; 8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Minimal valid 1x1 white PNG used when no page thumbnail could be rendered.
const BLANK_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePreviewInput {
    pub text: String,
    #[serde(default)]
    pub image_base64: Option<String>,
}

fn normalized_preview(preview: &SavePreviewInput) -> (String, Vec<u8>) {
    let text: String = preview.text.chars().take(PREVIEW_TEXT_CHARS).collect();
    let image = preview
        .image_base64
        .as_deref()
        .and_then(|raw| B64.decode(raw).ok())
        .filter(|bytes| {
            bytes.len() > PNG_SIGNATURE.len()
                && bytes.len() <= MAX_PREVIEW_IMAGE_BYTES
                && bytes.starts_with(PNG_SIGNATURE)
        })
        .unwrap_or_else(|| BLANK_PNG.to_vec());
    (text, image)
}

pub fn write_preview_parts(
    bytes: &[u8],
    format: MobileDocFormat,
    preview: &SavePreviewInput,
) -> Vec<u8> {
    let (text, image) = normalized_preview(preview);
    match format {
        MobileDocFormat::Hwp => write_hwp5_preview(bytes, &text, &image),
        MobileDocFormat::Hwpx => write_hwpx_preview(bytes, &text, &image),
        _ => bytes.to_vec(),
    }
}

fn write_hwp5_preview(bytes: &[u8], text: &str, image: &[u8]) -> Vec<u8> {
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return bytes.to_vec();
    }
    let mut payloads = Vec::new();
    let mut manifest = Vec::new();
    if read_stream_inner(bytes, "/PrvText", false).is_some() {
        let utf16: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let offset = payloads.len();
        payloads.extend_from_slice(&utf16);
        manifest.push(serde_json::json!({
            "path": "/PrvText",
            "offset": offset,
            "length": utf16.len(),
            "plain": true,
        }));
    }
    if read_stream_inner(bytes, "/PrvImage", false).is_some() {
        let offset = payloads.len();
        payloads.extend_from_slice(image);
        manifest.push(serde_json::json!({
            "path": "/PrvImage",
            "offset": offset,
            "length": image.len(),
            "plain": true,
        }));
    }
    if manifest.is_empty() {
        return bytes.to_vec();
    }
    let manifest_json = serde_json::Value::Array(manifest).to_string();
    rewrite_streams_inner(bytes, &manifest_json, &payloads).unwrap_or_else(|| bytes.to_vec())
}

fn write_hwpx_preview(bytes: &[u8], text: &str, image: &[u8]) -> Vec<u8> {
    let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return bytes.to_vec();
    };
    let mut has_target = false;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i)
            && (entry.name() == "Preview/PrvText.txt" || entry.name() == "Preview/PrvImage.png")
        {
            has_target = true;
            break;
        }
    }
    if !has_target {
        return bytes.to_vec();
    }
    let mut out = Cursor::new(Vec::with_capacity(bytes.len()));
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        for i in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(i) else {
                return bytes.to_vec();
            };
            let name = entry.name().to_string();
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(entry.compression());
            if writer.start_file(&name, options).is_err() {
                return bytes.to_vec();
            }
            if name == "Preview/PrvText.txt" {
                if writer.write_all(text.as_bytes()).is_err() {
                    return bytes.to_vec();
                }
            } else if name == "Preview/PrvImage.png" {
                if writer.write_all(image).is_err() {
                    return bytes.to_vec();
                }
            } else {
                let mut buf = Vec::new();
                if entry.read_to_end(&mut buf).is_err() || writer.write_all(&buf).is_err() {
                    return bytes.to_vec();
                }
            }
        }
        if writer.finish().is_err() {
            return bytes.to_vec();
        }
    }
    out.into_inner()
}
