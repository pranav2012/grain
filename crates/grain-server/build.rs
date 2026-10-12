//! Makes sure `ui/dist` exists so the UI can be embedded. When the UI hasn't been built,
//! a placeholder page explains how to build it instead of failing the Rust build.

use std::path::Path;

fn main() {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(&dist).expect("create ui/dist");
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>Grain</title><body style=\"font:15px system-ui;padding:3em;background:#16181d;color:#e4e6ea\">\
             <h1>The Grain UI isn't built</h1><p>Run <code>pnpm --dir ui install && pnpm --dir ui build</code>, then rebuild Grain.</p>",
        )
        .expect("write placeholder ui/dist/index.html");
    }
}
