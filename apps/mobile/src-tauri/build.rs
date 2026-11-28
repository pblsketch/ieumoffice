fn main() {
    println!("cargo:rerun-if-env-changed=IEUM_MOBILE_CHATGPT_CLIENT_ID");
    tauri_build::build();
}
