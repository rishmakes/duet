fn main() {
    // whisper.cpp's Metal code asks which macOS it runs on, which needs clang's own small runtime
    // library. A plain link on GitHub's Macs leaves it out, so name it here.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        if let Ok(out) = std::process::Command::new("clang").arg("--print-resource-dir").output() {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let lib = std::path::Path::new(&dir).join("lib/darwin");
            if lib.join("libclang_rt.osx.a").exists() {
                println!("cargo:rustc-link-search=native={}", lib.display());
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
        }
    }
    tauri_build::build()
}
