//! ACP transport. Only used with API-key auth: subscription logins must go through the user's own CLI
//! (see docs/COMPLIANCE.md), because ACP adapters for Claude are built on the Agent SDK.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PermissionOptionKind, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome, SessionConfigKind,
    SessionConfigOptionValue, SessionNotification, SessionUpdate, SetSessionConfigOptionRequest, TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo};

fn agent_command(name: &str) -> &'static str {
    match name {
        "claude" => "npx -y @agentclientprotocol/claude-agent-acp",
        "codex" => "npx -y @agentclientprotocol/codex-acp",
        "opencode" => "opencode acp",
        other => panic!("unknown agent {other}"),
    }
}

/// Runs one prompt over ACP and returns the agent's full text reply. Every tool permission is rejected.
pub async fn run(name: &str, prompt: String, model: Option<String>) -> Result<String, Box<dyn std::error::Error>> {
    let text = Arc::new(Mutex::new(String::new()));
    let text_n = text.clone();
    let cwd = PathBuf::from(std::env::temp_dir());
    agent_client_protocol::Client
        .builder()
        .on_receive_notification(
            async move |n: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = n.update {
                    if let ContentBlock::Text(t) = chunk.content {
                        text_n.lock().unwrap().push_str(&t.text);
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |req: RequestPermissionRequest, responder, _cx| {
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
        .connect_with(AcpAgent::from_str(agent_command(name))?, |conn: ConnectionTo<Agent>| async move {
            conn.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
            let session = conn.send_request(NewSessionRequest::new(cwd)).block_task().await?;
            if let Some(want) = model {
                let model_opt = session.config_options.iter().flatten().find(|o| {
                    matches!(o.kind, SessionConfigKind::Select(_)) && o.id.to_string().contains("model")
                });
                if let Some(opt) = model_opt {
                    conn.send_request(SetSessionConfigOptionRequest::new(
                        session.session_id.clone(),
                        opt.id.clone(),
                        SessionConfigOptionValue::value_id(want),
                    ))
                    .block_task()
                    .await?;
                }
            }
            conn.send_request(PromptRequest::new(session.session_id, vec![ContentBlock::Text(TextContent::new(prompt))]))
                .block_task()
                .await?;
            Ok(())
        })
        .await?;
    let out = text.lock().unwrap().clone();
    Ok(out)
}
