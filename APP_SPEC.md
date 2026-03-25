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

This section is the engineering specification for the signature visual effect: **columnar LOS reassembly**. Each tile is rendered as a vertical column (prism) with conditional side faces that descend into an abyssal void. Visibility is mapped to *height*, not opacity — the dungeon physically assembles itself at the frontier of the player's perception. Top caps are always pinned at their grid position; animation acts on shaft depth (downward) and alpha, never on vertical displacement of the cap.

### 4.1 Design Language

The effect is best described as **columnar line-of-sight reassembly** with **per-tile height-driven transitions** and **depth-coded emergence**. Three key properties distinguish it from conventional fog-of-war:

1. **Per-tile reconstitution**: Unseen space is not merely dimmed — it is *withheld from the world model*. Tiles are reconstituted individually as vertical columns when they enter vision, creating the feeling that the dungeon assembles itself at the edge of awareness.

2. **Height-as-knowledge**: Visibility is expressed as a *spatial dimension*. Visible tiles are full-height columns with lit side faces; remembered tiles are shorter, quieter columns; hidden tiles are void. This maps knowledge to physical height, making the edge feel tactile and architectural rather than flat.

3. **Event-driven frontier agitation**: The boundary shimmers only while visibility changes are actively animating, then settles to stillness. Per-tile desynchronization — seeded height jitter, staggered timing, distance-based ripple delays — makes the frontier feel actively recomputed on each step, but permanent ambient shimmer is avoided (it reads as a rendering bug).

### 4.2 Tile Visibility States

Each tile exists in one of three states:

| State | Visual | Transition Into |
|---|---|---|
| **Hidden** | Void — no column rendered, abyss background visible | N/A (default state) |
| **Visible** | Full-height column (`COLUMN_MAX_HEIGHT` = 56px shaft) with visible palette, bevel highlights, conditional side faces based on neighbor exposure | Animate IN: top cap fades in at pinned position, shaft grows downward (height 0 → max) |
| **Remembered** | Shorter column (`COLUMN_REMEMBERED_HEIGHT` = 20px shaft) with desaturated/darkened palette, conditional side faces | On conceal: shaft shrinks upward, cap fades out, then snap to remembered column |

**Important**: Remembered tiles are NOT alpha-dimmed flat tiles. They are a distinct visual state — shorter columns rendered with a separate quieter color palette. This preserves the architectural language across all visibility states.

### 4.3 Column Geometry

Each tile column is a top-down compatible vertical prism. **Side faces are CONDITIONAL** — they only render where a tile's edge is truly exposed to void (no visible/remembered neighbor on that side). Interior tiles in a contiguous visible room render ONLY the top cap with bevels, producing a seamless flat surface with no false ledges or seams.

#### Fully-exposed column (south + east edges exposed to void):

```
┌──────────────────────────┐  ← 2px lighter bevel (top edge)
│  ╔══════════════════════╗│
│  ║                      ║│  ← Top Cap: TILE_SIZE × TILE_SIZE
│  ║    (tile color +     ║│     PINNED at y * TILE_SIZE always.
│  ║     deterministic    ║│     Floor/Wall base color with
│  ║     color jitter)    ║│     per-tile jitter (±8 amplitude)
│  ║                      ║│
│  ╚══════════════════════╝│
│                       ▕▕▕│  ← 1px darker bevel (bottom/right edges)
├──────────────────────────┤
│  South Body Face         │  ← TILE_SIZE × columnHeight (up to 56px)
│  (10-band depth fade     │     CONDITIONAL: only if southExposed=true
│   from face color        │     Fades aggressively from tile face color
│   → abyss 0x0a0a12      │     toward abyss color (0x0a0a12)
│   multiplier: t * 0.95)  │     Depth fade: band_t = i/(bands-1),
│                       ▕▕▕│     color = lerp(face, abyss, t * 0.95)
│                       ▕▕▕│  ← East highlight strip (3px)
│  ·····darkness·····      │     CONDITIONAL: only if eastExposed=true
│  ·····swallows····       │     Lighter band suggesting second face
│  ·····the base····       │
├──────────────────────────┤
│  ░░ Shadow Strip ░░░░░░░ │  ← 2px at column base (max height 2px)
└──────────────────────────┘     Darkened strip grounding column in void
```

#### Interior column (no edges exposed — surrounded by visible neighbors):

```
┌──────────────────────────┐  ← 2px lighter bevel (top edge)
│  ╔══════════════════════╗│
│  ║                      ║│  ← Top Cap: TILE_SIZE × TILE_SIZE
│  ║    (tile color +     ║│     PINNED at y * TILE_SIZE always.
│  ║     deterministic    ║│     No body face, no strip, no shadow.
│  ║     color jitter)    ║│     Seamless surface with neighbors.
│  ║                      ║│
│  ╚══════════════════════╝│
│                       ▕▕▕│  ← 1px darker bevel (bottom/right edges)
└──────────────────────────┘     Total: 5 draw calls (cap + 4 bevels)
```

**Critical rule**: Same-elevation tiles MUST have coplanar top surfaces. The top cap of every floor tile on the same gameplay plane is rendered at exactly `y * TILE_SIZE` — no vertical displacement of the top surface, ever. The column body extends DOWNWARD from the top cap (increasing y in screen space), never displaces the top cap.

**Top Cap**: The primary tile surface. `TILE_SIZE × TILE_SIZE` rectangle rendered at the tile's grid position (`x * TILE_SIZE`, `y * TILE_SIZE`). Colored with the tile's base color (floor or wall) plus deterministic per-tile color jitter for organic texture. Bevel highlights: 2px lighter strip on top and left edges, 1px darker strip on bottom and right edges. This surface is always rendered regardless of exposure.

**South Body Face** *(conditional — only when `southExposed = true`)*: Vertical extrusion below the top cap representing the south-facing cliff edge. Width = `TILE_SIZE`, height = `columnHeight` (animated during transitions, max `COLUMN_MAX_HEIGHT` = 56px). Rendered with a **10-band** vertical depth fade from the tile's face color aggressively toward the abyss color (`0x0a0a12`) using multiplier `t * 0.95`. The shaft should feel **visually bottomless** — darkness swallows the base, creating the sensation of tile tops suspended over a cavernous void.

**East Highlight Strip** *(conditional — only when `eastExposed = true`)*: A 3px-wide (`SIDE_STRIP_WIDTH`) lighter band on the right edge of the tile, extending downward by `columnHeight`. Suggests a second (east) face without rendering a full additional surface. Adds dimensionality at minimal draw cost.

**Shadow Strip**: A 2px darkened strip at the base of the south body face (only rendered when `southExposed = true`). Maximum height capped at 2px. Provides ambient occlusion grounding.

**Deterministic Color Jitter**: Per-tile color variation uses a seeded hash: `h = (x * 374761 + y * 668265) | 0` followed by two rounds of `h = ((h >> 16) ^ h) * 0x45d9f3b`. This produces stable, non-random variation — the same tile always gets the same jitter across frames and revisits.

**Column Constants**:

| Constant | Value | Description |
|---|---|---|
| `COLUMN_MAX_HEIGHT` | 56px | Visible state shaft depth — visually bottomless |
| `COLUMN_REMEMBERED_HEIGHT` | 20px | Remembered state shaft depth |
| `BODY_BANDS` | 10 | Number of depth-fade bands in the south body face |
| `SIDE_STRIP_WIDTH` | 3px | Width of the east highlight strip |
| `DEPTH_FADE_MULTIPLIER` | 0.95 | How aggressively body bands fade toward abyss |
| `MIN_COLUMN_HEIGHT` | 6px | Minimum column height for `ColumnConfig` defaults |

**Draw call budget per tile** (by exposure combination):

| Exposure | Draw Calls | Surfaces |
|---|---|---|
| Interior (no exposure) | 5 | Top cap + 4 bevels |
| South-only | ~16 | Cap + bevels + 10 body bands + shadow strip |
| East-only | ~15 | Cap + bevels + east strip bands |
| Both exposed | ~26 | Cap + bevels + body bands + east strip + shadow |
| Height = 0 (animating) | 5 | Top cap + bevels only (no shaft to draw) |

### 4.3.1 Neighbor Exposure Logic

Side faces render ONLY where a tile's edge is truly exposed to void — i.e., the neighboring tile in that direction is NOT present in the relevant visibility set. This prevents false diagonal ledge seams and tiered appearances across flat contiguous rooms.

**Exposure computation** — `computeExposure(x, y, tileSet)`:

- **South face exposed**: tile at `(x, y+1)` is NOT in `tileSet`, OR `(x, y+1)` is out of map bounds
- **East face exposed**: tile at `(x+1, y)` is NOT in `tileSet`, OR `(x+1, y)` is out of map bounds
- If the neighbor IS in the set → that edge is interior → no side face renders
- If the neighbor is NOT in the set → that edge is exposed → side face renders

**Which tile set to check against depends on the rendering layer**:

| Layer | Tile Set for Exposure Check |
|---|---|
| Visible batch | `fogState.visibleSet` |
| Remembered batch | Union of `exploredSet` ∪ `visibleSet` |
| Frontier animations | `fogState.visibleSet` at time of animation start |

**`ColumnConfig` interface**:

```typescript
interface ColumnConfig {
  x: number;           // Grid x
  y: number;           // Grid y
  columnHeight: number; // Current shaft height in px
  color: number;       // Base tile color (hex)
  southExposed?: boolean; // Default: false (safe — no false ledges)
  eastExposed?: boolean;  // Default: false (safe — no false ledges)
}
```

**Safe defaults**: `southExposed` and `eastExposed` default to `false` when not provided. This means callers that don't compute neighbor exposure get the safe default: top cap only, no false side faces. The `FogOfWarRenderer` is responsible for computing exposure from visibility sets and passing the flags.

### 4.4 Color Palettes

Visible and remembered states use distinct palettes to reinforce the height-as-knowledge mapping:

| Surface | Visible Palette | Remembered Palette |
|---|---|---|
| Floor top cap | `0x3a3a4a` (cool grey) | `0x252530` (dark grey-blue) |
| Wall top cap | `0x5a4a3a` (warm brown-grey) | `0x3a3228` (muted dark brown) |
| Jitter amplitude | ±8 per channel | ±4 per channel |
| Body face | Depth fade → `0x0a0a12` (abyss) | Depth fade → `0x0a0a12` (abyss) |
| Bevel highlights | +20 brightness (top/left) | +10 brightness (top/left) |
| Bevel shadows | −15 brightness (bottom/right) | −8 brightness (bottom/right) |

The remembered palette is intentionally desaturated and darkened — *not* simply the visible palette with reduced alpha. This avoids the visual confusion of translucent tiles and creates a clear quiet/loud distinction.

### 4.5 Reveal / Conceal Animation

There is ONE animation mode: **columnar emergence**. No toggle, no mode selection.

**Critical constraint**: There is NO `yOffset`. The top cap of every tile is PINNED at `y * TILE_SIZE` at all times. Animation acts on `columnHeight` (shaft growing/shrinking downward) and `alpha` (cap materializing/dematerializing). The top cap never moves vertically — this prevents the "north = higher elevation" visual error.

**Reveal** (tile enters line of sight):
- Top cap stays PINNED at `y * TILE_SIZE`
- Tween `{ columnHeight: 0, alpha: 0 }` → `{ columnHeight: COLUMN_MAX_HEIGHT, alpha: 1 }`
- Shaft grows DOWNWARD from the pinned cap position (increasing y in screen space)
- Cap fades in (alpha 0 → 1) while shaft extends
- Easing: `power2.out` (fast materialization, gentle settle)
- Base duration: 400ms (±50ms per-tile variance)
- The column appears to materialize in place while its shaft descends into the abyss

**Conceal** (tile leaves line of sight):
- Top cap stays PINNED at `y * TILE_SIZE`
- Tween `{ columnHeight: COLUMN_MAX_HEIGHT, alpha: 1 }` → `{ columnHeight: 0, alpha: 0 }`
- Shaft shrinks UPWARD (retracting toward the cap) while cap fades out
- Easing: `power2.in` (gentle start, accelerating dissolution)
- Base duration: 400ms (±50ms per-tile variance)
- On completion: snap to remembered state (shorter column at `COLUMN_REMEMBERED_HEIGHT`, remembered palette)

**Column heights**:
- `COLUMN_MAX_HEIGHT` = 56px (visible state — visually bottomless shaft)
- `COLUMN_REMEMBERED_HEIGHT` = 20px (remembered state — no animation, static shorter column)

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
  - `entering`: tiles that just became visible (animate IN — cap materializes, shaft grows downward)
  - `exiting`: tiles that just left vision (animate OUT — shaft retracts upward, cap fades out)
  - `stable`: tiles that remain visible (no animation)
- **Performance**: Must complete in <1ms for 80x80 map

### 4.8 Frontier Visual Effects (P1)

Applied to the frontier container holding tiles in the `entering` or `exiting` sets. The NoiseFilter is **event-driven and short-lived**, NOT continuous. The frontier should settle into stillness between moves — permanent ambient shimmer reads as a rendering bug.

**NoiseFilter lifecycle**:

1. **Default state**: NoiseFilter is disabled (noise intensity = 0). No seed animation running.
2. **`activateNoise()`**: Called when frontier animations begin (tiles entering or exiting). Fades noise intensity from 0 → 0.15 over 100ms. Starts seed animation tween (`repeat: -1, yoyo: true`) for organic noise variation.
3. **`onFrontierAnimationComplete()`**: Called when the LAST frontier animation completes (all entering/exiting tiles have finished). Fades noise intensity from current → 0 over 300ms. On fade completion, kills the seed animation tween.
4. **Result**: Noise only shimmers while the frontier is actively animating, then settles to stillness.

**Implementation detail**: Two separate GSAP tween refs:
- `noiseSeedTweenRef`: Controls `noise.seed` animation (repeat: -1, yoyo: true). Only runs while intensity > 0.
- `noiseIntensityTweenRef`: Controls `noise.noise` fade in/out.

**Performance budget**: Filter applied to one container (typically holding 20-40 tile columns), not to the entire scene.

### 4.9 Architecture

```
React Shell (DOM)
  └── PixiJS Stage (@pixi/react)
        ├── Remembered Layer (batched Graphics)
        │     └── Shorter columns (COLUMN_REMEMBERED_HEIGHT=20px shaft)
        │     └── Remembered palette, desaturated, static
        │     └── Conditional side faces (check exploredSet ∪ visibleSet)
        ├── Visible Layer (batched Graphics)
        │     └── Full-depth columns (COLUMN_MAX_HEIGHT=56px shaft)
        │     └── Visible palette, bevel highlights
        │     └── Conditional side faces (check visibleSet)
        │     └── Player sprite
        ├── Frontier Layer (individual Graphics + GSAP + event-driven NoiseFilter)
        │     └── Animated columns entering/exiting visibility
        │     └── Per-tile GSAP tweens on { columnHeight, alpha } (NO yOffset)
        │     └── Top cap pinned at y * TILE_SIZE, shaft grows/shrinks downward
        │     └── Stagger delays, duration variance, height jitter
        │     └── NoiseFilter activates on animation start, deactivates on last complete
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
| Draw calls per tile | Interior: 5, south-only: ~16, east-only: ~15, both exposed: ~26 |

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
