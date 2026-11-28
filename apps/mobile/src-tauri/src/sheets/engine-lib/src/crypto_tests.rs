//! The XLS-T4 crypto matrix as app tests: every sample decrypts with its
//! password, refuses a wrong one, and the unsupported ones are told apart.
//!
//! Samples (`tests/fixtures/crypto/`):
//! - `example_password.xlsx`, `ecma376agile_sha1_password.xlsx`,
//!   `rc4cryptoapi_password.xls`, `xor_password_123456789012345.xls`,
//!   `plain.xls`: msoffcrypto-tool's test inputs (MIT, see the LICENSE file
//!   there), made by Office. `*.plain.xlsx` is what they decrypt to.
//! - `small.xlsx` and its copies the desktop encrypted (`small.pc-agile.xlsx`,
//!   `small.pc-standard.xlsx`, written by officecrypto-tool through
//!   `packages/electron-utils/src/office-encryption.ts`) and the phone
//!   encrypted (`small.mobile-agile.xlsx`, this crate's `encrypt`; the
//!   desktop decrypts it in `apps/mobile/tests/sheets-crypto-pc.test.ts`).
//! - `plain.rc4-97.xls`: `plain.xls` locked with Office 97 RC4 by the T4
//!   script (no Office-made sample of that scheme was available).
//! - `unsupported-extensible.xlsx` (rights-managed encryption header),
//!   `unsupported-filepass-v9.xls` (an unknown FILEPASS version),
//!   `not-office.bin` (random bytes).
//! - `apps/docs/tests/encrypted-fixtures/office-*-password.docx`: the same
//!   OOXML schemes in Word files, already in the repository.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::SheetsEngine;
use crate::cfb_fat::normalize_fat;
use crate::crypto::{
    CODE_DAMAGED, CODE_INVALID_REQUEST, CODE_NOT_ENCRYPTED, CODE_UNSUPPORTED, CODE_WRONG_PASSWORD,
    decrypt, encrypt, handle_crypto_line, probe,
};

const PC_PASSWORD: &str = "비밀번호 pw1";
const OFFICE_PASSWORD: &str = "Password1234_";
const WRONG: &str = "wrong-Pw9";

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/crypto")
        .join(name)
}

fn docs_fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../../docs/tests/encrypted-fixtures")
        .join(name)
}

fn work_dir() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn decrypt_ok(source: &Path, password: &str) -> (Vec<u8>, &'static str) {
    let dir = work_dir();
    let target = dir.path().join("plain.out");
    let document = decrypt(source, &target, password)
        .unwrap_or_else(|failure| panic!("{}: {failure:?}", source.display()));
    (fs::read(&target).unwrap(), document)
}

fn decrypt_code(source: &Path, password: &str) -> &'static str {
    let dir = work_dir();
    let target = dir.path().join("plain.out");
    let failure = decrypt(source, &target, password).expect_err("decrypt should fail");
    assert!(!target.exists(), "a failed decrypt leaves no file behind");
    failure.code
}

/// The cells the engine's `.xls` conversion reads (what the phone opens).
fn converted_cells(xls: &Path) -> Value {
    let dir = work_dir();
    let source = dir.path().join("in.xls");
    fs::copy(xls, &source).unwrap();
    let target = dir.path().join("out.xlsx");
    let engine = SheetsEngine::new(Some(dir.path().to_path_buf()));
    let line = json!({
        "version": 1, "requestId": "c", "command": "convert_workbook",
        "path": source, "targetPath": target,
    })
    .to_string();
    let answer = serde_json::to_value(engine.handle_line(&line)).unwrap();
    assert_eq!(answer["ok"], json!(true), "{answer}");
    answer["result"]["cells"].clone()
}

#[test]
fn office_made_ooxml_samples_decrypt_to_their_plain_package() {
    for (name, plain) in [
        ("example_password.xlsx", "example_password.plain.xlsx"),
        (
            "ecma376agile_sha1_password.xlsx",
            "ecma376agile_sha1_password.plain.xlsx",
        ),
    ] {
        let (bytes, document) = decrypt_ok(&fixture(name), OFFICE_PASSWORD);
        assert_eq!(document, "ooxml", "{name}");
        assert_eq!(bytes, fs::read(fixture(plain)).unwrap(), "{name}");
        assert_eq!(
            decrypt_code(&fixture(name), WRONG),
            CODE_WRONG_PASSWORD,
            "{name}"
        );
    }
    for (name, plain) in [
        ("office-agile-password.docx", "office-agile-plain.docx"),
        (
            "office-standard-password.docx",
            "office-standard-plain.docx",
        ),
    ] {
        let (bytes, _) = decrypt_ok(&docs_fixture(name), OFFICE_PASSWORD);
        assert_eq!(bytes, fs::read(docs_fixture(plain)).unwrap(), "{name}");
        assert_eq!(
            decrypt_code(&docs_fixture(name), WRONG),
            CODE_WRONG_PASSWORD
        );
    }
}

#[test]
fn workbooks_the_desktop_encrypted_decrypt_byte_for_byte() {
    let plain = fs::read(fixture("small.xlsx")).unwrap();
    for name in ["small.pc-agile.xlsx", "small.pc-standard.xlsx"] {
        // Without the FAT fix-up the cfb crate refuses these containers.
        let mut raw = fs::read(fixture(name)).unwrap();
        assert!(normalize_fat(&mut raw) > 0, "{name} needs the FAT fix-up");
        let (bytes, document) = decrypt_ok(&fixture(name), PC_PASSWORD);
        assert_eq!(document, "ooxml");
        assert_eq!(bytes, plain, "{name}");
        assert_eq!(
            decrypt_code(&fixture(name), WRONG),
            CODE_WRONG_PASSWORD,
            "{name}"
        );
    }
}

#[test]
fn legacy_xls_samples_decrypt_to_the_same_cells() {
    let plain_cells = converted_cells(&fixture("plain.xls"));
    for (name, password) in [
        ("rc4cryptoapi_password.xls", OFFICE_PASSWORD),
        ("plain.rc4-97.xls", "rc4pass"),
    ] {
        let dir = work_dir();
        let target = dir.path().join("plain.xls");
        assert_eq!(decrypt(&fixture(name), &target, password), Ok("xls"));
        assert_eq!(converted_cells(&target), plain_cells, "{name}");
        assert_eq!(
            decrypt_code(&fixture(name), WRONG),
            CODE_WRONG_PASSWORD,
            "{name}"
        );
    }
    let (bytes, document) = decrypt_ok(
        &fixture("xor_password_123456789012345.xls"),
        "123456789012345",
    );
    assert_eq!(document, "xls");
    assert!(!bytes.is_empty());
    assert_eq!(
        decrypt_code(&fixture("xor_password_123456789012345.xls"), WRONG),
        CODE_WRONG_PASSWORD
    );
}

#[test]
fn unsupported_schemes_and_other_files_are_told_apart() {
    assert_eq!(
        decrypt_code(&fixture("unsupported-extensible.xlsx"), "anything1"),
        CODE_UNSUPPORTED
    );
    assert_eq!(
        decrypt_code(&fixture("unsupported-filepass-v9.xls"), "anything1"),
        CODE_UNSUPPORTED
    );
    assert_eq!(
        decrypt_code(&fixture("not-office.bin"), "anything1"),
        CODE_NOT_ENCRYPTED
    );
    assert_eq!(decrypt_code(&fixture("plain.xls"), "x"), CODE_NOT_ENCRYPTED);
    assert_eq!(
        decrypt_code(&fixture("small.xlsx"), "x"),
        CODE_NOT_ENCRYPTED
    );
}

#[test]
fn probe_reports_encryption_and_whether_it_can_be_opened() {
    let found = |name: &str| {
        let found = probe(&fixture(name)).unwrap();
        (found.encrypted, found.supported, found.document)
    };
    assert_eq!(found("small.xlsx"), (false, false, "other"));
    assert_eq!(found("plain.xls"), (false, false, "xls"));
    assert_eq!(found("small.pc-agile.xlsx"), (true, true, "ooxml"));
    assert_eq!(found("small.pc-standard.xlsx"), (true, true, "ooxml"));
    assert_eq!(found("example_password.xlsx"), (true, true, "ooxml"));
    assert_eq!(found("rc4cryptoapi_password.xls"), (true, true, "xls"));
    assert_eq!(found("plain.rc4-97.xls"), (true, true, "xls"));
    assert_eq!(
        found("xor_password_123456789012345.xls"),
        (true, true, "xls")
    );
    assert!(!found("unsupported-extensible.xlsx").1);
    assert!(!found("unsupported-filepass-v9.xls").1);
    assert!(!found("not-office.bin").0);
}

#[test]
fn encrypt_writes_what_decrypt_and_the_desktop_format_expect() {
    let dir = work_dir();
    let locked = dir.path().join("locked.xlsx");
    encrypt(&fixture("small.xlsx"), &locked, PC_PASSWORD).unwrap();
    let found = probe(&locked).unwrap();
    assert_eq!((found.encrypted, found.supported), (true, true));
    let class = msoffice_crypto::classify(&fs::read(&locked).unwrap());
    // The desktop's officecrypto-tool writes ECMA-376 agile too.
    assert_eq!(class.family, msoffice_crypto::Family::Agile);
    let (bytes, _) = decrypt_ok(&locked, PC_PASSWORD);
    assert_eq!(bytes, fs::read(fixture("small.xlsx")).unwrap());
    assert_eq!(decrypt_code(&locked, WRONG), CODE_WRONG_PASSWORD);

    // The committed phone-encrypted sample still decrypts (the desktop test reads it).
    let (bytes, _) = decrypt_ok(&fixture("small.mobile-agile.xlsx"), PC_PASSWORD);
    assert_eq!(bytes, fs::read(fixture("small.xlsx")).unwrap());

    // An existing target is never overwritten.
    let failure = encrypt(&fixture("small.xlsx"), &locked, PC_PASSWORD).unwrap_err();
    assert_eq!(failure.code, "io");
}

#[test]
fn a_tampered_package_is_refused_as_damaged() {
    let dir = work_dir();
    let mut bytes = fs::read(fixture("small.mobile-agile.xlsx")).unwrap();
    // Flip one byte near the end, inside the encrypted package stream.
    let at = bytes.len() - 600;
    bytes[at] ^= 0x5a;
    let tampered = dir.path().join("tampered.xlsx");
    fs::write(&tampered, &bytes).unwrap();
    assert_eq!(decrypt_code(&tampered, PC_PASSWORD), CODE_DAMAGED);
}

#[test]
fn the_line_protocol_keeps_paths_inside_the_work_folder() {
    let dir = work_dir();
    let root = dir.path().to_path_buf();
    let source = root.join("in.xlsx");
    fs::copy(fixture("small.pc-agile.xlsx"), &source).unwrap();
    let target = root.join("out.xlsx");

    let probe_answer: Value = serde_json::from_str(&handle_crypto_line(
        Some(&root),
        &json!({ "op": "probe", "path": source }).to_string(),
    ))
    .unwrap();
    assert_eq!(
        probe_answer,
        json!({ "ok": true, "result": { "encrypted": true, "supported": true, "document": "ooxml" } })
    );

    let wrong: Value = serde_json::from_str(&handle_crypto_line(
        Some(&root),
        &json!({ "op": "decrypt", "source": source, "target": target, "password": WRONG })
            .to_string(),
    ))
    .unwrap();
    assert_eq!(wrong["ok"], json!(false));
    assert_eq!(wrong["error"]["code"], json!(CODE_WRONG_PASSWORD));

    let ok: Value = serde_json::from_str(&handle_crypto_line(
        Some(&root),
        &json!({ "op": "decrypt", "source": source, "target": target, "password": PC_PASSWORD })
            .to_string(),
    ))
    .unwrap();
    assert_eq!(ok, json!({ "ok": true, "result": { "document": "ooxml" } }));

    let outside: Value = serde_json::from_str(&handle_crypto_line(
        Some(&root),
        &json!({ "op": "probe", "path": fixture("small.xlsx") }).to_string(),
    ))
    .unwrap();
    assert_eq!(outside["error"]["code"], json!(CODE_INVALID_REQUEST));

    let malformed: Value =
        serde_json::from_str(&handle_crypto_line(Some(&root), r#"{"op":"melt"}"#)).unwrap();
    assert_eq!(malformed["error"]["code"], json!(CODE_INVALID_REQUEST));
}

#[test]
fn the_c_boundary_answers_crypto_lines() {
    let dir = work_dir();
    let root = dir.path().to_path_buf();
    let source = root.join("in.xlsx");
    fs::copy(fixture("small.xlsx"), &source).unwrap();
    let root_text = root.to_str().unwrap();
    // SAFETY: valid pointers for the duration of each call; freed once.
    unsafe {
        let engine = crate::ieum_sheets_engine_new(root_text.as_ptr(), root_text.len());
        assert!(!engine.is_null());
        let line = json!({ "op": "probe", "path": source }).to_string();
        let mut len = 0usize;
        let out =
            crate::ieum_sheets_engine_crypto_line(engine, line.as_ptr(), line.len(), &mut len);
        let answer: Value = serde_json::from_slice(std::slice::from_raw_parts(out, len)).unwrap();
        crate::ieum_sheets_engine_free_response(out, len);
        crate::ieum_sheets_engine_free(engine);
        assert_eq!(answer["result"]["encrypted"], json!(false));
    }
    assert_eq!(crate::ieum_sheets_engine_abi_version(), 2);
}
