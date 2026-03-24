use axum::{
    http::{HeaderValue, Method},
    response::Json,
    routing::get,
    Router,
};
use serde::Serialize;
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
};
use tracing::info;

/// Health check response body.
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

/// GET /api/health — lightweight liveness probe.
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "swords-of-the-slain",
    })
}

/// Build the application router.
///
/// Separated from `main` so integration tests can construct the same
/// router without binding to a TCP port.
pub fn app(static_dir: &str) -> Router {
    // CORS: permissive for local dev, tighten for production
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:5173"
                .parse::<HeaderValue>()
                .expect("valid origin"),
            "http://localhost:3000"
                .parse::<HeaderValue>()
                .expect("valid origin"),
            "http://127.0.0.1:5173"
                .parse::<HeaderValue>()
                .expect("valid origin"),
            "http://127.0.0.1:3000"
                .parse::<HeaderValue>()
                .expect("valid origin"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    // SPA fallback: serve index.html for any path that doesn't match a
    // static file, so client-side routing works.
    let index_path = format!("{}/index.html", static_dir);
    let static_service = ServeDir::new(static_dir).fallback(ServeFile::new(index_path));

    Router::new()
        .route("/api/health", get(health))
        .fallback_service(static_service)
        .layer(cors)
}

#[tokio::main]
async fn main() {
    // Initialise structured logging
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/dist".to_string());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Starting swords-of-the-slain on {addr}");
    info!("Serving static files from {static_dir}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");

    axum::serve(listener, app(&static_dir))
        .await
        .expect("server error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt; // for `oneshot`

    #[tokio::test]
    async fn health_returns_ok() {
        // Use a temp dir as static root — doesn't matter for /api routes
        let app = app("/tmp");

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");

        let json: serde_json::Value = serde_json::from_slice(&body).expect("valid JSON");

        assert_eq!(json["status"], "ok");
        assert_eq!(json["service"], "swords-of-the-slain");
    }
}
