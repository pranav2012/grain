use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};

/// The built UI (`ui/dist`), embedded at build time in every profile (`GRAIN_UI_DIR` serves from disk).
#[derive(rust_embed::Embed)]
#[folder = "../../ui/dist"]
struct Assets;

/// Serves an embedded asset, falling back to `index.html` for client-side routes.
pub(crate) async fn embedded(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let (path, file) = match Assets::get(path).filter(|_| !path.is_empty()) {
        Some(file) => (path, file),
        None => match Assets::get("index.html") {
            Some(file) => ("index.html", file),
            None => return StatusCode::NOT_FOUND.into_response(),
        },
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    // Vite fingerprints everything under assets/, so it can be cached forever.
    let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    ([(header::CONTENT_TYPE, mime.as_ref()), (header::CACHE_CONTROL, cache)], file.data).into_response()
}
