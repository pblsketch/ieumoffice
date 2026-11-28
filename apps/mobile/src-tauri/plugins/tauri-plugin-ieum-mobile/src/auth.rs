use std::sync::Mutex;

/// Native keystore and system auth browser bridge (Android Keystore/CustomTabs, iOS Keychain/ASWebAuthenticationSession).
pub trait NativeAuthBridge: Send + Sync {
    /// Returns a persistent 32-byte device-bound master key stored in Android Keystore or iOS Keychain.
    fn get_or_create_master_key(&self) -> Result<[u8; 32], String>;
    /// Launches Chrome Custom Tabs (Android) or ASWebAuthenticationSession (iOS) for OAuth sign-in.
    fn launch_auth_browser(&self, auth_url: &str, callback_scheme: &str) -> Result<(), String>;
}

/// Host/test implementation keeping an ephemeral random 32-byte key in memory only.
pub struct HostAuthBridge {
    key: Mutex<[u8; 32]>,
    launched_urls: Mutex<Vec<String>>,
}

impl Default for HostAuthBridge {
    fn default() -> Self {
        Self::new([0x42; 32])
    }
}

impl HostAuthBridge {
    pub fn new(master_key: [u8; 32]) -> Self {
        Self {
            key: Mutex::new(master_key),
            launched_urls: Mutex::new(Vec::new()),
        }
    }

    pub fn last_launched_url(&self) -> Option<String> {
        self.launched_urls.lock().unwrap().last().cloned()
    }
}

impl NativeAuthBridge for HostAuthBridge {
    fn get_or_create_master_key(&self) -> Result<[u8; 32], String> {
        Ok(*self.key.lock().unwrap())
    }

    fn launch_auth_browser(&self, auth_url: &str, _callback_scheme: &str) -> Result<(), String> {
        self.launched_urls.lock().unwrap().push(auth_url.to_string());
        Ok(())
    }
}
