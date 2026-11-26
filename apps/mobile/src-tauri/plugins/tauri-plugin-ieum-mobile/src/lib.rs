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
    use crate::fs::{
        FolderGrantState, NativeDirs, NativeFileBridge, NativeFolderEntry, NativeFsError,
        NativeFsErrorKind, NativeHomeError, NativeHomeErrorKind, NativeIncomingBatch, PickedFile,
        PickedFolder, WRITE_WORK_RELATIVE_DIR, is_https_url, unique_work_path, write_uri_from_file,
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use serde::{Deserialize, Serialize};
    use std::path::{Path, PathBuf};
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

    /// A document and a local file inside the app cache. Bytes travel through the file, never as
    /// one string argument (Android refuses strings over 20,000,000 characters).
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UriPathArgs<'a> {
        uri: &'a str,
        path: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SharePathArgs<'a> {
        path: &'a str,
        suggested_name: &'a str,
        mime: &'a str,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SizeResp {
        size: u64,
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

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FolderListArgs<'a> {
        uri: &'a str,
        sub_path: &'a [String],
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NameArgs<'a> {
        uri: &'a str,
        new_name: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UrisArgs<'a> {
        uris: &'a [String],
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct KeepScreenOnArgs {
        on: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct UrlArgs<'a> {
        url: &'a str,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GrantResp {
        state: FolderGrantState,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EntriesResp {
        #[serde(default)]
        entries: Vec<NativeFolderEntry>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UriResp {
        uri: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BatchResp {
        #[serde(default)]
        batch: Option<NativeIncomingBatch>,
    }

    /// Maps the `CODE: message` rejections of the native home commands to error kinds.
    fn map_home_invoke_err(err: impl std::fmt::Display) -> NativeHomeError {
        let msg = err.to_string();
        let kind = if msg.contains("USER_CANCELLED") {
            NativeHomeErrorKind::UserCancelled
        } else if msg.contains("NOT_SUPPORTED") {
            NativeHomeErrorKind::NotSupportedHere
        } else if msg.contains("NAME_TAKEN") {
            NativeHomeErrorKind::NameTaken
        } else if msg.contains("NOT_FOUND") {
            NativeHomeErrorKind::NotFound
        } else if msg.contains("INVALID_ARGUMENT") {
            NativeHomeErrorKind::InvalidArgument
        } else if msg.contains("PERMISSION_DENIED") || msg.contains("SecurityException") {
            NativeHomeErrorKind::PermissionDenied
        } else {
            NativeHomeErrorKind::IoError
        };
        NativeHomeError::new(kind, msg)
    }

    pub struct MobilePluginFileBridge<R: Runtime> {
        handle: PluginHandle<R>,
    }

    impl<R: Runtime> MobilePluginFileBridge<R> {
        pub fn new(handle: PluginHandle<R>) -> Self {
            Self { handle }
        }

        /// `<cache>/ieum-tmp/home/write`: temporary copies of a document being read or written.
        fn write_work_dir(&self) -> Result<PathBuf, NativeFsError> {
            let dirs = self.native_dirs().map_err(home_to_fs_error)?;
            let dir = dirs.cache_dir.join(WRITE_WORK_RELATIVE_DIR);
            std::fs::create_dir_all(&dir).map_err(io_error)?;
            Ok(dir)
        }
    }

    fn io_error(e: std::io::Error) -> NativeFsError {
        NativeFsError::new(NativeFsErrorKind::IoError, e.to_string())
    }

    fn home_to_fs_error(e: NativeHomeError) -> NativeFsError {
        NativeFsError::new(NativeFsErrorKind::IoError, e.detail)
    }

    fn path_arg(path: &Path) -> Result<&str, NativeFsError> {
        path.to_str().ok_or_else(|| {
            NativeFsError::new(NativeFsErrorKind::IoError, "non-UTF-8 cache path")
        })
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
            let work = self.write_work_dir()?;
            let tmp = unique_work_path(&work, "read");
            let result = self
                .copy_uri_to_file(uri, &tmp)
                .and_then(|_| std::fs::read(&tmp).map_err(io_error));
            let _ = std::fs::remove_file(&tmp);
            result
        }

        fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
            let work = self.write_work_dir()?;
            let src = unique_work_path(&work, "write");
            std::fs::write(&src, bytes).map_err(io_error)?;
            let result = write_uri_from_file(self, uri, &src, &work);
            let _ = std::fs::remove_file(&src);
            result
        }

        fn copy_uri_to_file(&self, uri: &str, dest: &Path) -> Result<u64, NativeFsError> {
            let path = path_arg(dest)?;
            let resp: SizeResp = self
                .handle
                .run_mobile_plugin("copyUriToFile", UriPathArgs { uri, path })
                .map_err(map_invoke_err)?;
            Ok(resp.size)
        }

        fn stream_file_to_uri(&self, uri: &str, src: &Path) -> Result<u64, NativeFsError> {
            let path = path_arg(src)?;
            let resp: SizeResp = self
                .handle
                .run_mobile_plugin("writeUriFromFile", UriPathArgs { uri, path })
                .map_err(map_invoke_err)?;
            Ok(resp.size)
        }

        fn share_file_bytes(
            &self,
            suggested_name: &str,
            mime: &str,
            bytes: &[u8],
        ) -> Result<(), NativeFsError> {
            let dirs = self.native_dirs().map_err(home_to_fs_error)?;
            let dir = unique_work_path(&dirs.share_temp_dir, "share");
            std::fs::create_dir_all(&dir).map_err(io_error)?;
            let safe_name: String = suggested_name
                .chars()
                .map(|c| if c == '/' || c == '\\' { '_' } else { c })
                .collect();
            let file = dir.join(safe_name);
            std::fs::write(&file, bytes).map_err(io_error)?;
            let path = path_arg(&file)?;
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin(
                    "shareFileFromPath",
                    SharePathArgs {
                        path,
                        suggested_name,
                        mime,
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

        fn pick_folder(&self) -> Result<PickedFolder, NativeHomeError> {
            self.handle
                .run_mobile_plugin("pickFolder", ())
                .map_err(map_home_invoke_err)
        }

        fn release_folder(&self, folder_uri: &str) -> Result<(), NativeHomeError> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("releaseFolder", UriArgs { uri: folder_uri })
                .map_err(map_home_invoke_err)?;
            Ok(())
        }

        fn check_folder_grant(&self, folder_uri: &str) -> FolderGrantState {
            self.handle
                .run_mobile_plugin::<GrantResp>("checkFolderGrant", UriArgs { uri: folder_uri })
                .map(|r| r.state)
                .unwrap_or(FolderGrantState::Revoked)
        }

        fn list_folder(
            &self,
            folder_uri: &str,
            sub_path: &[String],
        ) -> Result<Vec<NativeFolderEntry>, NativeHomeError> {
            let resp: EntriesResp = self
                .handle
                .run_mobile_plugin(
                    "listFolder",
                    FolderListArgs {
                        uri: folder_uri,
                        sub_path,
                    },
                )
                .map_err(map_home_invoke_err)?;
            Ok(resp.entries)
        }

        fn rename_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError> {
            let resp: UriResp = self
                .handle
                .run_mobile_plugin("renameDocument", NameArgs { uri, new_name })
                .map_err(map_home_invoke_err)?;
            Ok(resp.uri)
        }

        fn copy_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError> {
            let resp: UriResp = self
                .handle
                .run_mobile_plugin("copyDocument", NameArgs { uri, new_name })
                .map_err(map_home_invoke_err)?;
            Ok(resp.uri)
        }

        fn delete_document(&self, uri: &str) -> Result<(), NativeHomeError> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("deleteDocument", UriArgs { uri })
                .map_err(map_home_invoke_err)?;
            Ok(())
        }

        fn share_files(&self, uris: &[String]) -> Result<(), NativeHomeError> {
            if uris.is_empty() {
                return Err(NativeHomeError::new(
                    NativeHomeErrorKind::InvalidArgument,
                    "nothing to share",
                ));
            }
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("shareFiles", UrisArgs { uris })
                .map_err(map_home_invoke_err)?;
            Ok(())
        }

        fn take_incoming_batch(&self) -> Option<NativeIncomingBatch> {
            self.handle
                .run_mobile_plugin::<BatchResp>("takePendingIncomingBatch", ())
                .ok()
                .and_then(|r| r.batch)
        }

        fn set_keep_screen_on(&self, on: bool) -> Result<(), NativeHomeError> {
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("setKeepScreenOn", KeepScreenOnArgs { on })
                .map_err(map_home_invoke_err)?;
            Ok(())
        }

        fn open_external_url(&self, url: &str) -> Result<(), NativeHomeError> {
            // Refused here too, so a bad URL never reaches the native side.
            if !is_https_url(url) {
                return Err(NativeHomeError::new(
                    NativeHomeErrorKind::InvalidArgument,
                    "only https URLs are opened",
                ));
            }
            let _: serde_json::Value = self
                .handle
                .run_mobile_plugin("openExternalUrl", UrlArgs { url })
                .map_err(map_home_invoke_err)?;
            Ok(())
        }

        fn native_dirs(&self) -> Result<NativeDirs, NativeHomeError> {
            self.handle
                .run_mobile_plugin("getNativeDirs", ())
                .map_err(map_home_invoke_err)
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
