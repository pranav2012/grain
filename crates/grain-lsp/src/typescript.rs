//! Finding TypeScript 7's native compiler (which includes a language server), downloading the
//! official build from npm once when it's missing.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use sha2::{Digest, Sha512};

/// The TypeScript release Grain downloads. Bump deliberately: newer releases may change answers.
pub const VERSION: &str = "7.0.2";

/// npm's platform package suffix for this machine.
fn platform() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("windows", "x86_64") => "win32-x64",
        ("windows", "aarch64") => "win32-arm64",
        _ => return None,
    })
}

fn binary_in(dir: &Path) -> PathBuf {
    dir.join("package").join("lib").join(if cfg!(windows) { "tsc.exe" } else { "tsc" })
}

/// A TypeScript 7 binary that's already available: `GRAIN_TSC`, or Grain's cached download.
pub fn locate(cache_dir: &Path) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("GRAIN_TSC").map(PathBuf::from) {
        return p.is_file().then_some(p);
    }
    let cached = binary_in(&cache_dir.join(format!("typescript-{VERSION}")));
    cached.is_file().then_some(cached)
}

/// [`locate`], downloading the official build into `cache_dir` the first time (~27 MB). The
/// archive is checked against npm's published SHA-512 before anything is unpacked.
pub fn ensure(cache_dir: &Path) -> Result<PathBuf> {
    static DOWNLOAD: Mutex<()> = Mutex::new(());
    let _one_at_a_time = DOWNLOAD.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(p) = locate(cache_dir) {
        return Ok(p);
    }
    let platform = platform().context("TypeScript 7 has no build for this platform")?;
    let package = format!("@typescript/typescript-{platform}");
    let meta: serde_json::Value =
        serde_json::from_slice(&fetch(&format!("https://registry.npmjs.org/{package}/{VERSION}"))?)?;
    let tarball = meta["dist"]["tarball"].as_str().context("npm metadata has no tarball")?;
    let integrity = meta["dist"]["integrity"].as_str().context("npm metadata has no integrity")?;
    let bytes = fetch(tarball)?;
    verify(&bytes, integrity)?;

    std::fs::create_dir_all(cache_dir)?;
    let staging = cache_dir.join(format!(".typescript-{VERSION}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    let archive = staging.join("package.tgz");
    std::fs::write(&archive, &bytes)?;
    let status = Command::new("tar").arg("-xzf").arg(&archive).arg("-C").arg(&staging).status()?;
    std::fs::remove_file(&archive)?;
    if !status.success() || !binary_in(&staging).is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        bail!("couldn't unpack {package}");
    }
    let dest = cache_dir.join(format!("typescript-{VERSION}"));
    std::fs::rename(&staging, &dest)?;
    tracing::info!(version = VERSION, "downloaded TypeScript for precise usage facts");
    Ok(binary_in(&dest))
}

fn fetch(url: &str) -> Result<Vec<u8>> {
    let out = Command::new("curl").args(["-fsSL", "--max-time", "120", url]).output().context("run curl")?;
    if !out.status.success() {
        bail!("download failed: {url}");
    }
    Ok(out.stdout)
}

/// Checks bytes against an npm `sha512-<base64>` integrity string.
fn verify(bytes: &[u8], integrity: &str) -> Result<()> {
    let expected = integrity.strip_prefix("sha512-").context("unsupported integrity format")?;
    let actual = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes));
    if actual != expected {
        bail!("downloaded TypeScript doesn't match npm's checksum");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::verify;

    #[test]
    fn integrity_must_match() {
        // sha512("") in npm's format.
        let empty = "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==";
        assert!(verify(b"", empty).is_ok());
        assert!(verify(b"x", empty).is_err());
        assert!(verify(b"", "sha1-abc").is_err());
    }
}
