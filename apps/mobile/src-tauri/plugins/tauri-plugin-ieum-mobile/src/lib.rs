pub mod auth;
pub mod fs;

use crate::auth::{HostAuthBridge, NativeAuthBridge};
use crate::fs::{HostFileBridge, NativeFileBridge};
use std::sync::Arc;
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(mobile)]
mod mobile_bridge {
    use crate::auth::NativeAuthBridge;
    use crate::fs::{NativeFileBridge, NativeFsError, NativeFsErrorKind, PickedFile};
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use serde::{Deserialize, Serialize};
    use tauri::{Runtime, plugin::PluginHandle};

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PickArgs<'a> {
        exts: &'a [String],
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CreateSaveArgs<'a> {
        suggested_name: &'a str,
        mime: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UriArgs<'a> {
        uri: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct WriteArgs<'a> {
        uri: &'a str,
        bytes_base64: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ShareArgs<'a> {
        suggested_name: &'a str,
        mime: &'a str,
        bytes_base64: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BytesResp {
        bytes_base64: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MasterKeyResp {
        key_base64: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LaunchAuthArgs<'a> {
        auth_url: &'a str,
        callback_scheme: &'a str,
    }

    fn map_invoke_err(err: impl std::fmt::Display) -> NativeFsError {
        let msg = err.to_string();
        if msg.contains("USER_CANCELLED") || msg.contains("cancelled") {
            NativeFsError::new(NativeFsErrorKind::UserCancelled, msg)
        } else if msg.contains("PERMISSION_DENIED") || msg.contains("SecurityException") {
            NativeFsError::new(NativeFsErrorKind::PermissionDenied, msg)
        } else if msg.contains("READ_ONLY_URI") {
            NativeFsError::new(NativeFsErrorKind::ReadOnlyUri, msg)
        } else {
            NativeFsError::new(NativeFsErrorKind::IoError, msg)
        }
    }

    pub struct MobilePluginFileBridge<R: Runtime> {
        handle: PluginHandle<R>,
    }

    impl<R: Runtime> MobilePluginFileBridge<R> {
        pub fn new(handle: PluginHandle<R>) -> Self {
            Self { handle }
        }
    }

    impl<R: Runtime> NativeFileBridge for MobilePluginFileBridge<R> {
        fn pick_open_file(&self, exts: &[String]) -> Result<PickedFile, NativeFsError> {
            self.handle
                .run_mobile_plugin("pickOpenFile", PickArgs { exts })
                .map_err(map_invoke_err)
        }

        fn create_save_file(
            &self,
            suggested_name: &str,
            mime: &str,
        ) -> Result<PickedFile, NativeFsError> {
            self.handle
                .run_mobile_plugin("createSaveFile", CreateSaveArgs { suggested_name, mime })
                .map_err(map_invoke_err)
        }

        fn open_persistent_uri(&self, uri: &str) -> Result<PickedFile, NativeFsError> {
            self.handle
                .run_mobile_plugin("openPersistentUri", UriArgs { uri })
                .map_err(map_invoke_err)
        }

        fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError> {
            let resp: BytesResp = self
                .handle
                .run_mobile_plugin("readUriBytes", UriArgs { uri })
                .map_err(map_invoke_err)?;
            B64.decode(&resp.bytes_base64)
                .map_err(|e| NativeFsError::new(NativeFsErrorKind::IoError, e.to_string()))
        }

        fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin(
                    "writeUriBytesAtomic",
                    WriteArgs {
                        uri,
                        bytes_base64: B64.encode(bytes),
                    },
                )
                .map_err(map_invoke_err)?;
            Ok(())
        }

        fn share_file_bytes(
            &self,
            suggested_name: &str,
            mime: &str,
            bytes: &[u8],
        ) -> Result<(), NativeFsError> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin(
                    "shareFileBytes",
                    ShareArgs {
                        suggested_name,
                        mime,
                        bytes_base64: B64.encode(bytes),
                    },
                )
                .map_err(map_invoke_err)?;
            Ok(())
        }

        fn take_pending_open_intent(&self) -> Option<PickedFile> {
            self.handle
                .run_mobile_plugin::<Option<PickedFile>>("takePendingOpenIntent", ())
                .ok()
                .flatten()
        }
    }

    pub struct MobilePluginAuthBridge<R: Runtime> {
        handle: PluginHandle<R>,
    }

    impl<R: Runtime> MobilePluginAuthBridge<R> {
        pub fn new(handle: PluginHandle<R>) -> Self {
            Self { handle }
        }
    }

    impl<R: Runtime> NativeAuthBridge for MobilePluginAuthBridge<R> {
        fn get_or_create_master_key(&self) -> Result<[u8; 32], String> {
            let resp: MasterKeyResp = self
                .handle
                .run_mobile_plugin("getOrCreateMasterKey", ())
                .map_err(|e| e.to_string())?;
            let decoded = B64.decode(&resp.key_base64).map_err(|e| e.to_string())?;
            let arr: [u8; 32] = decoded
                .try_into()
                .map_err(|_| "native keystore master key must be 32 bytes".to_string())?;
            Ok(arr)
        }

        fn launch_auth_browser(
            &self,
            auth_url: &str,
            callback_scheme: &str,
        ) -> Result<(), String> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin(
                    "launchAuthBrowser",
                    LaunchAuthArgs {
                        auth_url,
                        callback_scheme,
                    },
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

/// Managed wrapper holding the platform-selected native file bridge.
pub struct MobileFileBridgeHandle {
    pub file_bridge: Arc<dyn NativeFileBridge>,
}

/// Managed wrapper holding the platform-selected native auth/keystore bridge.
pub struct MobileAuthBridgeHandle {
    pub auth_bridge: Arc<dyn NativeAuthBridge>,
}

/// Returns the active file/share bridge registered by `init_file()`, or a host stub in tests.
pub fn resolve_file_bridge<R: Runtime>(app: &AppHandle<R>) -> Arc<dyn NativeFileBridge> {
    app.try_state::<MobileFileBridgeHandle>()
        .map(|s| s.file_bridge.clone())
        .unwrap_or_else(|| Arc::new(HostFileBridge::new()))
}

/// Returns the active keystore/auth browser bridge registered by `init_auth()`, or a host stub in tests.
pub fn resolve_auth_bridge<R: Runtime>(app: &AppHandle<R>) -> Arc<dyn NativeAuthBridge> {
    app.try_state::<MobileAuthBridgeHandle>()
        .map(|s| s.auth_bridge.clone())
        .unwrap_or_else(|| Arc::new(HostAuthBridge::default()))
}

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ieum_file);
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ieum_auth);

/// Initializes the native OS file/SAF/FileProvider bridge plugin (`ieum-file`).
/// Must be registered under its own plugin name so Android/iOS `PluginManager`
/// keeps both `IeumFilePlugin` and `IeumAuthPlugin` registered simultaneously.
pub fn init_file<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ieum-file")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let file_bridge: Arc<dyn NativeFileBridge> = {
                let file_handle =
                    api.register_android_plugin("com.ieumoffice.mobile.plugin", "IeumFilePlugin")?;
                Arc::new(mobile_bridge::MobilePluginFileBridge::new(file_handle))
            };
            #[cfg(target_os = "ios")]
            let file_bridge: Arc<dyn NativeFileBridge> = {
                let file_handle = api.register_ios_plugin(init_plugin_ieum_file)?;
                Arc::new(mobile_bridge::MobilePluginFileBridge::new(file_handle))
            };
            #[cfg(not(mobile))]
            let file_bridge: Arc<dyn NativeFileBridge> = {
                let _ = api;
                Arc::new(HostFileBridge::new())
            };
            app.manage(MobileFileBridgeHandle { file_bridge });
            Ok(())
        })
        .build()
}

/// Initializes the native OS Keystore/Keychain and Custom Tabs auth plugin (`ieum-auth`).
pub fn init_auth<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ieum-auth")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let auth_bridge: Arc<dyn NativeAuthBridge> = {
                let auth_handle =
                    api.register_android_plugin("com.ieumoffice.mobile.plugin", "IeumAuthPlugin")?;
                Arc::new(mobile_bridge::MobilePluginAuthBridge::new(auth_handle))
            };
            #[cfg(target_os = "ios")]
            let auth_bridge: Arc<dyn NativeAuthBridge> = {
                let auth_handle = api.register_ios_plugin(init_plugin_ieum_auth)?;
                Arc::new(mobile_bridge::MobilePluginAuthBridge::new(auth_handle))
            };
            #[cfg(not(mobile))]
            let auth_bridge: Arc<dyn NativeAuthBridge> = {
                let _ = api;
                Arc::new(HostAuthBridge::default())
            };
            app.manage(MobileAuthBridgeHandle { auth_bridge });
            Ok(())
        })
        .build()
}
