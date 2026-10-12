use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// An API error rendered as `{ "error": "..." }`.
pub(crate) struct ApiError(StatusCode, String);

impl ApiError {
    pub(crate) fn bad_request(msg: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, msg.into())
    }

    pub(crate) fn not_found(msg: impl Into<String>) -> Self {
        Self(StatusCode::NOT_FOUND, msg.into())
    }

    pub(crate) fn internal(msg: &impl std::fmt::Display) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, msg.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

pub(crate) type ApiResult<T> = Result<T, ApiError>;

/// Runs blocking work (gh, git, disk) off the async runtime.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> ApiResult<T> {
    match tokio::task::spawn_blocking(f).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(ApiError::internal(&format!("{e:#}"))),
        Err(e) => Err(ApiError::internal(&e)),
    }
}
