# Swords of the Slain — Application Specification

## 1. Game Vision

**Swords of the Slain** is a rogue-like MMO RPG set in procedurally generated dungeons where the world itself feels alive. The dungeon does not merely un-fog; it assembles itself at the edge of your awareness and crumbles away behind you. Every step you take, the frontier of your perception animates — tiles rise into existence, fall away into void, and the boundary between known and unknown shimmers with restless energy.

The core player fantasy: you are an explorer in a hostile, unknowable underworld. The environment rewards caution, punishes recklessness, and constantly reminds you that what lies beyond your torchlight is not just hidden — it is *withheld from the world model entirely*, reconstituted only when your line of sight touches it.

### Aesthetic North Star

The primary visual inspiration is **Rogue Wizards** (Spellbind Studios, 2016) — specifically its animated line-of-sight system where individual tiles rise/fall/materialize as the player moves. The effect creates a sense that the dungeon is being *actively computed* rather than passively revealed. Our implementation aims to capture and extend that feeling with modern GPU-accelerated 2D rendering.

### Long-Term Direction

- Persistent MMO world with multiple players in shared dungeons
- Turn-based tactical combat with spell and equipment systems
- Player-driven economy and item crafting
- Guild systems and cooperative dungeon raids
- Procedurally generated content that scales with player progression

## 2. Iteration-0 Scope

Iteration-0 is a **technical demo** focused on proving the visual and interactive core. It is NOT a game yet — it is a production-grade demonstration of the navigable gamespace with the signature fog-of-war effect.

### Iteration-0 Deliverables

| Feature | Description | Priority |
|---|---|---|
| **Tilemap Renderer** | GPU-rendered tile grid (80x80+), floor/wall distinction, distinct visual appearance | P0 |
| **Player Movement** | Keyboard-driven (WASD/arrows), turn-based (one tile per keypress), wall collision | P0 |
| **Camera System** | Smooth viewport follow on player, works with large maps | P0 |
| **Line-of-Sight** | Raycasting LOS from player position, walls block vision, configurable radius | P0 |
| **Animated Fog-of-War** | Per-tile reveal/conceal with rise/fall animation, dimmed memory state, frontier desync | P0 |
| **Procedural Dungeons** | Cellular automata or BSP generator, rooms + corridors, valid start position | P0 |
| **Fog Frontier FX** | Noise/displacement filters on visibility boundary, optional transition modes | P1 |
| **UI Shell** | Title screen branded "Swords of the Slain", minimap, HUD placeholders, vision mode toggle | P1 |
| **Deployment** | Docker build, NGINX reverse proxy at nm90f16v.apps.clankie.ai, SSL, basic auth | P0 |

### Iteration-0 Non-Goals

- No combat system
- No multiplayer / networking
- No inventory or items
- No NPCs or enemies (beyond visual placeholders)
- No persistence / save system
- No sound or music

## 3. Tech Stack

### Frontend (`frontend/`)

| Layer | Technology | Role |
|---|---|---|
| Build | Vite | Fast dev server with HMR, production bundler |
| UI Shell | React + TypeScript | Menus, HUD, settings — DOM-based chrome only |
| Game Renderer | PixiJS v8 | GPU-accelerated 2D rendering, WebGL |
| React Integration | @pixi/react | Official PixiJS-React bridge for v8 |
| Animation | GSAP + PixiPlugin | Per-tile tweening for fog transitions |
| Visual FX | pixi-filters | Noise, displacement, blur for frontier effects |
| Tilemap (if needed) | @pixi/tilemap v5 | Optimized rectangular tilemap rendering for large maps |

**Critical constraint**: The game board is rendered *entirely* in PixiJS via WebGL. React handles ONLY the application shell (menus, overlays, HUD). No DOM elements participate in the game scene.

### Backend (`backend/`)

| Layer | Technology | Role |
|---|---|---|
| Language | Rust | Performance, safety, correctness |
| Framework | Axum | Async HTTP and WebSocket server |
| Runtime | Tokio | Async runtime |
| Static Serving | tower-http | Serves frontend build artifacts |

The backend in iteration-0 is minimal: serve the frontend static build and expose a `/api/health` endpoint. Future iterations will add authoritative game state, WebSocket real-time communication, and persistence.

### Deployment

| Component | Technology |
|---|---|
| Containerization | Docker multi-stage build (Node → Rust → Debian slim) |
| Orchestration | docker-compose |
| Reverse Proxy | NGINX |
| SSL | Let's Encrypt via certbot |
| Authentication | NGINX basic auth |
| Domain | nm90f16v.apps.clankie.ai |
| App Binding | 127.0.0.1:3000 (container) |

### Development Workflow

- Frontend dev: `cd frontend && npm run dev` → Vite HMR on port 5173
- Backend dev: `cd backend && cargo run` → Axum on port 3000
- Production: `docker compose up --build` → full stack on port 3000

## 4. Fog-of-War Design Brief

This section is the engineering specification for the signature visual effect, derived from analysis of Rogue Wizards' visibility system.

### 4.1 Design Language

The effect is best described as an **animated line-of-sight frontier** with **per-tile visibility transitions** and **depth-coded emergence**. Three key properties distinguish it from conventional fog-of-war:

1. **Per-tile reconstitution**: Unseen space is not merely dimmed — it is *withheld from the world model*. Tiles are reconstituted individually when they enter vision, creating the feeling that the dungeon assembles itself at the edge of awareness.

2. **Depth-coded concealment**: In the default mode, visibility change is expressed as *vertical motion* — tiles rise into place when revealed and fall away when lost. This maps knowledge to depth, not just opacity, making the edge feel tactile and spatial rather than flat.

3. **Continuous frontier agitation**: The boundary never looks frozen. Per-tile desynchronization (staggered timing, varied offsets) makes the frontier feel actively recomputed on every step.

### 4.2 Tile Visibility States

Each tile exists in one of three states:

| State | Visual | Transition Into |
|---|---|---|
| **Hidden** | Not rendered / void | N/A (default) |
| **Visible** | Full brightness, full position | Animate IN: rise from below + fade in + scale up |
| **Remembered** | Dimmed (40-60% opacity), desaturated | Animate OUT: fall below + fade out, then snap to dim remembered render |

### 4.3 Transition Modes

Three selectable transition modes (runtime toggle):

| Mode | Reveal Animation | Conceal Animation |
|---|---|---|
| **Rise / Fall** (default) | Tile rises from -20px below with alpha 0→1 over 300-500ms | Tile falls -20px with alpha 1→0 over 300-500ms |
| **Grow / Shrink** | Tile scales from 0.3→1.0 with alpha 0→1 | Tile scales from 1.0→0.3 with alpha 1→0 |
| **Fade In / Out** | Pure alpha transition 0→1 | Pure alpha transition 1→0 |

### 4.4 Per-Tile Desynchronization

To prevent the frontier from looking mechanical:
- Each tile gets a random delay offset (0–150ms) added to its transition start time
- Each tile gets a slight random duration variance (±50ms)
- Tiles closer to the player animate slightly faster than tiles at the vision edge
- The result: the frontier "ripples" outward from the player rather than appearing as a uniform ring

### 4.5 LOS Algorithm

- **Method**: Symmetric shadowcasting (Mingos' Restrictive Precise Angle Shadowcasting or similar)
- **Input**: Player position, vision radius (default 8-10 tiles), wall map
- **Output**: Set of visible tile coordinates
- **Per-move diff**: Compare previous visible set to new visible set to determine:
  - `entering`: tiles that just became visible (animate IN)
  - `exiting`: tiles that just left vision (animate OUT)
  - `stable`: tiles that remain visible (no animation)
- **Performance**: Must complete in <1ms for 80x80 map

### 4.6 Frontier Visual Effects (P1)

Applied only to tiles in the `entering` or `exiting` sets (the frontier band):
- **DisplacementFilter**: Subtle displacement on frontier tiles to create organic edge
- **NoiseFilter / SimplexNoiseFilter**: Animated noise overlay on transitioning tiles
- **Performance budget**: Filters only on frontier tiles (typically 20-40 tiles), not entire scene

### 4.7 Architecture

```
React Shell (DOM)
  └── PixiJS Stage (@pixi/react)
        ├── Background Layer (static, cached)
        │     └── Floor tiles (explored, not currently visible → remembered state)
        ├── Active Layer (dynamic)
        │     └── Currently visible tiles (full render)
        │     └── Player sprite
        ├── Frontier Layer (animated, filtered)
        │     └── Tiles entering/exiting visibility (GSAP tweens + pixi-filters)
        └── UI Overlay Layer (PixiJS)
              └── Minimap, indicators
```

### 4.8 Performance Targets

| Metric | Target |
|---|---|
| Frame rate | Stable 60fps |
| LOS computation | <1ms per move |
| Frontier animation | <40 tiles animating simultaneously |
| Map size support | 100x100+ tiles |
| Memory | Static tiles cached as textures |

## 5. Key Design Principles

1. **GPU-Rendered Board**: The fog-of-war effect requires per-tile transforms, filters, and render-to-texture — not achievable at quality with DOM/CSS.
2. **Authoritative Server** (future): All game state mutations will happen server-side. Clients send input intents only.
3. **Separation of Concerns**: Simulation (backend) has zero frontend dependencies. Client has zero game-logic dependencies.
4. **Progressive Enhancement**: Start with the visual core (tilemap + fog), layer gameplay on top in future iterations.
5. **Tween Everything**: Following Rogue Wizards' philosophy — every state change should be animated. If something changes, it should tween, not snap.

## 6. Repository Structure

```
swords-of-the-slain/
├── frontend/               # Vite + React + TypeScript + PixiJS
│   ├── src/
│   │   ├── components/     # React UI components (shell, HUD, menus)
│   │   ├── game/           # PixiJS game engine code
│   │   │   ├── tilemap/    # Tilemap rendering and management
│   │   │   ├── fog/        # Fog-of-war system (LOS, animations, filters)
│   │   │   ├── player/     # Player sprite and movement
│   │   │   ├── camera/     # Viewport and camera follow
│   │   │   └── dungeon/    # Procedural generation
│   │   ├── App.tsx         # Root React component
│   │   └── main.tsx        # Entry point
│   ├── public/             # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                # Rust + Axum
│   ├── src/
│   │   └── main.rs         # HTTP server, static file serving, health endpoint
│   └── Cargo.toml
├── APP_SPEC.md             # This file
├── README.md
├── Dockerfile              # Multi-stage build
├── docker-compose.yml
└── .gitignore
```
