//! Build-time half of track T1 (sheets), compiled into `build.rs` (it is not
//! part of the app's module tree): builds the spreadsheet engine library
//! (`engine-lib/`) in its own cargo invocation and links it into the app.
//!
//! Why a separate cargo invocation: inside the app's workspace cargo would
//! unify the engine's dependency features with the app's (zip 9 switches
//! flate2 to zlib-rs and changes HWP/HWPX saved bytes), and the library must
//! be built with `panic = "unwind"` while the app's release profile aborts.
//!
//! How it is linked, per target:
//! - Android, iOS, Linux, macOS: the library is built as a `staticlib`, then
//!   prelinked into one relocatable object in which every symbol except the
//!   `ieum_sheets_engine_*` C functions is made local. That object carries its
//!   own copy of std and its own panic runtime without clashing with the
//!   app's (two plain Rust static libraries in one binary would). It is
//!   wrapped in `libieum_sheets_engine.a` and linked like any C library, so
//!   the APK needs no extra `.so` and the iOS app no extra framework (rustc
//!   bundles the archive into the app's own static library for Xcode).
//!   ELF targets use the `rust-lld` and `rust-objcopy` shipped with rustc;
//!   Apple targets use Xcode's `ld -r -exported_symbols_list` and `libtool`.
//! - Windows (host tests only): a `cdylib`, linked through its import
//!   library; the DLL is copied next to it in `OUT_DIR`, which `cargo test`
//!   puts on the DLL search path.
//!
//! Environment:
//! - `IEUM_SHEETS_ENGINE_TARGET_DIR`: the library's cargo target directory
//!   (default: `ieum-sheets-engine` in the app's target directory).
//! - Debug builds enable the library's `test-panic` feature and set
//!   `cfg(ieum_sheets_test_panic)` for the app's tests.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const LIB_NAME: &str = "ieum_sheets_engine";

/// The library's C ABI; everything else in the prelinked object is local.
const EXPORTS: &[&str] = &[
    "ieum_sheets_engine_abi_version",
    "ieum_sheets_engine_new",
    "ieum_sheets_engine_handle_line",
    "ieum_sheets_engine_free_response",
    "ieum_sheets_engine_free",
];

fn env_path(key: &str) -> PathBuf {
    PathBuf::from(env::var_os(key).unwrap_or_else(|| panic!("{key} is not set")))
}

fn run(command: &mut Command, what: &str) {
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("T1 sheets: could not start {what}: {error}"));
    assert!(status.success(), "T1 sheets: {what} failed ({status})");
}

pub fn build_and_link() {
    let manifest_dir = env_path("CARGO_MANIFEST_DIR");
    let lib_dir = manifest_dir.join("src").join("sheets").join("engine-lib");
    let engine_dir = manifest_dir.join("../../sheets/native/xlsx-engine");
    for watched in [
        lib_dir.join("Cargo.toml"),
        lib_dir.join("Cargo.lock"),
        lib_dir.join("src"),
        engine_dir.join("Cargo.toml"),
        engine_dir.join("src"),
        manifest_dir
            .join("src")
            .join("sheets")
            .join("engine_build.rs"),
    ] {
        println!("cargo:rerun-if-changed={}", watched.display());
    }
    println!("cargo:rerun-if-env-changed=IEUM_SHEETS_ENGINE_TARGET_DIR");
    println!("cargo::rustc-check-cfg=cfg(ieum_sheets_test_panic)");

    let target = env::var("TARGET").expect("TARGET is not set");
    let out_dir = env_path("OUT_DIR");
    let test_panic = env::var("PROFILE").as_deref() == Ok("debug");
    let target_dir = env::var_os("IEUM_SHEETS_ENGINE_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_target_dir(&out_dir, &target));
    let windows = target.contains("-windows-");

    let mut cargo = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    cargo
        .current_dir(&lib_dir)
        .args(["rustc", "--lib", "--release", "--locked", "--manifest-path"])
        .arg(lib_dir.join("Cargo.toml"))
        .args(["--target", &target, "--crate-type"])
        .arg(if windows { "cdylib" } else { "staticlib" })
        .arg("--target-dir")
        .arg(&target_dir);
    if test_panic {
        cargo.args(["--features", "test-panic"]);
    }
    // The nested build must use only the library's own settings: drop what
    // cargo set for this build script and the app's profile/flag overrides.
    for (key, _) in env::vars_os() {
        let Some(key) = key.to_str() else { continue };
        if key == "CARGO_TARGET_DIR"
            || key == "CARGO_ENCODED_RUSTFLAGS"
            || key == "RUSTC_WORKSPACE_WRAPPER"
            || key.starts_with("CARGO_PROFILE_")
            || key.starts_with("CARGO_BUILD_")
            || key.starts_with("CARGO_FEATURE_")
            || key.starts_with("CARGO_CFG_")
            || matches!(
                key,
                "OUT_DIR" | "TARGET" | "HOST" | "PROFILE" | "OPT_LEVEL" | "DEBUG" | "NUM_JOBS"
            )
        {
            cargo.env_remove(key);
        }
    }
    run(&mut cargo, "the sheets engine library build");

    let release_dir = target_dir.join(&target).join("release");
    if windows {
        link_windows_dll(&release_dir, &out_dir, &target);
    } else {
        let staticlib = release_dir.join(format!("lib{LIB_NAME}.a"));
        let archive = out_dir.join(format!("lib{LIB_NAME}.a"));
        if target.contains("-apple-") {
            prelink_macho(&staticlib, &out_dir, &archive, &target);
        } else {
            prelink_elf(&staticlib, &out_dir, &archive);
        }
        println!("cargo:rustc-link-search=native={}", out_dir.display());
        println!("cargo:rustc-link-lib=static={LIB_NAME}");
    }
    if test_panic {
        println!("cargo:rustc-cfg=ieum_sheets_test_panic");
    }
}

/// `<app target dir>/ieum-sheets-engine`, found from `OUT_DIR`
/// (`<dir>[/<triple>]/<profile>/build/<package>-<hash>/out`).
fn default_target_dir(out_dir: &Path, target: &str) -> PathBuf {
    let mut root = out_dir
        .ancestors()
        .nth(4)
        .expect("unexpected OUT_DIR layout");
    if root.file_name().and_then(|name| name.to_str()) == Some(target) {
        root = root.parent().expect("unexpected OUT_DIR layout");
    }
    root.join("ieum-sheets-engine")
}

fn link_windows_dll(release_dir: &Path, out_dir: &Path, target: &str) {
    let dll = format!("{LIB_NAME}.dll");
    fs::copy(release_dir.join(&dll), out_dir.join(&dll)).expect("copy the engine DLL");
    let (import_from, import_to) = if target.ends_with("-msvc") {
        (format!("{LIB_NAME}.dll.lib"), format!("{LIB_NAME}.lib"))
    } else {
        (
            format!("lib{LIB_NAME}.dll.a"),
            format!("lib{LIB_NAME}.dll.a"),
        )
    };
    fs::copy(release_dir.join(import_from), out_dir.join(import_to))
        .expect("copy the engine import library");
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=dylib={LIB_NAME}");
}

/// rustc's own LLVM tools (`rust-lld`, `rust-objcopy`) for the build host.
fn rustc_tool(name: &str) -> PathBuf {
    let rustc = env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let output = Command::new(rustc)
        .args(["--print", "sysroot"])
        .output()
        .expect("run rustc --print sysroot");
    let sysroot = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let host = env::var("HOST").expect("HOST is not set");
    let exe = if host.contains("-windows-") {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    let tool = sysroot
        .join("lib")
        .join("rustlib")
        .join(host)
        .join("bin")
        .join(exe);
    assert!(tool.is_file(), "T1 sheets: {} not found", tool.display());
    tool
}

/// ELF (Android, Linux): `ld -r` pulls the library's members reachable from
/// the exports into one object, `objcopy` makes every other defined symbol
/// local, and the object is wrapped in an archive.
///
/// `--force-group-allocation` dissolves COMDAT groups. The library has one,
/// `DW.ref.rust_eh_personality` (the pointer its unwind tables use to find
/// its personality routine); the app's own std has a group of the same name,
/// and the final link would keep only one of the two, leaving the library's
/// unwind tables pointing into the app's copy.
fn prelink_elf(staticlib: &Path, out_dir: &Path, archive: &Path) {
    let object = out_dir.join(format!("{LIB_NAME}.o"));
    let mut ld = Command::new(rustc_tool("rust-lld"));
    ld.args(["-flavor", "gnu", "-r", "--force-group-allocation", "-o"])
        .arg(&object);
    for symbol in EXPORTS {
        ld.args(["-u", symbol]);
    }
    ld.arg(staticlib);
    run(&mut ld, "rust-lld -r (engine prelink)");

    let mut objcopy = Command::new(rustc_tool("rust-objcopy"));
    objcopy.arg("--strip-debug");
    for symbol in EXPORTS {
        objcopy.arg(format!("--keep-global-symbol={symbol}"));
    }
    objcopy.arg(&object);
    run(&mut objcopy, "rust-objcopy (engine symbol hiding)");

    let bytes = fs::read(&object).expect("read the prelinked engine object");
    fs::write(archive, gnu_archive("engine.o", &bytes, EXPORTS)).expect("write the engine archive");
}

/// A GNU `ar` archive holding one object, with the symbol index linkers
/// need (`ranlib` output for that single member). `member` must fit the
/// 15-character short-name field.
fn gnu_archive(member: &str, object: &[u8], symbols: &[&str]) -> Vec<u8> {
    fn header(out: &mut Vec<u8>, name: &str, size: usize) {
        let text = format!("{name:<16}{:<12}{:<6}{:<6}{:<8}{size:<10}`\n", 0, 0, 0, 644);
        assert_eq!(text.len(), 60);
        out.extend_from_slice(text.as_bytes());
    }
    let mut names = Vec::new();
    for symbol in symbols {
        names.extend_from_slice(symbol.as_bytes());
        names.push(0);
    }
    let index_len = 4 + 4 * symbols.len() + names.len();
    let member_offset = 8 + 60 + index_len + index_len % 2;
    let member_offset = u32::try_from(member_offset).expect("small index");

    let mut out = b"!<arch>\n".to_vec();
    header(&mut out, "/", index_len);
    out.extend_from_slice(&u32::try_from(symbols.len()).unwrap().to_be_bytes());
    for _ in symbols {
        out.extend_from_slice(&member_offset.to_be_bytes());
    }
    out.extend_from_slice(&names);
    if index_len % 2 == 1 {
        out.push(b'\n');
    }
    header(&mut out, &format!("{member}/"), object.len());
    out.extend_from_slice(object);
    if object.len() % 2 == 1 {
        out.push(b'\n');
    }
    out
}

/// Mach-O (iOS, macOS): Xcode's `ld -r` with an exported-symbols list turns
/// every other symbol local in one object (what Xcode's "single-object
/// prelink" does), and `libtool` wraps it. Needs Xcode, as any iOS build does.
fn prelink_macho(staticlib: &Path, out_dir: &Path, archive: &Path, target: &str) {
    let sdk = if target.ends_with("-ios-sim") || target.starts_with("x86_64-apple-ios") {
        "iphonesimulator"
    } else if target.contains("-apple-ios") {
        "iphoneos"
    } else {
        "macosx"
    };
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let list = out_dir.join(format!("{LIB_NAME}.exports"));
    let names: String = EXPORTS
        .iter()
        .map(|symbol| format!("_{symbol}\n"))
        .collect();
    fs::write(&list, names).expect("write the export list");
    let object = out_dir.join(format!("{LIB_NAME}.o"));
    let mut ld = Command::new("xcrun");
    ld.args([
        "-sdk",
        sdk,
        "ld",
        "-r",
        "-arch",
        arch,
        "-exported_symbols_list",
    ])
    .arg(&list)
    .arg("-o")
    .arg(&object);
    for symbol in EXPORTS {
        ld.arg("-u").arg(format!("_{symbol}"));
    }
    ld.arg(staticlib);
    run(&mut ld, "xcrun ld -r (engine prelink)");

    let _ = fs::remove_file(archive);
    let mut libtool = Command::new("xcrun");
    libtool
        .args(["-sdk", sdk, "libtool", "-static", "-o"])
        .arg(archive)
        .arg(&object);
    run(&mut libtool, "xcrun libtool (engine archive)");
}
