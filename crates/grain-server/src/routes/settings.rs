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
