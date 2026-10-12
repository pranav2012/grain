//! Minimal LSP client over stdio: requests with timeouts, notifications, and empty answers to
//! the server's own requests (configuration, progress).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

type Pending = Arc<Mutex<HashMap<u64, Sender<Value>>>>;

pub(crate) struct Client {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next_id: u64,
}

fn write_message(stdin: &Mutex<ChildStdin>, msg: &Value) -> Result<()> {
    let body = msg.to_string();
    let mut w = stdin.lock().unwrap_or_else(PoisonError::into_inner);
    write!(w, "Content-Length: {}\r\n\r\n{body}", body.len())?;
    w.flush()?;
    Ok(())
}

fn read_message(r: &mut impl BufRead) -> Option<Value> {
    let mut length = 0usize;
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Content-Length:") {
            length = v.trim().parse().ok()?;
        }
    }
    let mut body = vec![0; length];
    r.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

impl Client {
    /// Starts `program args…` in `root` and reads its messages on a background thread.
    pub(crate) fn start(program: &Path, args: &[&str], root: &Path) -> Result<Client> {
        let mut child = Command::new(program)
            .args(args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("start {}", program.display()))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().context("no stdin")?));
        let stdout = child.stdout.take().context("no stdout")?;
        let pending: Pending = Arc::default();
        let (reader_pending, reader_stdin) = (pending.clone(), stdin.clone());
        std::thread::spawn(move || {
            let mut r = BufReader::new(stdout);
            while let Some(msg) = read_message(&mut r) {
                match (msg.get("id").and_then(Value::as_u64), msg.get("method")) {
                    (Some(id), None) => {
                        let tx = reader_pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
                        if let Some(tx) = tx {
                            let _ = tx.send(msg);
                        }
                    }
                    (_, Some(_)) if msg.get("id").is_some() => {
                        let reply = json!({ "jsonrpc": "2.0", "id": msg["id"], "result": null });
                        let _ = write_message(&reader_stdin, &reply);
                    }
                    _ => {}
                }
            }
        });
        Ok(Client { child, stdin, pending, next_id: 0 })
    }

    pub(crate) fn request(&mut self, method: &str, params: &Value, timeout: Duration) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let (tx, rx) = channel();
        self.pending.lock().unwrap_or_else(PoisonError::into_inner).insert(id, tx);
        write_message(&self.stdin, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let Ok(reply) = rx.recv_timeout(timeout) else {
            self.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
            bail!("{method} timed out");
        };
        if let Some(err) = reply.get("error") {
            bail!("{method}: {}", err["message"].as_str().unwrap_or("error"));
        }
        Ok(reply["result"].clone())
    }

    pub(crate) fn notify(&self, method: &str, params: &Value) -> Result<()> {
        write_message(&self.stdin, &json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.request("shutdown", &Value::Null, Duration::from_secs(2));
        let _ = self.notify("exit", &Value::Null);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::read_message;

    #[test]
    fn reads_framed_messages() {
        let body = r#"{"id":1,"result":[]}"#;
        let raw = format!("Content-Length: {}\r\nContent-Type: x\r\n\r\n{body}", body.len());
        let mut r = raw.as_bytes();
        assert_eq!(read_message(&mut r).unwrap_or_default()["id"], 1);
        assert!(read_message(&mut r).is_none());
    }
}
