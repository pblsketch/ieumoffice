use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::MobileDocFormat;
use std::io::{Cursor, Read};

const OLE2_MAGIC: &[u8; 8] = &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC: &[u8; 4] = &[0x50, 0x4b, 0x03, 0x04];

/// Result of inspecting an HWP 5 (OLE2) or HWPX (ZIP) container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HwpInspection {
    pub valid: bool,
    pub encrypted: bool,
    pub distribution: bool,
    pub tracked: bool,
    pub has_view_text: bool,
    pub sections: usize,
}

/// Prepared bytes ready for opening in rhwp, plus metadata flags.
#[derive(Debug, Clone)]
pub struct PreparedHwpOpen {
    pub bytes: Vec<u8>,
    pub tracking_dropped: bool,
    pub encrypted: bool,
    pub distribution: bool,
}

pub fn validate_hwp_magic(bytes: &[u8], format: MobileDocFormat) -> MobileResult<()> {
    match format {
        MobileDocFormat::Hwp => {
            if bytes.len() < OLE2_MAGIC.len() || &bytes[..OLE2_MAGIC.len()] != OLE2_MAGIC {
                return Err(MobileError::with_detail(
                    MobileErrorCode::CorruptContainer,
                    "mobile.hwp.corruptContainer",
                    "missing OLE2 HWP5 header",
                ));
            }
            let info = hwp5_wasm::inspect_hwp5_inner(bytes);
            if !info.valid {
                return Err(MobileError::with_detail(
                    MobileErrorCode::CorruptContainer,
                    "mobile.hwp.corruptContainer",
                    "invalid HWP5 FileHeader or structure",
                ));
            }
            Ok(())
        }
        MobileDocFormat::Hwpx => {
            if bytes.len() < ZIP_MAGIC.len() || &bytes[..ZIP_MAGIC.len()] != ZIP_MAGIC {
                return Err(MobileError::with_detail(
                    MobileErrorCode::CorruptContainer,
                    "mobile.hwp.corruptContainer",
                    "missing ZIP header for HWPX",
                ));
            }
            zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| {
                MobileError::with_detail(
                    MobileErrorCode::CorruptContainer,
                    "mobile.hwp.corruptContainer",
                    "unreadable HWPX ZIP archive",
                )
            })?;
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn inspect_hwp_container(bytes: &[u8], format: MobileDocFormat) -> HwpInspection {
    match format {
        MobileDocFormat::Hwp => {
            let info = hwp5_wasm::inspect_hwp5_inner(bytes);
            HwpInspection {
                valid: info.valid,
                encrypted: info.encrypted,
                distribution: info.distribution,
                tracked: info.tracked,
                has_view_text: info.has_view_text,
                sections: info.sections,
            }
        }
        MobileDocFormat::Hwpx => inspect_hwpx_zip(bytes),
        _ => HwpInspection {
            valid: false,
            encrypted: false,
            distribution: false,
            tracked: false,
            has_view_text: false,
            sections: 0,
        },
    }
}

fn inspect_hwpx_zip(bytes: &[u8]) -> HwpInspection {
    let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return HwpInspection {
            valid: false,
            encrypted: false,
            distribution: false,
            tracked: false,
            has_view_text: false,
            sections: 0,
        };
    };
    let mut encrypted = false;
    let mut distribution = false;
    let mut sections = 0usize;
    let mut has_manifest = false;
    for idx in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(idx) else {
            continue;
        };
        let name = entry.name().to_string();
        if name.eq_ignore_ascii_case("META-INF/manifest.xml") {
            has_manifest = true;
            let mut xml = String::new();
            if entry.read_to_string(&mut xml).is_ok()
                && (xml.contains("encryption-data") || xml.contains("odf:encryption-data"))
            {
                encrypted = true;
            }
        } else if name.eq_ignore_ascii_case("settings.xml")
            || name.eq_ignore_ascii_case("Contents/header.xml")
        {
            let mut xml = String::new();
            if entry.read_to_string(&mut xml).is_ok()
                && (xml.contains("distribute=\"1\"") || xml.contains("distribution=\"true\""))
            {
                distribution = true;
            }
        } else if name.to_ascii_lowercase().starts_with("contents/section")
            && name.to_ascii_lowercase().ends_with(".xml")
        {
            sections += 1;
        }
    }
    HwpInspection {
        valid: has_manifest || sections > 0,
        encrypted,
        distribution,
        tracked: false,
        has_view_text: false,
        sections,
    }
}

/// Inspects an HWP/HWPX file on open and strips HWP5 tracked-changes copy when present.
pub fn prepare_hwp_for_open(bytes: Vec<u8>, format: MobileDocFormat) -> MobileResult<PreparedHwpOpen> {
    let info = inspect_hwp_container(&bytes, format);
    if !info.valid {
        return Err(MobileError::with_detail(
            MobileErrorCode::CorruptContainer,
            "mobile.hwp.corruptContainer",
            "corrupt HWP container",
        ));
    }
    if format == MobileDocFormat::Hwp
        && info.tracked
        && info.has_view_text
        && !info.encrypted
        && !info.distribution
        && let Some(stripped) = hwp5_wasm::strip_tracked_changes_inner(&bytes)
    {
        return Ok(PreparedHwpOpen {
            bytes: stripped,
            tracking_dropped: true,
            encrypted: false,
            distribution: false,
        });
    }
    Ok(PreparedHwpOpen {
        bytes,
        tracking_dropped: false,
        encrypted: info.encrypted,
        distribution: info.distribution,
    })
}
