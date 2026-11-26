use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MobileDocFormat {
    Hwp,
    Hwpx,
    Md,
    Txt,
    Pdf,
    Html,
    Xlsx,
    Xlsm,
    Xls,
    Csv,
    Epub,
    Pptx,
}

impl MobileDocFormat {
    /// Maps a file name with a known document extension to its format; returns `None` for
    /// unknown or missing extensions so the open gate can refuse unsupported files.
    pub fn from_known_name(name: &str) -> Option<Self> {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".hwpx") {
            Some(Self::Hwpx)
        } else if lower.ends_with(".hwp") {
            Some(Self::Hwp)
        } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
            Some(Self::Md)
        } else if lower.ends_with(".txt") {
            Some(Self::Txt)
        } else if lower.ends_with(".pdf") {
            Some(Self::Pdf)
        } else if lower.ends_with(".html") || lower.ends_with(".htm") {
            Some(Self::Html)
        } else if lower.ends_with(".xlsx") {
            Some(Self::Xlsx)
        } else if lower.ends_with(".xlsm") {
            Some(Self::Xlsm)
        } else if lower.ends_with(".xls") {
            Some(Self::Xls)
        } else if lower.ends_with(".csv") {
            Some(Self::Csv)
        } else if lower.ends_with(".epub") {
            Some(Self::Epub)
        } else if lower.ends_with(".pptx") {
            Some(Self::Pptx)
        } else {
            None
        }
    }

    pub fn from_name(name: &str) -> Self {
        Self::from_known_name(name).unwrap_or(Self::Md)
    }

    pub fn ext(self) -> &'static str {
        match self {
            Self::Hwp => "hwp",
            Self::Hwpx => "hwpx",
            Self::Md => "md",
            Self::Txt => "txt",
            Self::Pdf => "pdf",
            Self::Html => "html",
            Self::Xlsx => "xlsx",
            Self::Xlsm => "xlsm",
            Self::Xls => "xls",
            Self::Csv => "csv",
            Self::Epub => "epub",
            Self::Pptx => "pptx",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Hwp => "application/x-hwp",
            Self::Hwpx => "application/haansofthwpx",
            Self::Md => "text/markdown",
            Self::Txt => "text/plain",
            Self::Pdf => "application/pdf",
            Self::Html => "text/html",
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Self::Xlsm => "application/vnd.ms-excel.sheet.macroEnabled.12",
            Self::Xls => "application/vnd.ms-excel",
            Self::Csv => "text/csv",
            Self::Epub => "application/epub+zip",
            Self::Pptx => {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            }
        }
    }

    pub fn is_hwp_family(self) -> bool {
        matches!(self, Self::Hwp | Self::Hwpx)
    }
}

/// Session descriptor returned by all open/create/save-as commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDocSession {
    pub session_id: String,
    pub doc_key: String,
    pub name: String,
    pub ext: String,
    pub format: MobileDocFormat,
    pub writable: bool,
    pub ephemeral: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri_hint: Option<String>,
}

/// Deterministic 16-hex-char SHA-256 key for persistent URIs/bookmarks.
pub fn persistent_doc_key(persistent_id: &str) -> String {
    let digest = Sha256::digest(persistent_id.as_bytes());
    let mut hex = String::with_capacity(16);
    for b in &digest[..8] {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

pub fn untitled_doc_key() -> String {
    format!("untitled-{}", Uuid::new_v4())
}
