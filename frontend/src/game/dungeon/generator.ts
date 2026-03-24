/**
 * BSP (Binary Space Partition) dungeon generator.
 *
 * Recursively subdivides the map area into partitions, places a randomly-sized
 * room inside each leaf partition, and connects sibling rooms with L-shaped
 * corridors. The BSP tree structure guarantees full connectivity — every room
 * is reachable from every other room.
 *
 * Supports seedable PRNG for deterministic/reproducible output.
 */

import { GameMap, TileType } from '../../tilemap/types.ts';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Result of dungeon generation, including map data and spawn metadata. */
export interface DungeonResult {
  /** The generated game map. */
  map: GameMap;
  /** Starting X position for the player (guaranteed floor tile). */
  startX: number;
  /** Starting Y position for the player (guaranteed floor tile). */
  startY: number;
  /** Center coordinates of every generated room — useful for spawn points. */
  roomCenters: [number, number][];
}

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** Simple seedable LCG PRNG. Returns values in [0, 1). */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) | 0;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

/** Return a random integer in [min, max] (inclusive). */
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Axis-aligned bounding rectangle. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node in the BSP tree. Leaf nodes contain a room. */
interface BspNode {
  bounds: Rect;
  left: BspNode | null;
  right: BspNode | null;
  room: Rect | null;
}

// ---------------------------------------------------------------------------
// BSP constants
// ---------------------------------------------------------------------------

/** Minimum partition dimension before we stop splitting. */
const MIN_PARTITION = 12;

/** Minimum room dimension (interior, excluding walls). */
const MIN_ROOM = 5;

/** Maximum room dimension. */
const MAX_ROOM = 15;

/** Padding between room edge and partition edge. */
const ROOM_PADDING = 2;

// ---------------------------------------------------------------------------
// BSP tree construction
// ---------------------------------------------------------------------------

/**
 * Recursively split a rectangular region into a BSP tree.
 * Alternates between horizontal and vertical splits with some randomness.
 */
function splitBsp(
  bounds: Rect,
  rng: () => number,
  depth: number,
): BspNode {
  const node: BspNode = { bounds, left: null, right: null, room: null };

  // Decide whether to split. Stop if partition is too small.
  const canSplitH = bounds.h >= MIN_PARTITION * 2;
  const canSplitV = bounds.w >= MIN_PARTITION * 2;

  if (!canSplitH && !canSplitV) {
    return node; // leaf
  }

  // Choose split direction
  let splitHorizontal: boolean;
  if (canSplitH && canSplitV) {
    // Prefer splitting the longer axis, with some randomness
    if (bounds.w > bounds.h * 1.25) {
      splitHorizontal = false;
    } else if (bounds.h > bounds.w * 1.25) {
      splitHorizontal = true;
    } else {
      splitHorizontal = rng() < 0.5;
    }
  } else {
    splitHorizontal = canSplitH;
  }

  if (splitHorizontal) {
    // Split along y-axis
    const splitMin = bounds.y + MIN_PARTITION;
    const splitMax = bounds.y + bounds.h - MIN_PARTITION;
    const splitAt = randInt(rng, splitMin, splitMax);

    node.left = splitBsp(
      { x: bounds.x, y: bounds.y, w: bounds.w, h: splitAt - bounds.y },
      rng,
      depth + 1,
    );
    node.right = splitBsp(
      { x: bounds.x, y: splitAt, w: bounds.w, h: bounds.y + bounds.h - splitAt },
      rng,
      depth + 1,
    );
  } else {
    // Split along x-axis
    const splitMin = bounds.x + MIN_PARTITION;
    const splitMax = bounds.x + bounds.w - MIN_PARTITION;
    const splitAt = randInt(rng, splitMin, splitMax);

    node.left = splitBsp(
      { x: bounds.x, y: bounds.y, w: splitAt - bounds.x, h: bounds.h },
      rng,
      depth + 1,
    );
    node.right = splitBsp(
      { x: splitAt, y: bounds.y, w: bounds.x + bounds.w - splitAt, h: bounds.h },
      rng,
      depth + 1,
    );
  }

  return node;
}

// ---------------------------------------------------------------------------
// Room placement
// ---------------------------------------------------------------------------

/** Place a randomly-sized room inside each leaf node of the BSP tree. */
function placeRooms(node: BspNode, rng: () => number): void {
  if (node.left !== null && node.right !== null) {
    placeRooms(node.left, rng);
    placeRooms(node.right, rng);
    return;
  }

  // Leaf node — place a room inside bounds
  const b = node.bounds;

  const maxW = Math.min(MAX_ROOM, b.w - ROOM_PADDING * 2);
  const maxH = Math.min(MAX_ROOM, b.h - ROOM_PADDING * 2);
  const roomW = Math.max(MIN_ROOM, randInt(rng, MIN_ROOM, maxW));
  const roomH = Math.max(MIN_ROOM, randInt(rng, MIN_ROOM, maxH));

  const roomX = randInt(rng, b.x + ROOM_PADDING, b.x + b.w - roomW - ROOM_PADDING);
  const roomY = randInt(rng, b.y + ROOM_PADDING, b.y + b.h - roomH - ROOM_PADDING);

  node.room = { x: roomX, y: roomY, w: roomW, h: roomH };
}

// ---------------------------------------------------------------------------
// Corridor carving
// ---------------------------------------------------------------------------

/** Carve a horizontal run of floor tiles. */
function carveH(
  tiles: TileType[],
  width: number,
  x1: number,
  x2: number,
  y: number,
): void {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (let x = lo; x <= hi; x++) {
    tiles[y * width + x] = TileType.Floor;
  }
}

/** Carve a vertical run of floor tiles. */
function carveV(
  tiles: TileType[],
  width: number,
  x: number,
  y1: number,
  y2: number,
): void {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  for (let y = lo; y <= hi; y++) {
    tiles[y * width + x] = TileType.Floor;
  }
}

/** Get center of a rect. */
function rectCenter(r: Rect): [number, number] {
  return [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];
}

/** Find any room inside a subtree (picks the leftmost leaf). */
function findRoom(node: BspNode): Rect | null {
  if (node.room !== null) return node.room;
  if (node.left !== null) {
    const r = findRoom(node.left);
    if (r !== null) return r;
  }
  if (node.right !== null) {
    return findRoom(node.right);
  }
  return null;
}

/** Find a room in the right subtree (rightmost leaf preferred). */
function findRoomRight(node: BspNode): Rect | null {
  if (node.room !== null) return node.room;
  if (node.right !== null) {
    const r = findRoomRight(node.right);
    if (r !== null) return r;
  }
  if (node.left !== null) {
    return findRoomRight(node.left);
  }
  return null;
}

/**
 * Connect sibling rooms in the BSP tree with L-shaped corridors.
 * Recurse into children first, then connect left subtree to right subtree.
 */
function connectRooms(
  node: BspNode,
  tiles: TileType[],
  width: number,
  rng: () => number,
): void {
  if (node.left === null || node.right === null) return;

  connectRooms(node.left, tiles, width, rng);
  connectRooms(node.right, tiles, width, rng);

  // Find a room from each subtree to connect
  const roomA = findRoomRight(node.left);
  const roomB = findRoom(node.right);

  if (roomA === null || roomB === null) return;

  const [ax, ay] = rectCenter(roomA);
  const [bx, by] = rectCenter(roomB);

  // L-shaped corridor — randomly choose horizontal-first or vertical-first
  if (rng() < 0.5) {
    carveH(tiles, width, ax, bx, ay);
    carveV(tiles, width, bx, ay, by);
  } else {
    carveV(tiles, width, ax, ay, by);
    carveH(tiles, width, ax, bx, by);
  }
}

// ---------------------------------------------------------------------------
// Room collection
// ---------------------------------------------------------------------------

/** Collect all rooms from the BSP tree leaves. */
function collectRooms(node: BspNode, out: Rect[]): void {
  if (node.room !== null) {
    out.push(node.room);
  }
  if (node.left !== null) collectRooms(node.left, out);
  if (node.right !== null) collectRooms(node.right, out);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a dungeon using BSP partitioning.
 *
 * @param width  - Map width in tiles (minimum 40, recommended ≥ 80)
 * @param height - Map height in tiles (minimum 40, recommended ≥ 80)
 * @param seed   - Optional seed for reproducibility. If not provided, uses a
 *                 random seed derived from Math.random().
 * @returns DungeonResult with map data and metadata
 */
export function generateDungeon(
  width: number,
  height: number,
  seed?: number,
): DungeonResult {
  if (width < 40) throw new Error(`Width must be >= 40, got ${width}`);
  if (height < 40) throw new Error(`Height must be >= 40, got ${height}`);

  const effectiveSeed = seed ?? Math.floor(Math.random() * 0x7fff_ffff);
  const rng = createRng(effectiveSeed);

  // 1. Initialize all tiles to Wall
  const tiles: TileType[] = new Array<TileType>(width * height).fill(
    TileType.Wall,
  );

  // 2. Build BSP tree (leave 1-tile border for outer walls)
  const innerBounds: Rect = { x: 1, y: 1, w: width - 2, h: height - 2 };
  const root = splitBsp(innerBounds, rng, 0);

  // 3. Place rooms in leaf nodes
  placeRooms(root, rng);

  // 4. Carve rooms into the tile array
  const rooms: Rect[] = [];
  collectRooms(root, rooms);

  for (const room of rooms) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        tiles[(room.y + dy) * width + (room.x + dx)] = TileType.Floor;
      }
    }
  }

  // 5. Connect rooms via corridors
  connectRooms(root, tiles, width, rng);

  // 6. Ensure outer border is all walls
  for (let x = 0; x < width; x++) {
    tiles[x] = TileType.Wall;                          // top row
    tiles[(height - 1) * width + x] = TileType.Wall;   // bottom row
  }
  for (let y = 0; y < height; y++) {
    tiles[y * width] = TileType.Wall;                   // left column
    tiles[y * width + (width - 1)] = TileType.Wall;     // right column
  }

  // 7. Determine start position and room centers
  const roomCenters: [number, number][] = rooms.map((r) => rectCenter(r));

  const firstRoom = rooms[0];
  let startX: number;
  let startY: number;

  if (firstRoom !== undefined) {
    [startX, startY] = rectCenter(firstRoom);
  } else {
    // Fallback: find any floor tile
    startX = Math.floor(width / 2);
    startY = Math.floor(height / 2);
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TileType.Floor) {
        startX = i % width;
        startY = Math.floor(i / width);
        break;
      }
    }
  }

  const map: GameMap = { width, height, tiles };
  return { map, startX, startY, roomCenters };
}
