// Fathom — the tile grid, the maze layout, and the geometry every system shares:
// tile lookups, neighbors across the wrap tunnel, corridor distance fields, line
// of sight, and the maze generator with the validator that holds it to
// specs/maze.md.

import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
  TILE,
} from "./constants";

import type { Dir, Tile } from "./game";

/** A maze layout: GRID_ROWS strings of GRID_COLS characters, `#`, `.`, `g`, `d`. */
export type Rows = readonly string[];

export const ROCK = "#";
export const OPEN = ".";
export const GATE = "g";
export const DEN = "d";

export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];

export const DELTA: Readonly<Record<Dir, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const MAZE_LEFT = GRID_ORIGIN_X;
export const MAZE_RIGHT = GRID_ORIGIN_X + GRID_COLS * TILE;
export const MAZE_TOP = GRID_ORIGIN_Y;
export const MAZE_BOTTOM = GRID_ORIGIN_Y + GRID_ROWS * TILE;
export const TILE_COUNT = GRID_COLS * GRID_ROWS;

/** The den chamber's fixed bounds (specs/maze.md), inclusive. */
export const DEN_COLS = [16, 19] as const;
export const DEN_ROWS = [7, 9] as const;

/** Where a generated maze puts the forager, and what a fixture's start is nearest. */
const START_ANCHOR: Tile = { tx: 17, ty: 13 };

export function inGrid(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS;
}

export function index(tx: number, ty: number): number {
  return ty * GRID_COLS + tx;
}

/** The character at a tile, rock beyond the grid. */
export function tileAt(rows: Rows, tx: number, ty: number): string {
  return inGrid(tx, ty) ? rows[ty][tx] : ROCK;
}

export function isOpen(rows: Rows, tx: number, ty: number): boolean {
  return tileAt(rows, tx, ty) === OPEN;
}

/** Open to a predator inside the den: corridor, den interior, or the gate. */
export function isDenPassable(rows: Rows, tx: number, ty: number): boolean {
  const c = tileAt(rows, tx, ty);
  return c === OPEN || c === DEN || c === GATE;
}

export function centerX(tx: number): number {
  return GRID_ORIGIN_X + tx * TILE + TILE / 2;
}

export function centerY(ty: number): number {
  return GRID_ORIGIN_Y + ty * TILE + TILE / 2;
}

/** The tile whose bounds contain a point, clamped onto the grid. */
export function tileOf(x: number, y: number): Tile {
  const tx = Math.floor((x - GRID_ORIGIN_X) / TILE);
  const ty = Math.floor((y - GRID_ORIGIN_Y) / TILE);
  return {
    tx: Math.min(GRID_COLS - 1, Math.max(0, tx)),
    ty: Math.min(GRID_ROWS - 1, Math.max(0, ty)),
  };
}

export function sameTile(a: Tile | null, b: Tile | null): boolean {
  return a !== null && b !== null && a.tx === b.tx && a.ty === b.ty;
}

/** The first row whose two border tiles are both open corridor, if any. */
export function wrapRowOf(rows: Rows): number | null {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    if (rows[ty][0] === OPEN && rows[ty][GRID_COLS - 1] === OPEN) return ty;
  }
  return null;
}

/** The neighbor of a tile in a direction, across the wrap tunnel where it runs. */
export function neighbor(
  rows: Rows,
  tx: number,
  ty: number,
  dir: Dir,
): Tile | null {
  let nx = tx + DELTA[dir].dx;
  const ny = ty + DELTA[dir].dy;
  if (nx < 0 || nx >= GRID_COLS) {
    if (ny !== wrapRowOf(rows)) return null;
    nx = (nx + GRID_COLS) % GRID_COLS;
  }
  return inGrid(nx, ny) ? { tx: nx, ty: ny } : null;
}

export function findGate(rows: Rows): Tile | null {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    const tx = rows[ty].indexOf(GATE);
    if (tx >= 0) return { tx, ty };
  }
  return null;
}

/** The corridor tile a predator leaves the den onto: the gate's open neighbor. */
export function denExit(rows: Rows): Tile | null {
  const gate = findGate(rows);
  if (!gate) return null;
  for (const dir of DIRS) {
    const n = neighbor(rows, gate.tx, gate.ty, dir);
    if (n && isOpen(rows, n.tx, n.ty)) return n;
  }
  return null;
}

/** Every den-interior tile, in reading order. */
export function denTiles(rows: Rows): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (rows[ty][tx] === DEN) out.push({ tx, ty });
    }
  }
  return out;
}

/**
 * The forager's start tile: the corridor tile nearest the start anchor, taken
 * from the lower half (rows 9 to 16) when it holds one. A function of the layout
 * alone, so it is fixed for as long as a maze stands.
 */
export function startTileOf(rows: Rows): Tile | null {
  let best: Tile | null = null;
  let bestScore = Infinity;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (rows[ty][tx] !== OPEN) continue;
      const lower = ty >= 9 && ty <= 16 ? 0 : 1e6;
      const score =
        lower + (tx - START_ANCHOR.tx) ** 2 + (ty - START_ANCHOR.ty) ** 2;
      if (score < bestScore) {
        bestScore = score;
        best = { tx, ty };
      }
    }
  }
  return best;
}

/**
 * Corridor-step distances from the given tiles over the tiles `passable`
 * accepts, with the wrap tunnel as an ordinary step. `-1` marks a tile the flood
 * never reaches.
 */
export function distanceField(
  rows: Rows,
  from: readonly Tile[],
  passable: (tx: number, ty: number) => boolean,
): number[] {
  const dist = new Array<number>(TILE_COUNT).fill(-1);
  const queue: Tile[] = [];
  for (const t of from) {
    if (!inGrid(t.tx, t.ty) || dist[index(t.tx, t.ty)] === 0) continue;
    dist[index(t.tx, t.ty)] = 0;
    queue.push(t);
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const d = dist[index(t.tx, t.ty)];
    for (const dir of DIRS) {
      const n = neighbor(rows, t.tx, t.ty, dir);
      if (!n || dist[index(n.tx, n.ty)] >= 0 || !passable(n.tx, n.ty)) {
        continue;
      }
      dist[index(n.tx, n.ty)] = d + 1;
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Whether the straight segment between two points crosses a rock tile, walking
 * the grid cells it passes through. A segment through a cell corner passes
 * diagonally and touches neither side cell. `ignore` names one tile the test
 * skips, which is how the forager's light reaches the rock face it lands on.
 */
export function segmentBlocked(
  rows: Rows,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ignore: Tile | null = null,
): boolean {
  const u0 = (x0 - GRID_ORIGIN_X) / TILE;
  const v0 = (y0 - GRID_ORIGIN_Y) / TILE;
  const u1 = (x1 - GRID_ORIGIN_X) / TILE;
  const v1 = (y1 - GRID_ORIGIN_Y) / TILE;
  let cx = Math.floor(u0);
  let cy = Math.floor(v0);
  const ex = Math.floor(u1);
  const ey = Math.floor(v1);
  const du = u1 - u0;
  const dv = v1 - v0;
  const sx = Math.sign(du);
  const sy = Math.sign(dv);
  const tdx = du === 0 ? Infinity : 1 / Math.abs(du);
  const tdy = dv === 0 ? Infinity : 1 / Math.abs(dv);
  let tmx = du === 0 ? Infinity : (sx > 0 ? cx + 1 - u0 : u0 - cx) * tdx;
  let tmy = dv === 0 ? Infinity : (sy > 0 ? cy + 1 - v0 : v0 - cy) * tdy;
  const blocked = (tx: number, ty: number): boolean =>
    !(ignore && ignore.tx === tx && ignore.ty === ty) &&
    tileAt(rows, tx, ty) === ROCK;
  for (let guard = 0; guard < 4 * (GRID_COLS + GRID_ROWS); guard++) {
    if (blocked(cx, cy)) return true;
    if (cx === ex && cy === ey) return false;
    if (Math.abs(tmx - tmy) < 1e-9) {
      cx += sx;
      cy += sy;
      tmx += tdx;
      tmy += tdy;
    } else if (tmx < tmy) {
      cx += sx;
      tmx += tdx;
    } else {
      cy += sy;
      tmy += tdy;
    }
    if (tmx > 1 + 1e-9 && tmy > 1 + 1e-9 && (cx !== ex || cy !== ey)) {
      // Floating error stepped past the far end; the end cell decides.
      return blocked(ex, ey);
    }
  }
  return false;
}

// ---- Validation -----------------------------------------------------------

export interface MazeMeasures {
  readonly openness: number;
  readonly mazing: number;
  readonly density: number;
}

function corridorNeighbors(rows: Rows, tx: number, ty: number): Tile[] {
  const out: Tile[] = [];
  for (const dir of DIRS) {
    const n = neighbor(rows, tx, ty, dir);
    if (n && isOpen(rows, n.tx, n.ty)) out.push(n);
  }
  return out;
}

/** The three proportions specs/maze.md measures a laid-out maze by. */
export function measureMaze(rows: Rows): MazeMeasures {
  let corridors = 0;
  let neighborSum = 0;
  const two: boolean[] = new Array<boolean>(TILE_COUNT).fill(false);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (!isOpen(rows, tx, ty)) continue;
      const n = corridorNeighbors(rows, tx, ty).length;
      corridors++;
      neighborSum += n;
      two[index(tx, ty)] = n === 2;
    }
  }
  const seen: boolean[] = new Array<boolean>(TILE_COUNT).fill(false);
  let runs = 0;
  let runTiles = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!two[i] || seen[i]) continue;
    runs++;
    const stack = [i];
    seen[i] = true;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      runTiles++;
      const tx = cur % GRID_COLS;
      const ty = Math.floor(cur / GRID_COLS);
      for (const n of corridorNeighbors(rows, tx, ty)) {
        const j = index(n.tx, n.ty);
        if (two[j] && !seen[j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
  }
  return {
    openness: corridors === 0 ? 0 : neighborSum / corridors,
    mazing: runs === 0 ? 0 : runTiles / runs,
    density: corridors / ((GRID_COLS - 2) * (GRID_ROWS - 2)),
  };
}

/** Every rule of specs/maze.md the layout breaks, as readable messages. */
export function mazeViolations(rows: Rows): string[] {
  const problems: string[] = [];
  if (rows.length !== GRID_ROWS || rows.some((r) => r.length !== GRID_COLS)) {
    return ["wrong size"];
  }
  const kind = (c: string): string => (c === ROCK ? ROCK : OPEN);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const c = rows[ty][tx];
      const open = c === OPEN;
      if (
        open &&
        isOpen(rows, tx + 1, ty) &&
        isOpen(rows, tx, ty + 1) &&
        isOpen(rows, tx + 1, ty + 1)
      ) {
        problems.push(`2x2 corridor block at ${tx},${ty}`);
      }
      const m = rows[ty][GRID_COLS - 1 - tx];
      const denPair = [c, m].some((x) => x === DEN || x === GATE);
      if (!denPair && kind(c) !== kind(m)) {
        problems.push(`asymmetry at ${tx},${ty}`);
      }
      if (open && corridorNeighbors(rows, tx, ty).length < 2) {
        problems.push(`dead end at ${tx},${ty}`);
      }
    }
  }
  const wrap = wrapRowOf(rows);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const border =
        tx === 0 || ty === 0 || tx === GRID_COLS - 1 || ty === GRID_ROWS - 1;
      const mouth = ty === wrap && (tx === 0 || tx === GRID_COLS - 1);
      if (border && !mouth && rows[ty][tx] !== ROCK) {
        problems.push(`open border at ${tx},${ty}`);
      }
    }
  }
  if (wrap === null) problems.push("no wrap tunnel");
  else if (/[dg]/.test(rows[wrap])) problems.push("den on the wrap row");

  // The den: exactly the fixed chamber, one gate on its top edge, enclosed.
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const inChamber =
        tx >= DEN_COLS[0] &&
        tx <= DEN_COLS[1] &&
        ty >= DEN_ROWS[0] &&
        ty <= DEN_ROWS[1];
      if (inChamber !== (rows[ty][tx] === DEN)) {
        problems.push(`den mismatch at ${tx},${ty}`);
      }
      if (rows[ty][tx] === DEN && corridorNeighbors(rows, tx, ty).length > 0) {
        problems.push(`den open to a corridor at ${tx},${ty}`);
      }
    }
  }
  const gates = rows.join("").split(GATE).length - 1;
  const gate = findGate(rows);
  if (
    gates !== 1 ||
    !gate ||
    gate.ty !== DEN_ROWS[0] - 1 ||
    gate.tx < DEN_COLS[0] ||
    gate.tx > DEN_COLS[1]
  ) {
    problems.push("the den needs exactly one gate above the chamber");
  }

  // One connected corridor region holding the start and both mouths.
  const start = startTileOf(rows);
  if (!start || start.ty < 9 || start.ty > 16) {
    problems.push("no start tile in the lower half");
  } else {
    const dist = distanceField(rows, [start], (x, y) => isOpen(rows, x, y));
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        if (isOpen(rows, tx, ty) && dist[index(tx, ty)] < 0) {
          problems.push(`disconnected corridor at ${tx},${ty}`);
        }
      }
    }
    const reach = distanceField(rows, [start], (x, y) =>
      isDenPassable(rows, x, y),
    );
    for (const d of denTiles(rows)) {
      if (reach[index(d.tx, d.ty)] < 0) {
        problems.push(`den tile ${d.tx},${d.ty} cannot reach the start`);
      }
    }
  }

  const m = measureMaze(rows);
  if (m.openness < MAZE_OPENNESS_MIN || m.openness > MAZE_OPENNESS_MAX) {
    problems.push(`openness ${m.openness.toFixed(3)} out of bounds`);
  }
  if (m.mazing < MAZE_MAZING_MIN || m.mazing > MAZE_MAZING_MAX) {
    problems.push(`corridor run ${m.mazing.toFixed(3)} out of bounds`);
  }
  if (m.density < MAZE_DENSITY_MIN || m.density > MAZE_DENSITY_MAX) {
    problems.push(`density ${m.density.toFixed(3)} out of bounds`);
  }
  return problems;
}

// ---- Generation -----------------------------------------------------------
//
// The left half is a lattice of junction nodes on even columns 2..14 and odd
// rows 1..15, joined by one-tile links; the right half mirrors it. Every tile
// at an odd column and an even row stays rock, so no 2x2 corridor block can
// form. A few rows cross the middle from column 14 to its mirror, the den sits
// in the rock between those crossings, and one row pierces both borders as the
// wrap tunnel.

const NODE_COLS = [2, 4, 6, 8, 10, 12, 14];
const NODE_ROWS = [1, 3, 5, 7, 9, 11, 13, 15];
/** Rows a crossing may take: clear of the den chamber's rows. */
const CROSSING_ROWS = [1, 3, 5, 11, 13, 15];
/** The gate opens onto the row-5 crossing and the start sits on row 13's. */
const FORCED_CROSSINGS = [5, 13];
const TUNNEL_ROWS = [3, 11, 15];
const GATE_TILE: Tile = { tx: 17, ty: 6 };

interface Edge {
  readonly a: number;
  readonly b: number;
}

function carveLayout(rand: () => number): string[] {
  const nc = NODE_COLS.length;
  const nr = NODE_ROWS.length;
  const node = (i: number, j: number): number => j * nc + i;
  const edges: Edge[] = [];
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      if (i + 1 < nc) edges.push({ a: node(i, j), b: node(i + 1, j) });
      if (j + 1 < nr) edges.push({ a: node(i, j), b: node(i, j + 1) });
    }
  }
  const shuffled = [...edges];
  for (let k = shuffled.length - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    [shuffled[k], shuffled[r]] = [shuffled[r], shuffled[k]];
  }

  // A random spanning tree keeps every junction connected.
  const parent = Array.from({ length: nc * nr }, (_, k) => k);
  const find = (k: number): number => {
    while (parent[k] !== k) {
      parent[k] = parent[parent[k]];
      k = parent[k];
    }
    return k;
  };
  const chosen = new Set<number>();
  const extra: number[] = [];
  shuffled.forEach((e, k) => {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      chosen.add(k);
    } else {
      extra.push(k);
    }
  });

  const crossings = CROSSING_ROWS.filter(
    (r) => FORCED_CROSSINGS.includes(r) || rand() < 0.4,
  );
  const tunnel = TUNNEL_ROWS[Math.floor(rand() * TUNNEL_ROWS.length)];
  const degree = new Array<number>(nc * nr).fill(0);
  for (const k of chosen) {
    degree[shuffled[k].a]++;
    degree[shuffled[k].b]++;
  }
  for (const r of crossings) degree[node(nc - 1, NODE_ROWS.indexOf(r))]++;
  degree[node(0, NODE_ROWS.indexOf(tunnel))]++;

  // Open every dead end onto another junction, then add loops until the maze
  // reads as a web of junctions rather than long winding runs.
  const add = (k: number): void => {
    chosen.add(k);
    degree[shuffled[k].a]++;
    degree[shuffled[k].b]++;
  };
  for (let n = 0; n < nc * nr; n++) {
    if (degree[n] >= 2) continue;
    const options = extra.filter(
      (k) => !chosen.has(k) && (shuffled[k].a === n || shuffled[k].b === n),
    );
    if (options.length > 0) add(options[Math.floor(rand() * options.length)]);
  }
  for (const k of extra) {
    if (!chosen.has(k) && rand() < 0.22) add(k);
  }

  const grid: string[][] = Array.from({ length: 18 }, () =>
    new Array<string>(36).fill(ROCK),
  );
  const open = (tx: number, ty: number): void => {
    grid[ty][tx] = OPEN;
    grid[ty][35 - tx] = OPEN;
  };
  for (let n = 0; n < nc * nr; n++) {
    open(NODE_COLS[n % nc], NODE_ROWS[Math.floor(n / nc)]);
  }
  for (const k of chosen) {
    const { a, b } = shuffled[k];
    const ax = NODE_COLS[a % nc];
    const ay = NODE_ROWS[Math.floor(a / nc)];
    const bx = NODE_COLS[b % nc];
    const by = NODE_ROWS[Math.floor(b / nc)];
    open((ax + bx) / 2, (ay + by) / 2);
  }
  for (const r of crossings) {
    for (let tx = 15; tx <= 17; tx++) open(tx, r);
  }
  open(0, tunnel);
  open(1, tunnel);
  for (let ty = DEN_ROWS[0]; ty <= DEN_ROWS[1]; ty++) {
    for (let tx = DEN_COLS[0]; tx <= DEN_COLS[1]; tx++) grid[ty][tx] = DEN;
  }
  grid[GATE_TILE.ty][GATE_TILE.tx] = GATE;
  return grid.map((r) => r.join(""));
}

/** A conforming layout. A draw the validator rejects is discarded and redrawn. */
export function generateMaze(rand: () => number): string[] {
  for (let attempt = 0; attempt < 64; attempt++) {
    const rows = carveLayout(rand);
    if (mazeViolations(rows).length === 0) return rows;
  }
  return [...FALLBACK_MAZE];
}

/** A layout drawn by the generator and passed by the validator, kept for the
 * vanishingly unlikely run in which every draw fails. */
export const FALLBACK_MAZE: readonly string[] = [
  "####################################",
  "##.......#.....######.....#.......##",
  "##.#.#.#.#.#.#.######.#.#.#.#.#.#.##",
  "##.....#...#...######...#...#.....##",
  "##.#.###.#.##############.#.###.#.##",
  "##...#...#................#...#...##",
  "####.#.#####.####g#####.#####.#.####",
  "##...#.....#...#dddd#...#.....#...##",
  "##.#.#.###.#.#.#dddd#.#.#.###.#.#.##",
  "##.......#.....#dddd#.....#.......##",
  "##.#.#.#.#.#.##########.#.#.#.#.#.##",
  ".........#.#...######...#.#.........",
  "##.###.#.#.#.#.######.#.#.#.#.###.##",
  "##...........#........#...........##",
  "##.#.#.#.#.#.#.######.#.#.#.#.#.#.##",
  "##.......#.....######.....#.......##",
  "####################################",
  "####################################",
];
