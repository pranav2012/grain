//! Who may use Grain. It listens on 127.0.0.1, so every request comes from this computer: a page
//! open here, or Tailscale relaying one of the reviewer's own devices (`grain share`). The address
//! a request was sent to is checked as well, so a website that points its own name at 127.0.0.1
//! (DNS rebinding) gets nothing.

use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use grain_store::Share;

use crate::state::Shared;

/// Set by `tailscale serve` to the Tailscale login of whoever made the request; it drops any
/// copy the device itself sent.
const TAILSCALE_LOGIN: &str = "tailscale-user-login";

pub(crate) async fn guard(State(app): State<Shared>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok());
    let login = headers.get(TAILSCALE_LOGIN).and_then(|h| h.to_str().ok());
    match check(host, login, || app.home.load_share()) {
        Ok(()) => next.run(request).await,
        Err(why) => {
            tracing::warn!(host, login, why, "refused a request");
            (StatusCode::FORBIDDEN, why).into_response()
        }
    }
}

/// The host name without its port, lowercased.
fn name(host: &str) -> String {
    let host = host.trim();
    let bare = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(v6),
        None => host.rsplit_once(':').map_or(host, |(name, _)| name),
    };
    bare.trim_end_matches('.').to_ascii_lowercase()
}

fn is_local(name: &str) -> bool {
    name == "localhost" || name.ends_with(".localhost") || name == "127.0.0.1" || name == "::1"
}

/// Whether a request may go through: local addresses always, the tailnet name only for the
/// login `grain share` was set up for.
fn check(host: Option<&str>, login: Option<&str>, share: impl FnOnce() -> Option<Share>) -> Result<(), &'static str> {
    let Some(host) = host.map(name) else {
        // Only raw clients on this computer leave the address out; browsers and Tailscale always send it.
        return Ok(());
    };
    if is_local(&host) && login.is_none() {
        return Ok(());
    }
    let Some(share) = share() else {
        return Err("Grain only answers on this computer. Run `grain share` to open it from your other devices.");
    };
    if host != name(&share.host) {
        return Err("Grain doesn't answer at this address.");
    }
    if login.is_none_or(|l| !l.eq_ignore_ascii_case(&share.login)) {
        return Err("This Grain is only shared with its owner's Tailscale login.");
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps, reason = "matches check's share loader")]
mod tests {
    use super::*;

    fn shared() -> Option<Share> {
        Some(Share { host: "mac.tail1.ts.net".into(), login: "me@example.com".into(), https: true, port: 443 })
    }

    #[test]
    fn this_computer_is_always_let_in() {
        for host in ["localhost:7420", "grain.localhost", "127.0.0.1:7420", "[::1]:7420"] {
            assert!(check(Some(host), None, || None).is_ok(), "{host}");
        }
        assert!(check(None, None, || None).is_ok());
    }

    #[test]
    fn other_names_are_refused() {
        assert!(check(Some("evil.example:7420"), None, || None).is_err());
        assert!(check(Some("evil.example"), None, shared).is_err());
        assert!(check(Some("mac.tail1.ts.net"), None, || None).is_err());
    }

    #[test]
    fn the_tailnet_name_needs_the_owners_login() {
        assert!(check(Some("mac.tail1.ts.net"), Some("me@example.com"), shared).is_ok());
        assert!(check(Some("MAC.tail1.ts.net."), Some("Me@Example.com"), shared).is_ok());
        assert!(check(Some("mac.tail1.ts.net"), Some("colleague@example.com"), shared).is_err());
        assert!(check(Some("mac.tail1.ts.net"), None, shared).is_err());
    }

    #[test]
    fn a_relayed_request_to_a_local_name_still_needs_the_owner() {
        assert!(check(Some("127.0.0.1:7420"), Some("colleague@example.com"), shared).is_err());
    }
}
