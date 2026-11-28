use hwp5_wasm::{HwpRecord, inspect_hwp5_inner, parse_records_inner, read_stream_inner, rewrite_streams_inner};
use std::collections::BTreeMap;

const PARA_HEADER: u16 = 66;
const LIST_HEADER: u16 = 72;
const MEMO_LIST: u16 = 93;

/// Post-body tail lists (master pages and memo lists) captured from an opened HWP5 document.
#[derive(Debug, Clone)]
pub struct SectionTailsBaseline {
    pub sections: usize,
    pub tails: BTreeMap<usize, Vec<Vec<u8>>>,
}

fn extract_section_tail_slices(data: &[u8], records: &[HwpRecord]) -> (usize, Vec<Vec<u8>>) {
    let mut last_body_para_idx = None;
    for (idx, rec) in records.iter().enumerate() {
        if rec.level == 0 && rec.tag == PARA_HEADER {
            last_body_para_idx = Some(idx);
        }
    }
    let Some(para_start) = last_body_para_idx else {
        return (data.len(), Vec::new());
    };

    // In HWP5 sections, post-body master pages and memo lists live at level 1 immediately
    // after the last body paragraph's own child records (tags 67..=71: PARA_TEXT..=CTRL_HEADER).
    let mut tail_start_idx = para_start + 1;
    while tail_start_idx < records.len() {
        let rec = &records[tail_start_idx];
        if rec.level == 0 {
            break;
        }
        if rec.level == 1 && !(67..=71).contains(&rec.tag) {
            break;
        }
        tail_start_idx += 1;
    }

    if tail_start_idx >= records.len() {
        return (data.len(), Vec::new());
    }
    let body_end = records[tail_start_idx].start;
    let mut lists = Vec::new();
    let mut j = tail_start_idx;
    while j < records.len() {
        let rec = &records[j];
        if (rec.level == 0 || rec.level == 1)
            && (rec.tag == LIST_HEADER || rec.tag == MEMO_LIST)
        {
            let start_byte = rec.start;
            let list_level = rec.level;
            let mut next = j + 1;
            while next < records.len()
                && !(records[next].level <= list_level
                    && (records[next].tag == LIST_HEADER || records[next].tag == MEMO_LIST))
            {
                next += 1;
            }
            let end_byte = records[next - 1].end;
            lists.push(data[start_byte..end_byte].to_vec());
            j = next;
        } else {
            j += 1;
        }
    }
    (body_end, lists)
}

pub fn extract_section_tails(bytes: &[u8]) -> Option<SectionTailsBaseline> {
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return None;
    }
    let mut tails = BTreeMap::new();
    for sec in 0..info.sections {
        let path = format!("/BodyText/Section{sec}");
        let data = read_stream_inner(bytes, &path, info.compressed)?;
        let records = parse_records_inner(&data)?;
        let (_, lists) = extract_section_tail_slices(&data, &records);
        if !lists.is_empty() {
            tails.insert(sec, lists);
        }
    }
    if tails.is_empty() {
        None
    } else {
        Some(SectionTailsBaseline {
            sections: info.sections,
            tails,
        })
    }
}

pub fn restore_section_tails(bytes: &[u8], kept: &SectionTailsBaseline) -> (Vec<u8>, bool) {
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return (bytes.to_vec(), true);
    }
    if info.sections != kept.sections {
        return (bytes.to_vec(), true);
    }
    let mut payloads = Vec::new();
    let mut manifest = Vec::new();
    let mut tails_lost = false;
    for (sec, orig_lists) in &kept.tails {
        let path = format!("/BodyText/Section{sec}");
        let Some(data) = read_stream_inner(bytes, &path, info.compressed) else {
            tails_lost = true;
            continue;
        };
        let Some(records) = parse_records_inner(&data) else {
            tails_lost = true;
            continue;
        };
        let (body_end, existing) = extract_section_tail_slices(&data, &records);
        if existing.len() >= orig_lists.len() {
            continue;
        }
        let mut rebuilt = data[..body_end].to_vec();
        for list in orig_lists {
            rebuilt.extend_from_slice(list);
        }
        let offset = payloads.len();
        payloads.extend_from_slice(&rebuilt);
        manifest.push(serde_json::json!({
            "path": path,
            "offset": offset,
            "length": rebuilt.len(),
            "plain": false,
        }));
    }
    if manifest.is_empty() {
        return (bytes.to_vec(), tails_lost);
    }
    let manifest_json = serde_json::Value::Array(manifest).to_string();
    match rewrite_streams_inner(bytes, &manifest_json, &payloads) {
        Some(rewritten) => (rewritten, tails_lost),
        None => (bytes.to_vec(), true),
    }
}
