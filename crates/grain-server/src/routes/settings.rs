use axum::Json;
use axum::extract::State;
use grain_store::Settings;

use crate::error::{ApiError, ApiResult};
use crate::state::Shared;

pub(super) async fn get(State(app): State<Shared>) -> Json<Settings> {
    Json(app.settings())
}

/// Saves settings; summaries restart under the new agent and limits.
pub(super) async fn put(State(app): State<Shared>, Json(s): Json<Settings>) -> ApiResult<Json<Settings>> {
    app.home.save_settings(&s).map_err(|e| ApiError::internal(&e))?;
    *app.settings.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = s.clone();
    app.summarizers.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clear();
    Ok(Json(s))
}

/// This month's AI spend, in total and per PR.
pub(super) async fn usage(State(app): State<Shared>) -> Json<crate::contract::UsageReport> {
    let month = grain_store::local_day(
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()),
    )[..7]
        .to_string();
    let mut by_pr: std::collections::BTreeMap<String, (f64, usize)> = std::collections::BTreeMap::new();
    for r in app.home.usage_records().into_iter().filter(|r| r.day.starts_with(&month)) {
        let e = by_pr.entry(r.pr).or_default();
        e.0 += r.usage.cost_usd;
        e.1 += 1;
    }
    let mut prs: Vec<crate::contract::PrSpend> =
        by_pr.into_iter().map(|(pr, (cost, requests))| crate::contract::PrSpend { pr, cost, requests }).collect();
    prs.sort_by(|a, b| b.cost.total_cmp(&a.cost).then_with(|| a.pr.cmp(&b.pr)));
    Json(crate::contract::UsageReport { spend: app.home.spend(None), prs })
}
