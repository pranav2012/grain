//! Spike C: ask the user's own coding agent (via ACP) for a structured summary of one review block.
//!
//! Usage: acp-agents-spike <claude|codex|opencode> <block.diff> <cwd>

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use agent_client_protocol::schema::v1::{
    AuthMethod, AuthenticateRequest, ContentBlock, InitializeRequest, NewSessionRequest, PermissionOptionKind, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse, SessionConfigKind,
    SessionConfigOptionValue, SessionConfigSelectOptions, SetSessionConfigOptionRequest,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo};

const PROMPT: &str = r#"You are helping a human review one block of a pull request.
Do not use tools, do not read or edit files; answer only from the diff below.
Reply with ONLY a JSON object, no prose, no code fences:
{"title": "<= 8 words, what this block does", "intent": "1-2 sentences on the behavior change",
 "risk": "low|medium|high", "risk_reasons": ["..."], "reviewer_questions": ["2-4 specific questions a careful reviewer should ask"]}

DIFF:
"#;

fn agent_command(name: &str) -> &'static str {
    match name {
        "claude" => "npx -y @agentclientprotocol/claude-agent-acp",
        "codex" => "npx -y @agentclientprotocol/codex-acp",
        "opencode" => "opencode acp",
        other => panic!("unknown agent {other}"),
    }
}

/// Extracts the first top-level JSON object from agent text (tolerates stray prose or fences).
fn extract_json(text: &str) -> Option<serde_json::Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(&text[start..=end]).ok()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let (name, diff_path, cwd) = (&args[1], &args[2], PathBuf::from(&args[3]));
    let diff = std::fs::read_to_string(diff_path)?;
    let prompt = format!("{PROMPT}{diff}");

    let t0 = Instant::now();
    let text = Arc::new(Mutex::new(String::new()));
    let first_token_ms = Arc::new(Mutex::new(None::<u128>));
    let permission_requests = Arc::new(Mutex::new(0usize));
    let (text_n, first_n, perm_n) = (text.clone(), first_token_ms.clone(), permission_requests.clone());

    let agent = AcpAgent::from_str(agent_command(name))?;
    let mut timings = serde_json::Map::new();

    agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |n: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = n.update {
                    if let ContentBlock::Text(t) = chunk.content {
                        first_n.lock().unwrap().get_or_insert(t0.elapsed().as_millis());
                        text_n.lock().unwrap().push_str(&t.text);
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            // Grain never lets an agent act on its own during review: reject every tool permission.
            async move |req: RequestPermissionRequest, responder, _cx| {
                *perm_n.lock().unwrap() += 1;
                let reject = req
                    .options
                    .iter()
                    .find(|o| matches!(o.kind, PermissionOptionKind::RejectOnce | PermissionOptionKind::RejectAlways));
                responder.respond(RequestPermissionResponse::new(match reject {
                    Some(o) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(o.option_id.clone())),
                    None => RequestPermissionOutcome::Cancelled,
                }))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |conn: ConnectionTo<Agent>| {
            let timings = &mut timings;
            async move {
                let init = conn.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
                timings.insert("initMs".into(), (t0.elapsed().as_millis() as u64).into());
                timings.insert("agentInfo".into(), format!("{:?}", init.agent_info.as_ref().map(|i| (&i.name, &i.version))).into());
                eprintln!("auth methods: {:?}", init.auth_methods.iter().map(|m| (m.id().to_string(), m.name().to_string())).collect::<Vec<_>>());
                // Agents may require `authenticate` with an advertised agent-handled method before sessions.
                let session = match conn.send_request(NewSessionRequest::new(cwd.clone())).block_task().await {
                    Ok(s) => s,
                    Err(e) => {
                        let method = init.auth_methods.iter().find(|m| matches!(m, AuthMethod::Agent(_)));
                        let Some(method) = method else { return Err(e) };
                        eprintln!("session failed ({e:?}); authenticating with {}", method.id());
                        conn.send_request(AuthenticateRequest::new(method.id().clone())).block_task().await?;
                        timings.insert("authenticatedWith".into(), method.id().to_string().into());
                        conn.send_request(NewSessionRequest::new(cwd)).block_task().await?
                    }
                };
                // Optional model override (GRAIN_MODEL) through ACP's standard session config options.
                for opt in session.config_options.iter().flatten() {
                    let SessionConfigKind::Select(sel) = &opt.kind else { continue };
                    let values: Vec<String> = match &sel.options {
                        SessionConfigSelectOptions::Ungrouped(v) => v.iter().map(|o| o.value.to_string()).collect(),
                        SessionConfigSelectOptions::Grouped(g) => g.iter().flat_map(|g| g.options.iter().map(|o| o.value.to_string())).collect(),
                        _ => vec![],
                    };
                    eprintln!("config {} = {} ({} choices, e.g. {:?})", opt.id, sel.current_value, values.len(), &values[..values.len().min(6)]);
                    if opt.id.to_string().contains("model") {
                        timings.insert("model".into(), sel.current_value.to_string().into());
                        if let Ok(want) = std::env::var("GRAIN_MODEL") {
                            conn.send_request(SetSessionConfigOptionRequest::new(
                                session.session_id.clone(),
                                opt.id.clone(),
                                SessionConfigOptionValue::value_id(want.clone()),
                            ))
                            .block_task()
                            .await?;
                            timings.insert("model".into(), want.into());
                        }
                    }
                }
                timings.insert("sessionMs".into(), (t0.elapsed().as_millis() as u64).into());
                let resp = conn
                    .send_request(PromptRequest::new(
                        session.session_id,
                        vec![ContentBlock::Text(TextContent::new(prompt))],
                    ))
                    .block_task()
                    .await?;
                timings.insert("stopReason".into(), format!("{:?}", resp.stop_reason).into());
                Ok(())
            }
        })
        .await?;

    let text = text.lock().unwrap().clone();
    let out = serde_json::json!({
        "agent": name,
        "timings": timings,
        "firstTokenMs": *first_token_ms.lock().unwrap(),
        "totalMs": t0.elapsed().as_millis(),
        "permissionRequestsRejected": *permission_requests.lock().unwrap(),
        "validJson": extract_json(&text).is_some(),
        "summary": extract_json(&text).unwrap_or_else(|| serde_json::Value::String(text.clone())),
    });
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
