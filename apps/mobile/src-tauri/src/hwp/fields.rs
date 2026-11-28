use hwp5_wasm::{HwpRecord, inspect_hwp5_inner, parse_records_inner, read_stream_inner, rewrite_streams_inner};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const PARA_TEXT: u16 = 67;
const CTRL_HEADER: u16 = 71;
const UNKNOWN_FIELD: u32 = 0x2575_6e6b; // '%unk'
const FIELD_BEGIN: u16 = 3;

pub type FieldKindsBaseline = BTreeMap<String, u32>;

fn is_long_char(unit: u16) -> bool {
    matches!(unit, 1..=9 | 11 | 12 | 14..=23)
}

fn is_extended_char(unit: u16) -> bool {
    matches!(unit, 1..=3 | 11 | 12 | 14..=18 | 21..=23)
}

fn read_u16_le(data: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([data[at], data[at + 1]])
}

fn read_u32_le(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

fn control_digest(data: &[u8], control: &HwpRecord) -> String {
    let digest = Sha256::digest(&data[control.body..control.end]);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

struct UnknownFieldSpot {
    at: usize,
    kind: u32,
    digest: String,
}

fn unknown_fields_in(data: &[u8], records: &[HwpRecord]) -> Vec<UnknownFieldSpot> {
    let mut out = Vec::new();
    for (idx, text) in records.iter().enumerate() {
        if text.tag != PARA_TEXT {
            continue;
        }
        let mut controls = Vec::new();
        for rec in &records[idx + 1..] {
            if rec.level < text.level {
                break;
            }
            if rec.level == text.level && rec.tag == CTRL_HEADER {
                controls.push(rec);
            }
        }
        let mut at = text.body;
        let mut nth = 0usize;
        while at + 1 < text.end {
            let unit = read_u16_le(data, at);
            if unit < 32 && is_long_char(unit) {
                if at + 16 > text.end {
                    break;
                }
                if is_extended_char(unit) {
                    if let Some(ctrl) = controls.get(nth)
                        && unit == FIELD_BEGIN
                        && ctrl.end - ctrl.body >= 4
                        && read_u32_le(data, ctrl.body) == UNKNOWN_FIELD
                    {
                        out.push(UnknownFieldSpot {
                            at: at + 2,
                            kind: read_u32_le(data, at + 2),
                            digest: control_digest(data, ctrl),
                        });
                    }
                    nth += 1;
                }
                at += 16;
            } else {
                at += 2;
            }
        }
    }
    out
}

pub fn extract_field_kinds(bytes: &[u8]) -> Option<FieldKindsBaseline> {
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return None;
    }
    let mut kinds = BTreeMap::new();
    for sec in 0..info.sections {
        let path = format!("/BodyText/Section{sec}");
        let data = read_stream_inner(bytes, &path, info.compressed)?;
        let records = parse_records_inner(&data)?;
        for field in unknown_fields_in(&data, &records) {
            if field.kind != UNKNOWN_FIELD {
                kinds.insert(field.digest, field.kind);
            }
        }
    }
    if kinds.is_empty() { None } else { Some(kinds) }
}

pub fn restore_field_kinds(bytes: &[u8], kept: &FieldKindsBaseline) -> Vec<u8> {
    if kept.is_empty() {
        return bytes.to_vec();
    }
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return bytes.to_vec();
    }
    let mut payloads = Vec::new();
    let mut manifest = Vec::new();
    for sec in 0..info.sections {
        let path = format!("/BodyText/Section{sec}");
        let Some(mut data) = read_stream_inner(bytes, &path, info.compressed) else {
            continue;
        };
        let Some(records) = parse_records_inner(&data) else {
            continue;
        };
        let mut modified = false;
        for field in unknown_fields_in(&data, &records) {
            if field.kind == UNKNOWN_FIELD
                && let Some(orig_kind) = kept.get(&field.digest)
            {
                data[field.at..field.at + 4].copy_from_slice(&orig_kind.to_le_bytes());
                modified = true;
            }
        }
        if modified {
            let offset = payloads.len();
            payloads.extend_from_slice(&data);
            manifest.push(serde_json::json!({
                "path": path,
                "offset": offset,
                "length": data.len(),
                "plain": false,
            }));
        }
    }
    if manifest.is_empty() {
        return bytes.to_vec();
    }
    let manifest_json = serde_json::Value::Array(manifest).to_string();
    rewrite_streams_inner(bytes, &manifest_json, &payloads).unwrap_or_else(|| bytes.to_vec())
}
