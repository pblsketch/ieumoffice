// T1 sheets: builds and links the spreadsheet engine library.
#[path = "src/sheets/engine_build.rs"]
mod t1_sheets_engine_build;

fn main() {
    println!("cargo:rerun-if-env-changed=IEUM_MOBILE_CHATGPT_CLIENT_ID");
    tauri_build::build();

    // T1 sheets
    t1_sheets_engine_build::build_and_link();
}
