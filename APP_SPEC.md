# Swords of the Slain — Application Specification

## Overview

Swords of the Slain is a rogue-like MMO RPG with animated line-of-sight fog-of-war,
procedural dungeons, and a visually compelling navigable gamespace.

## Architecture

### Frontend (`frontend/`)
- **Framework**: Vite + React + TypeScript
- **Renderer**: PixiJS v8 for game board rendering (GPU-accelerated 2D)
- **UI Shell**: React for menus, HUD, lobby, settings
- **Key Libraries**: @pixi/react, gsap (PixiPlugin), pixi-filters
- **Note**: The game board is rendered entirely in PixiJS, NOT DOM-based. React is only for application shell/UI chrome.

### Backend (`backend/`)
- **Language**: Rust
- **Framework**: Axum (async HTTP/WebSocket)
- **Runtime**: Tokio async runtime
- **Responsibilities**: Serves static frontend build, exposes `/api/*` endpoints, authoritative game server

### Deployment
- **Container**: Single Docker multi-stage build (Node for frontend, Rust for backend, Debian slim runtime)
- **Proxy**: NGINX reverse proxy with SSL (certbot/Let's Encrypt)
- **Domain**: nm90f16v.apps.clankie.ai
- **Binding**: App container on 127.0.0.1:3000, NGINX on 80/443 externally
- **Auth**: Basic auth required

## Key Design Principles

1. **GPU-Rendered Board**: The fog-of-war effect requires per-tile transforms, filters, and render-to-texture — not achievable with DOM/CSS.
2. **Authoritative Server**: All game state mutations happen server-side. Clients send input intents.
3. **Separation of Concerns**: Simulation (backend) has zero frontend dependencies. Client has zero game-logic dependencies.

## Development Workflow

- Frontend dev server: `cd frontend && npm run dev` (Vite HMR on port 5173)
- Backend dev server: `cd backend && cargo run` (Axum on port 3000)
- Production build: `docker compose up --build`
