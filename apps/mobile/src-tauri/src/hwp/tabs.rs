use crate::storage::MobileDocFormat;
use hwp5_wasm::{HwpRecord, inspect_hwp5_inner, parse_records_inner, read_stream_inner, rewrite_streams_inner};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_NEW_TABS: usize = 5000;
const MAX_TAB_WIDTH: i64 = 0x7fff_ffff;
const MAX_TAB_KIND: i64 = 3;
const MAX_TAB_FILL: i64 = 0xff;

const PARA_HEADER: u16 = 66;
const PARA_TEXT: u16 = 67;
const CTRL_HEADER: u16 = 71;
const LIST_HEADER: u16 = 72;
const TABLE_CONTROL: u32 = 0x7462_6c20; // 'tbl '
const TAB_CHAR: u16 = 9;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCellStep {
    pub table: usize,
    pub cell: usize,
    pub para: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSpot {
    pub sec: usize,
    pub para: usize,
    pub cells: Vec<TabCellStep>,
    pub tab: usize,
    pub tabs: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredTab {
    pub sec: usize,
    pub para: usize,
    pub cells: Vec<TabCellStep>,
    pub tab: usize,
    pub tabs: usize,
    pub width: i64,
    pub r#type: i64,
    pub fill: i64,
}

fn spot_key(sec: usize, para: usize, cells: &[TabCellStep], tab: usize) -> String {
    let mut parts = vec![sec.to_string(), para.to_string()];
    for step in cells {
        parts.push(format!("{}.{}.{}", step.table, step.cell, step.para));
    }
    parts.push(tab.to_string());
    parts.join("/")
}

fn is_long_char(unit: u16) -> bool {
    matches!(
        unit,
        1..=9 | 11 | 12 | 14..=23
    )
}

fn read_u16_le(data: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([data[at], data[at + 1]])
}

fn read_u32_le(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

fn tabs_in_text(data: &[u8], text: &HwpRecord) -> Vec<(usize, bool)> {
    let mut tabs = Vec::new();
    let mut at = text.body;
    while at + 1 < text.end {
        let unit = read_u16_le(data, at);
        if unit < 32 && is_long_char(unit) {
            if at + 16 > text.end {
                break;
            }
            if unit == TAB_CHAR {
                let ext = at + 2;
                let width = read_u32_le(data, ext);
                let kind = read_u16_le(data, ext + 4);
                let empty = width == 0
                    && (kind == 0 || kind == 0x0100)
                    && read_u16_le(data, ext + 6) == 0
                    && read_u16_le(data, ext + 8) == 0
                    && read_u16_le(data, ext + 10) == 0;
                tabs.push((ext, empty));
            }
            at += 16;
        } else {
            at += 2;
        }
    }
    tabs
}

struct FoundTab {
    spot: TabSpot,
    at: usize,
}

#[allow(clippy::too_many_arguments)]
fn walk_hwp_list(
    data: &[u8],
    records: &[HwpRecord],
    from: usize,
    to: usize,
    level: u16,
    sec: usize,
    root_para: Option<usize>,
    cells: &[TabCellStep],
    out: &mut Vec<FoundTab>,
) {
    let mut para_idx: isize = -1;
    let mut i = from;
    while i < to && out.len() < MAX_NEW_TABS {
        let rec = &records[i];
        if rec.tag != PARA_HEADER || rec.level != level {
            i += 1;
            continue;
        }
        para_idx += 1;
        let current_para = para_idx as usize;
        let mut end = i + 1;
        while end < to && records[end].level > level {
            end += 1;
        }
        let body_para = root_para.unwrap_or(current_para);
        let mut cur_cells = cells.to_vec();
        if root_para.is_some()
            && let Some(last) = cur_cells.last_mut()
        {
            last.para = current_para;
        }

        let mut tables = 0usize;
        let mut j = i + 1;
        while j < end && out.len() < MAX_NEW_TABS {
            let child = &records[j];
            if child.level != level + 1 {
                j += 1;
                continue;
            }
            if child.tag == PARA_TEXT {
                let tabs = tabs_in_text(data, child);
                let total = tabs.len();
                for (nth, (at, empty)) in tabs.into_iter().enumerate() {
                    if empty && out.len() < MAX_NEW_TABS {
                        out.push(FoundTab {
                            spot: TabSpot {
                                sec,
                                para: body_para,
                                cells: cur_cells.clone(),
                                tab: nth,
                                tabs: total,
                            },
                            at,
                        });
                    }
                }
                j += 1;
            } else if child.tag == CTRL_HEADER
                && child.end - child.body >= 4
                && read_u32_le(data, child.body) == TABLE_CONTROL
            {
                let table_idx = tables;
                tables += 1;
                let mut table_end = j + 1;
                while table_end < end && records[table_end].level > level + 1 {
                    table_end += 1;
                }
                let mut cell_idx = 0usize;
                let mut c = j + 1;
                while c < table_end && out.len() < MAX_NEW_TABS {
                    if records[c].tag == LIST_HEADER && records[c].level == level + 2 {
                        let mut cell_end = c + 1;
                        while cell_end < table_end
                            && !(records[cell_end].level == level + 2
                                && records[cell_end].tag == LIST_HEADER)
                        {
                            cell_end += 1;
                        }
                        let mut next_cells = cur_cells.clone();
                        next_cells.push(TabCellStep {
                            table: table_idx,
                            cell: cell_idx,
                            para: 0,
                        });
                        walk_hwp_list(
                            data,
                            records,
                            c + 1,
                            cell_end,
                            level + 2,
                            sec,
                            Some(body_para),
                            &next_cells,
                            out,
                        );
                        cell_idx += 1;
                        c = cell_end;
                    } else {
                        c += 1;
                    }
                }
                j = table_end;
            } else {
                j += 1;
            }
        }
        i = end;
    }
}

pub fn find_new_tabs(bytes: &[u8], format: MobileDocFormat) -> Vec<TabSpot> {
    if format != MobileDocFormat::Hwp {
        return Vec::new();
    }
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return Vec::new();
    }
    let mut found = Vec::new();
    for sec in 0..info.sections {
        let path = format!("/BodyText/Section{sec}");
        let Some(data) = read_stream_inner(bytes, &path, info.compressed) else {
            continue;
        };
        let Some(records) = parse_records_inner(&data) else {
            continue;
        };
        walk_hwp_list(&data, &records, 0, records.len(), 0, sec, None, &[], &mut found);
        if found.len() >= MAX_NEW_TABS {
            break;
        }
    }
    found.into_iter().map(|f| f.spot).collect()
}

fn valid_measure(tab: &MeasuredTab) -> bool {
    tab.width > 0
        && tab.width <= MAX_TAB_WIDTH
        && tab.r#type >= 0
        && tab.r#type <= MAX_TAB_KIND
        && tab.fill >= 0
        && tab.fill <= MAX_TAB_FILL
}

pub fn apply_measured_tabs(
    bytes: &[u8],
    format: MobileDocFormat,
    measured: &[MeasuredTab],
) -> Vec<u8> {
    if format != MobileDocFormat::Hwp || measured.is_empty() {
        return bytes.to_vec();
    }
    let info = inspect_hwp5_inner(bytes);
    if !info.valid || info.encrypted || info.distribution {
        return bytes.to_vec();
    }
    let mut by_key: BTreeMap<String, &MeasuredTab> = BTreeMap::new();
    for m in measured {
        if valid_measure(m) {
            by_key.insert(spot_key(m.sec, m.para, &m.cells, m.tab), m);
        }
    }
    if by_key.is_empty() {
        return bytes.to_vec();
    }

    let mut payloads = Vec::new();
    let mut manifest_entries = Vec::new();

    for sec in 0..info.sections {
        let path = format!("/BodyText/Section{sec}");
        let Some(mut data) = read_stream_inner(bytes, &path, info.compressed) else {
            continue;
        };
        let Some(records) = parse_records_inner(&data) else {
            continue;
        };
        let mut found = Vec::new();
        walk_hwp_list(&data, &records, 0, records.len(), 0, sec, None, &[], &mut found);
        let mut modified = false;
        for f in found {
            let key = spot_key(f.spot.sec, f.spot.para, &f.spot.cells, f.spot.tab);
            if let Some(m) = by_key.get(&key) {
                let width = m.width as u32;
                let kind_fill = (((m.r#type + 1) as u16) << 8) | (m.fill as u16 & 0x00ff);
                data[f.at..f.at + 4].copy_from_slice(&width.to_le_bytes());
                data[f.at + 4..f.at + 6].copy_from_slice(&kind_fill.to_le_bytes());
                modified = true;
            }
        }
        if modified {
            let offset = payloads.len();
            payloads.extend_from_slice(&data);
            manifest_entries.push(serde_json::json!({
                "path": path,
                "offset": offset,
                "length": data.len(),
                "plain": false,
            }));
        }
    }

    if manifest_entries.is_empty() {
        return bytes.to_vec();
    }
    let manifest_json = serde_json::Value::Array(manifest_entries).to_string();
    rewrite_streams_inner(bytes, &manifest_json, &payloads).unwrap_or_else(|| bytes.to_vec())
}
