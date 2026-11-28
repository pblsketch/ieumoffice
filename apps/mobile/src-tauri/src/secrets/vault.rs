use crate::error::{MobileError, MobileErrorCode, MobileResult};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use serde::{Serialize, de::DeserializeOwned};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_ieum_mobile::auth::NativeAuthBridge;

const NONCE_LEN: usize = 12;
const MAGIC_V1: &[u8; 4] = b"ISV1";

/// AES-256-GCM sealed credential storage backed by the device's OS Keystore/Keychain master key.
pub struct SealedVault {
    dir: PathBuf,
    auth_bridge: Arc<dyn NativeAuthBridge>,
}

impl SealedVault {
    pub fn new(app_data_dir: PathBuf, auth_bridge: Arc<dyn NativeAuthBridge>) -> Self {
        Self {
            dir: app_data_dir.join("secrets"),
            auth_bridge,
        }
    }

    fn item_path(&self, name: &str) -> MobileResult<PathBuf> {
        if name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.vault.invalidName",
                "invalid secret slot name",
            ));
        }
        Ok(self.dir.join(format!("{name}.sealed")))
    }

    fn cipher(&self) -> MobileResult<Aes256Gcm> {
        let key = self.auth_bridge.get_or_create_master_key().map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.keyError", e)
        })?;
        Aes256Gcm::new_from_slice(&key).map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InternalError,
                "mobile.vault.cipherInit",
                e.to_string(),
            )
        })
    }

    pub fn write_sealed<T: Serialize>(&self, name: &str, value: &T) -> MobileResult<()> {
        let path = self.item_path(name)?;
        fs::create_dir_all(&self.dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.dirFailed", e.to_string())
        })?;
        let plaintext = serde_json::to_vec(value).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.encodeFailed", e.to_string())
        })?;
        let cipher = self.cipher()?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_slice())
            .map_err(|_| {
                MobileError::new(MobileErrorCode::InternalError, "mobile.vault.encryptFailed")
            })?;

        let mut blob = Vec::with_capacity(MAGIC_V1.len() + NONCE_LEN + ciphertext.len());
        blob.extend_from_slice(MAGIC_V1);
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        let tmp = path.with_extension("sealed.tmp");
        fs::write(&tmp, &blob).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.writeFailed", e.to_string())
        })?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.renameFailed", e.to_string())
        })?;
        Ok(())
    }

    pub fn read_sealed<T: DeserializeOwned>(&self, name: &str) -> MobileResult<Option<T>> {
        let path = self.item_path(name)?;
        if !path.exists() {
            return Ok(None);
        }
        let blob = fs::read(&path).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.readFailed", e.to_string())
        })?;
        if blob.len() <= MAGIC_V1.len() + NONCE_LEN || &blob[..MAGIC_V1.len()] != MAGIC_V1 {
            return Err(MobileError::new(
                MobileErrorCode::InternalError,
                "mobile.vault.corruptBlob",
            ));
        }
        let nonce_start = MAGIC_V1.len();
        let ct_start = nonce_start + NONCE_LEN;
        let cipher = self.cipher()?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(&blob[nonce_start..ct_start]), &blob[ct_start..])
            .map_err(|_| {
                MobileError::new(MobileErrorCode::InternalError, "mobile.vault.decryptFailed")
            })?;
        let decoded = serde_json::from_slice(&plaintext).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.vault.decodeFailed", e.to_string())
        })?;
        Ok(Some(decoded))
    }

    pub fn delete_sealed(&self, name: &str) -> MobileResult<()> {
        let path = self.item_path(name)?;
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }
}
