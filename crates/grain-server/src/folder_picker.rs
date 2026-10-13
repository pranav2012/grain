//! The operating system's own "choose a folder" window. Browsers never reveal a picked folder's
//! full path, so the local server opens it instead.

use std::process::{Command, Output};

use anyhow::{Result, bail};

/// Opens the native folder picker and waits; `None` when the reviewer cancels.
pub(crate) fn pick(prompt: &str) -> Result<Option<String>> {
    let out = if cfg!(target_os = "macos") {
        // `activate` brings the window in front of the browser; argv keeps the prompt out of the script.
        Command::new("osascript")
            .args(["-e", "on run argv", "-e", "activate", "-e"])
            .arg("return POSIX path of (choose folder with prompt (item 1 of argv))")
            .args(["-e", "end run", prompt])
            .output()?
    } else if cfg!(windows) {
        Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command"])
            .arg(
                "Add-Type -AssemblyName System.Windows.Forms; \
                 $d = New-Object System.Windows.Forms.FolderBrowserDialog; \
                 $d.Description = $env:GRAIN_PICK_PROMPT; \
                 $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }; \
                 if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }",
            )
            .env("GRAIN_PICK_PROMPT", prompt)
            .output()?
    } else {
        linux(prompt)?
    };
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !path.is_empty() {
        let trimmed = path.trim_end_matches(['/', '\\']);
        return Ok(Some(if trimmed.is_empty() { path } else { trimmed.to_string() }));
    }
    let err = String::from_utf8_lossy(&out.stderr);
    // Cancel: osascript reports -128, zenity/kdialog/PowerShell just print nothing.
    if err.trim().is_empty() || err.contains("-128") {
        Ok(None)
    } else {
        bail!("The folder picker failed: {}", err.trim())
    }
}

fn linux(prompt: &str) -> Result<Output> {
    let zenity = Command::new("zenity").args(["--file-selection", "--directory", "--title", prompt]).output();
    match zenity {
        Ok(out) => Ok(out),
        Err(_) => {
            Command::new("kdialog").args(["--getexistingdirectory", "~", "--title", prompt]).output().map_err(|_| {
                anyhow::anyhow!(
                    "No folder picker found on this computer (install zenity or kdialog). Type the path instead."
                )
            })
        }
    }
}
