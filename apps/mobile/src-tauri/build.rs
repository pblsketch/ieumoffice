// T1 sheets: builds and links the spreadsheet engine library.
#[path = "src/sheets/engine_build.rs"]
mod t1_sheets_engine_build;

fn main() {
    println!("cargo:rerun-if-env-changed=IEUM_MOBILE_CHATGPT_CLIENT_ID");
    // Re-embed frontend assets whenever Vite outputs a fresh dist/index.html.
    println!("cargo:rerun-if-changed=../dist/index.html");
    // Enforce 16KB ELF LOAD segment alignment on Android regardless of NDK default.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build();

    // T1 sheets
    t1_sheets_engine_build::build_and_link();
}
