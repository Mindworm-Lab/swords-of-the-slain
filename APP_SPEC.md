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
| **Animated Fog-of-War** | Per-tile columnar emergence with height-based reveal/conceal, remembered column state, frontier desync | P0 |
| **Procedural Dungeons** | Cellular automata or BSP generator, rooms + corridors, valid start position | P0 |
| **Fog Frontier FX** | Noise filter on visibility frontier, per-tile height jitter, stagger delay ripple | P1 |
| **UI Shell** | Title screen branded "Swords of the Slain", minimap, HUD placeholders | P1 |
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

This section is the engineering specification for the signature visual effect: **columnar LOS reassembly**. Each tile is rendered as a short vertical column (prism) that rises from or sinks into an abyssal void. Visibility is mapped to *height*, not opacity — the dungeon physically assembles itself at the frontier of the player's perception.

### 4.1 Design Language

The effect is best described as **columnar line-of-sight reassembly** with **per-tile height-driven transitions** and **depth-coded emergence**. Three key properties distinguish it from conventional fog-of-war:

1. **Per-tile reconstitution**: Unseen space is not merely dimmed — it is *withheld from the world model*. Tiles are reconstituted individually as vertical columns when they enter vision, creating the feeling that the dungeon assembles itself at the edge of awareness.

2. **Height-as-knowledge**: Visibility is expressed as a *spatial dimension*. Visible tiles are full-height columns with lit side faces; remembered tiles are shorter, quieter columns; hidden tiles are void. This maps knowledge to physical height, making the edge feel tactile and architectural rather than flat.

3. **Continuous frontier agitation**: The boundary never looks frozen. Per-tile desynchronization — seeded height jitter, staggered timing, distance-based ripple delays — makes the frontier feel actively recomputed on every step.

### 4.2 Tile Visibility States

Each tile exists in one of three states:

| State | Visual | Transition Into |
|---|---|---|
| **Hidden** | Void — no column rendered, abyss background visible | N/A (default state) |
| **Visible** | Full-height column (`COLUMN_MAX_HEIGHT` = 12px extrusion) with visible palette, bevel highlights, lit side faces | Animate IN: column rises from below (height 0 → max, y-offset max → 0) |
| **Remembered** | Short column (`COLUMN_REMEMBERED_HEIGHT` = 4px extrusion) with desaturated/darkened palette | On conceal: animate OUT (column sinks), then snap to short remembered column |

**Important**: Remembered tiles are NOT alpha-dimmed flat tiles. They are a distinct visual state — shorter columns rendered with a separate quieter color palette. This preserves the architectural language across all visibility states.

### 4.3 Column Geometry

Each tile column is a top-down compatible vertical prism composed of distinct surfaces:

```
┌──────────────────────────┐  ← 2px lighter bevel (top edge)
│  ╔══════════════════════╗│
│  ║                      ║│  ← Top Cap: TILE_SIZE × TILE_SIZE
│  ║    (tile color +     ║│     Floor/Wall base color with
│  ║     deterministic    ║│     per-tile jitter (±8 amplitude)
│  ║     color jitter)    ║│
│  ║                      ║│
│  ╚══════════════════════╝│
│                       ▕▕▕│  ← 1px darker bevel (bottom/right edges)
├──────────────────────────┤
│  Front Body Face         │  ← TILE_SIZE × columnHeight
│  (4-band depth fade      │     Vertical extrusion below top cap
│   from face color        │     Fades from tile face color toward
│   → abyss 0x0a0a12)     │     abyss color (0x0a0a12) in 4 bands
│                       ▕▕▕│  ← Right-edge highlight strip (3px)
│                       ▕▕▕│     Lighter band suggesting second face
├──────────────────────────┤
│  ░░ Contact Shadow ░░░░░ │  ← 2px at column base
└──────────────────────────┘     Darkened strip grounding column in void
```

**Top Cap**: The primary tile surface. `TILE_SIZE × TILE_SIZE` rectangle rendered at the tile's grid position. Colored with the tile's base color (floor or wall) plus deterministic per-tile color jitter for organic texture. Bevel highlights: 2px lighter strip on top and left edges, 1px darker strip on bottom and right edges.

**Front Body Face**: Vertical extrusion below the top cap. Width = `TILE_SIZE`, height = `columnHeight` (animated during transitions). Rendered with a 4-band vertical depth fade from the tile's face color down to the abyss color (`0x0a0a12`). This creates the illusion of the column descending into darkness.

**Right-Edge Highlight Strip**: A 3px-wide lighter band on the right side of the front body face, suggesting a second (right) face without rendering a full additional surface. Adds dimensionality at minimal draw cost.

**Contact Shadow**: A 2px darkened strip at the base of the column body, grounding the column against the void and providing ambient occlusion.

**Deterministic Color Jitter**: Per-tile color variation uses a seeded hash: `h = (x * 374761 + y * 668265) | 0` followed by two rounds of `h = ((h >> 16) ^ h) * 0x45d9f3b`. This produces stable, non-random variation — the same tile always gets the same jitter across frames and revisits.

### 4.4 Color Palettes

Visible and remembered states use distinct palettes to reinforce the height-as-knowledge mapping:

| Surface | Visible Palette | Remembered Palette |
|---|---|---|
| Floor top cap | `0x3a3a4a` (cool grey) | `0x252530` (dark grey-blue) |
| Wall top cap | `0x5a4a3a` (warm brown-grey) | `0x3a3228` (muted dark brown) |
| Jitter amplitude | ±8 per channel | ±4 per channel |
| Body face | Depth fade → `0x0a0a12` (abyss) | Depth fade → `0x0a0a12` (abyss) |
| Bevel highlights | +20 brightness (top/left) | +12 brightness (top/left) |
| Bevel shadows | −15 brightness (bottom/right) | −10 brightness (bottom/right) |

The remembered palette is intentionally desaturated and darkened — *not* simply the visible palette with reduced alpha. This avoids the visual confusion of translucent tiles and creates a clear quiet/loud distinction.

### 4.5 Reveal / Conceal Animation

There is ONE animation mode: **columnar emergence**. No toggle, no mode selection.

**Reveal** (tile enters line of sight):
- Tween `{ columnHeight: 0, yOffset: COLUMN_MAX_HEIGHT }` → `{ columnHeight: COLUMN_MAX_HEIGHT, yOffset: 0 }`
- Easing: `power2.out` (fast rise, gentle settle)
- Base duration: 400ms (±50ms per-tile variance)
- The column appears to rise from the abyss into its final position

**Conceal** (tile leaves line of sight):
- Tween `{ columnHeight: COLUMN_MAX_HEIGHT, yOffset: 0 }` → `{ columnHeight: 0, yOffset: COLUMN_MAX_HEIGHT }`
- Easing: `power2.in` (gentle start, accelerating descent)
- Base duration: 400ms (±50ms per-tile variance)
- On completion: snap to remembered state (short column, remembered palette)

**Column heights**:
- `COLUMN_MAX_HEIGHT` = 12px (visible state)
- `COLUMN_REMEMBERED_HEIGHT` = 4px (remembered state — no animation, static short column)

### 4.6 Per-Tile Desynchronization

To prevent the frontier from looking mechanical:

- **Stagger delay**: Each frontier tile receives a delay of 0–150ms based on its distance from the player. Closer tiles animate first, creating an outward ripple.
- **Duration variance**: Each tile's animation duration varies by ±50ms around the 400ms base, seeded deterministically.
- **Height jitter**: Each tile's final column height varies by ±2px from the nominal `COLUMN_MAX_HEIGHT`, computed via the same deterministic hash used for color jitter. This creates an irregular, organic frontier edge rather than a flat uniform surface.
- **Result**: The frontier ripples outward from the player with staggered, jagged column heights — the dungeon appears to reconstitute itself in a wave rather than a uniform ring.

### 4.7 LOS Algorithm

- **Method**: Symmetric shadowcasting (Mingos' Restrictive Precise Angle Shadowcasting or similar)
- **Input**: Player position, vision radius (default 8-10 tiles), wall map
- **Output**: Set of visible tile coordinates
- **Per-move diff**: Compare previous visible set to new visible set to determine:
  - `entering`: tiles that just became visible (animate IN — columnar rise)
  - `exiting`: tiles that just left vision (animate OUT — columnar sink)
  - `stable`: tiles that remain visible (no animation)
- **Performance**: Must complete in <1ms for 80x80 map

### 4.8 Frontier Visual Effects (P1)

Applied to the frontier container holding tiles in the `entering` or `exiting` sets:

- **NoiseFilter**: Animated noise overlay on the frontier container creates computational shimmer at the boundary of perception. Applied at the container level, not per-tile.
- **Performance budget**: Filter applied to one container (typically holding 20-40 tile columns), not to the entire scene.

### 4.9 Architecture

```
React Shell (DOM)
  └── PixiJS Stage (@pixi/react)
        ├── Remembered Layer (batched Graphics)
        │     └── Short quiet columns (COLUMN_REMEMBERED_HEIGHT=4px)
        │     └── Remembered palette, desaturated, static
        ├── Visible Layer (batched Graphics)
        │     └── Full-height columns (COLUMN_MAX_HEIGHT=12px)
        │     └── Visible palette, bevel highlights, side faces
        │     └── Player sprite
        ├── Frontier Layer (individual Graphics + GSAP + NoiseFilter)
        │     └── Animated columns entering/exiting visibility
        │     └── Per-tile GSAP tweens on { columnHeight, yOffset }
        │     └── Stagger delays, duration variance, height jitter
        └── UI Overlay Layer (PixiJS)
              └── Minimap, indicators
```

**Batching strategy**: Stable tiles (visible + remembered) are drawn into shared `Graphics` objects (2-4 draw calls total for potentially 1000+ tiles). Only frontier tiles (~20-40 at any time) are individual `Graphics` objects with GSAP tweens. On animation completion, frontier tiles transfer to the appropriate batched layer.

### 4.10 Performance Targets

| Metric | Target |
|---|---|
| Frame rate | Stable 60fps |
| LOS computation | <1ms per move |
| Frontier animation | <40 tile columns animating simultaneously |
| Map size support | 100x100+ tiles |
| Memory | Stable tiles batched into shared Graphics objects |
| Draw calls | 4-6 (remembered batch + visible batch + frontier container + UI) |

## 5. Key Design Principles

1. **GPU-Rendered Board**: The fog-of-war effect requires per-tile transforms, filters, and render-to-texture — not achievable at quality with DOM/CSS.
2. **Authoritative Server** (future): All game state mutations will happen server-side. Clients send input intents only.
3. **Separation of Concerns**: Simulation (backend) has zero frontend dependencies. Client has zero game-logic dependencies.
4. **Progressive Enhancement**: Start with the visual core (tilemap + fog), layer gameplay on top in future iterations.
5. **Tween Everything**: Every state change should be animated. Columnar emergence, camera follow, UI transitions — if something changes, it should tween, not snap. Height is the primary animation axis for visibility; opacity is a secondary tool, not the default.
6. **Height-as-Knowledge**: Visibility is mapped to a spatial dimension (column height), not just a visual filter (opacity/saturation). This makes the fog-of-war feel architectural and tactile rather than cosmetic.

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
