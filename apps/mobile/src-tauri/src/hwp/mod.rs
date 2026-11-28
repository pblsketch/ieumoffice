pub mod container;
pub mod fields;
pub mod preview;
pub mod tabs;
pub mod tails;

pub use container::{
    HwpInspection, PreparedHwpOpen, inspect_hwp_container, prepare_hwp_for_open, validate_hwp_magic,
};
pub use fields::{FieldKindsBaseline, extract_field_kinds, restore_field_kinds};
pub use preview::{SavePreviewInput, write_preview_parts};
pub use tabs::{MeasuredTab, TabCellStep, TabSpot, apply_measured_tabs, find_new_tabs};
pub use tails::{SectionTailsBaseline, extract_section_tails, restore_section_tails};

use crate::storage::MobileDocFormat;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoSnapshot {
    pub author: String,
    pub date: Option<String>,
    pub text: String,
    pub place: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HwpFixPayload {
    pub format: MobileDocFormat,
    #[serde(default)]
    pub measured_tabs: Vec<MeasuredTab>,
    #[serde(default)]
    pub preview: Option<SavePreviewInput>,
    #[serde(default)]
    pub memos: Option<Vec<MemoSnapshot>>,
}

#[derive(Debug, Clone, Default)]
pub struct HwpBaseline {
    pub field_kinds: Option<FieldKindsBaseline>,
    pub section_tails: Option<SectionTailsBaseline>,
}

pub struct HwpSaveFixOutcome {
    pub bytes: Vec<u8>,
    pub tails_lost: bool,
    pub memos_lost: usize,
}

pub fn extract_hwp_baseline(bytes: &[u8], format: MobileDocFormat) -> HwpBaseline {
    if format != MobileDocFormat::Hwp {
        return HwpBaseline::default();
    }
    HwpBaseline {
        field_kinds: extract_field_kinds(bytes),
        section_tails: extract_section_tails(bytes),
    }
}

pub fn apply_hwp_save_fixes(
    bytes: Vec<u8>,
    format: MobileDocFormat,
    baseline: Option<&HwpBaseline>,
    fix: Option<&HwpFixPayload>,
) -> HwpSaveFixOutcome {
    let mut current = bytes;
    let mut tails_lost = false;
    if let Some(fix) = fix
        && !fix.measured_tabs.is_empty()
    {
        current = apply_measured_tabs(&current, format, &fix.measured_tabs);
    }
    if let Some(base) = baseline {
        if let Some(kinds) = &base.field_kinds {
            current = restore_field_kinds(&current, kinds);
        }
        if let Some(tails) = &base.section_tails {
            let (next, lost) = restore_section_tails(&current, tails);
            current = next;
            tails_lost = lost;
        }
    }
    if let Some(fix) = fix
        && let Some(preview) = &fix.preview
    {
        current = write_preview_parts(&current, format, preview);
    }
    HwpSaveFixOutcome {
        bytes: current,
        tails_lost,
        memos_lost: 0,
    }
}
