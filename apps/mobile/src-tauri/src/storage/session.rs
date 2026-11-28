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
}

impl MobileDocFormat {
    pub fn from_name(name: &str) -> Self {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".hwpx") {
            Self::Hwpx
        } else if lower.ends_with(".hwp") {
            Self::Hwp
        } else if lower.ends_with(".txt") {
            Self::Txt
        } else {
            Self::Md
        }
    }

    pub fn ext(self) -> &'static str {
        match self {
            Self::Hwp => "hwp",
            Self::Hwpx => "hwpx",
            Self::Md => "md",
            Self::Txt => "txt",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Hwp => "application/x-hwp",
            Self::Hwpx => "application/haansofthwpx",
            Self::Md => "text/markdown",
            Self::Txt => "text/plain",
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
