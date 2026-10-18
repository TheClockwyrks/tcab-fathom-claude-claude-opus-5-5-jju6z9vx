// Fathom — the fixed-step simulation. Everything here works on a draft: a
// private copy of the state that the frame owns, built by `thaw` and returned
// as the next state, so nothing the engine holds is ever written into.

import type { DeepReadonly } from "ts-essentials";
import {
  ALERT_TIME,
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  FORAGER_SPEED,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GLOAMFIN_PING_RANGE,
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  GLOAMFIN_SEARCH_ROAM,
  GRID_COLS,
  GRID_ROWS,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  LINGER_TIME,
  PREDATOR_SPEED,
  ROSTER_ADD_ORDER,
  ROSTER_CAP,
  ROSTER_CAP_DEPTH,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  SONAR_WAVE_SPEED,
  START_LIVES,
  TICK_DT,
  TILE,
  VISION_GAIN,
  VISION_MIN,
  CUES,
  type CueName,
  type PredatorKind,
} from "./constants";
import type {
  Dir,
  Drifter,
  FathomState,
  Predator,
  PulseTint,
  Tile,
} from "./game";
import {
  DELTA,
  DIRS,
  MAZE_LEFT,
  MAZE_RIGHT,
  OPPOSITE,
  centerX,
  centerY,
  denExit,
  denTiles,
  distanceField,
  generateMaze,
  index,
  inGrid,
  isDenPassable,
  isOpen,
  neighbor,
  sameTile,
  segmentBlocked,
  startTileOf,
  tileAt,
  tileOf,
  type Rows,
} from "./maze";
import { drawFrom } from "./random";

/** How long the dive countdown holds, in ticks (2 s). */
const COUNTDOWN_TICKS = 240;
/** How long the cleared interstitial holds, in ticks (2.5 s). */
const CLEARED_TICKS = 300;
/** How long the bloom art's fade beat plays after a flare ends, in seconds. */
export const FLARE_FADE = 0.35;

const EPS = 1e-7;
const WRAP_SPAN = MAZE_RIGHT - MAZE_LEFT;
const RAMP_RATE =
  (GLOAMFIN_CHASE_SPEED - GLOAMFIN_CORNER_SPEED) / GLOAMFIN_RAMP_TIME;

/** A timer one tick further down, landing on exactly 0 rather than a residue. */
function countDown(seconds: number): number {
  return seconds - TICK_DT <= EPS ? 0 : seconds - TICK_DT;
}

// ---- Readings derived from the world --------------------------------------

export function visionRadius(g: number): number {
  return VISION_MIN + VISION_GAIN * g;
}

export function windowRadius(g: number): number {
  return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * g;
}

export function detectRange(g: number): number {
  return LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * g;
}

export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/** The rate a predator travels at in the state it is in. */
export function speedOf(p: DeepReadonly<Predator>): number {
  switch (p.kind) {
    case "lanternjaw":
      return p.state === "chase" ? PREDATOR_SPEED : DRIFTER_SPEED;
    case "gloamfin":
      return p.state === "chase" ? p.chaseSpeed : PREDATOR_SPEED;
    case "flarefish":
      return PREDATOR_SPEED;
  }
}

export function plankRemaining(plankton: readonly string[]): number {
  let n = 0;
  for (const row of plankton) for (const c of row) if (c === "*") n++;
  return n;
}

/** The kinds a depth's roster holds, in release order. */
function rosterFor(depth: number): PredatorKind[] {
  const kinds = [...DEN_ORDER];
  const cap = DEN_ORDER.length * ROSTER_CAP;
  const extra = Math.min(depth, ROSTER_CAP_DEPTH) - 1;
  for (let k = 0; k < extra && kinds.length < cap; k++) {
    kinds.push(ROSTER_ADD_ORDER[k % ROSTER_ADD_ORDER.length]);
  }
  return kinds;
}

// ---- The draft -------------------------------------------------------------

/**
 * A private, writable copy of a state, for a transition to build the next
 * state in. The art is shared by reference: it never changes after loading.
 */
export function thaw(state: DeepReadonly<FathomState>): FathomState {
  const { art, ...rest } = state;
  const copy = structuredClone(rest) as Omit<FathomState, "art">;
  return { ...copy, art: art as FathomState["art"] };
}

export function foragerTile(s: DeepReadonly<FathomState>): Tile {
  return tileOf(s.forager.x, s.forager.y);
}

// ---- Laying out mazes, attempts, and dives --------------------------------

export function makePredator(
  id: number,
  kind: PredatorKind,
  tile: Tile,
  releaseAt: number | null,
): Predator {
  return {
    id,
    kind,
    x: centerX(tile.tx),
    y: centerY(tile.ty),
    dir: "up",
    state: "den",
    released: false,
    mind: true,
    travel: true,
    releaseAt,
    fix: null,
    alertTime: 0,
    markTime: 0,
    lit: false,
    linger: null,
    hearingLock: false,
    pingTimer: GLOAMFIN_PING_INTERVAL,
    sincePing: GLOAMFIN_PING_MIN_GAP,
    chaseSpeed: GLOAMFIN_CHASE_SPEED,
    searchTime: 0,
    searchPinged: false,
    flarePhase: "idle",
    flareTime: 0,
    flareTimer: FLARE_INTERVAL,
    fadeTime: 0,
  };
}

/** The den tile the predator in release slot `slot` waits on. */
function denSlot(rows: Rows, slot: number): Tile {
  const tiles = denTiles(rows);
  if (tiles.length === 0) return { tx: 16 + (slot % 4), ty: 8 };
  const midX = tiles.reduce((a, t) => a + t.tx, 0) / tiles.length;
  const midY = tiles.reduce((a, t) => a + t.ty, 0) / tiles.length;
  const ranked = [...tiles].sort(
    (a, b) =>
      Math.abs(a.ty - midY) - Math.abs(b.ty - midY) ||
      Math.abs(a.tx - midX) - Math.abs(b.tx - midX) ||
      a.tx - b.tx,
  );
  return ranked[slot % ranked.length];
}

/** The depth's own roster, laid out in the den with every release pending. */
export function layOutRoster(s: FathomState): void {
  s.predators = rosterFor(s.depth).map((kind, slot) =>
    makePredator(
      s.nextId++,
      kind,
      denSlot(s.tiles, slot),
      slot * DEN_RELEASE_GAP,
    ),
  );
  s.releaseClock = null;
}

/** The arrangement an attempt starts from: a new maze, or after a lost life. */
function startAttempt(s: FathomState): void {
  const start = startTileOf(s.tiles);
  if (start) {
    s.forager.x = centerX(start.tx);
    s.forager.y = centerY(start.ty);
  }
  s.forager.dir = "left";
  s.forager.desired = null;
  s.forager.moving = false;
  s.brightness = 0;
  s.brightHold = 0;
  s.drifters = [];
  s.drifterIn = DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar = { cooldown: 0 };
  s.ink = { cooldown: 0 };
  layOutRoster(s);
}

/** A fresh maze at the current depth: full plankton and unrevealed fog. */
function layOutMaze(s: FathomState): void {
  s.tiles = generateMaze(drawFrom(s));
  s.plankton = s.tiles.map((r) =>
    r.replace(/./g, (c) => (c === "." ? "*" : "-")),
  );
  s.visibility = s.tiles.map(() => "u".repeat(GRID_COLS));
  startAttempt(s);
}

/** The values every dive opens with, on whichever screen is given. */
export function freshDive(s: FathomState): void {
  s.score = 0;
  s.lives = START_LIVES;
  s.depth = 1;
  layOutMaze(s);
}

export function setScreenTo(
  s: FathomState,
  screen: FathomState["screen"],
): void {
  s.screen = screen;
  s.press = null;
  switch (screen) {
    case "title":
      s.menuIndex = s.titleIndex;
      break;
    case "paused":
    case "gameover":
      s.menuIndex = 0;
      break;
    default:
      s.menuIndex = null;
  }
  if (screen === "countdown") s.screenTimer = COUNTDOWN_TICKS;
  if (screen === "cleared") s.screenTimer = CLEARED_TICKS;
}

export function beginDive(s: FathomState): void {
  freshDive(s);
  setScreenTo(s, "countdown");
}

// ---- Bodies on the grid ----------------------------------------------------

interface Body {
  x: number;
  y: number;
  dir: Dir;
}

type Decide = (t: Tile) => Dir | null;

/** How far a body stands past its tile's center along its heading. */
function along(b: Body): number {
  const t = tileOf(b.x, b.y);
  return (
    DELTA[b.dir].dx * (b.x - centerX(t.tx)) +
    DELTA[b.dir].dy * (b.y - centerY(t.ty))
  );
}

function atCenter(b: Body): boolean {
  const t = tileOf(b.x, b.y);
  return (
    Math.abs(b.x - centerX(t.tx)) < EPS && Math.abs(b.y - centerY(t.ty)) < EPS
  );
}

function shift(b: Body, m: number): void {
  b.x += DELTA[b.dir].dx * m;
  b.y += DELTA[b.dir].dy * m;
  if (b.x < MAZE_LEFT) b.x += WRAP_SPAN;
  else if (b.x >= MAZE_RIGHT) b.x -= WRAP_SPAN;
}

/**
 * Carries a body `distance` units along the corridor center lines. Between
 * centers it keeps its heading; at each center `decide` names the heading out,
 * or `null` to come to rest there. Returns the distance actually traveled.
 */
function travel(b: Body, distance: number, decide: Decide): number {
  let left = distance;
  let moved = 0;
  for (let guard = 0; left > EPS && guard < 16; guard++) {
    const off = along(b);
    if (Math.abs(off) < EPS) {
      const t = tileOf(b.x, b.y);
      b.x = centerX(t.tx);
      b.y = centerY(t.ty);
      const d = decide(t);
      if (d === null) break;
      b.dir = d;
      const m = Math.min(left, TILE);
      shift(b, m);
      left -= m;
      moved += m;
      continue;
    }
    const m = Math.min(left, off < 0 ? -off : TILE - off);
    shift(b, m);
    left -= m;
    moved += m;
  }
  return moved;
}

function opener(
  rows: Rows,
  passable: (rows: Rows, tx: number, ty: number) => boolean,
): (t: Tile, d: Dir) => Tile | null {
  return (t, d) => {
    const n = neighbor(rows, t.tx, t.ty, d);
    return n && passable(rows, n.tx, n.ty) ? n : null;
  };
}

/** The drifter's routing, shared by every wandering creature. */
function wanderDecide(rows: Rows, body: Body, rand: () => number): Decide {
  const open = opener(rows, isOpen);
  return (t) => {
    const options = DIRS.filter((d) => d !== OPPOSITE[body.dir] && open(t, d));
    if (options.length > 0) return options[Math.floor(rand() * options.length)];
    return open(t, OPPOSITE[body.dir]) ? OPPOSITE[body.dir] : null;
  };
}

/** The first step of a shortest corridor route down a distance field. */
function descend(
  rows: Rows,
  field: readonly number[],
  body: Body,
  passable: (rows: Rows, tx: number, ty: number) => boolean,
): Decide {
  const open = opener(rows, passable);
  return (t) => {
    let best: Dir | null = null;
    let bestDist = field[index(t.tx, t.ty)];
    if (bestDist <= 0) return null;
    for (const d of [body.dir, ...DIRS]) {
      const n = open(t, d);
      if (!n) continue;
      const nd = field[index(n.tx, n.ty)];
      if (nd >= 0 && nd < bestDist) {
        best = d;
        bestDist = nd;
      }
    }
    return best;
  };
}

// ---- Sensing helpers -------------------------------------------------------

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function segmentPointDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return distance(ax + dx * t, ay + dy * t, px, py);
}

/** Whether ink blinds a hunter that sees: it stands in a cloud or one lies between. */
function inkBlinds(s: DeepReadonly<FathomState>, p: Body): boolean {
  const f = s.forager;
  return s.inkClouds.some(
    (c) =>
      distance(p.x, p.y, c.x, c.y) <= INK_RADIUS ||
      segmentPointDistance(p.x, p.y, f.x, f.y, c.x, c.y) <= INK_RADIUS,
  );
}

/** The Lanternjaw's and the Flarefish's light-sense, ink aside. */
function seesLight(s: FathomState, p: Predator): boolean {
  const f = s.forager;
  return (
    distance(p.x, p.y, f.x, f.y) <= detectRange(s.brightness) &&
    !segmentBlocked(s.tiles, p.x, p.y, f.x, f.y)
  );
}

// ---- Predator minds --------------------------------------------------------

function endFlare(p: Predator): void {
  if (p.flarePhase === "bloom") p.fadeTime = FLARE_FADE;
  p.flarePhase = "idle";
  p.flareTime = 0;
}

/** Takes a fix; a predator not already chasing acquires it fresh. */
function acquire(p: Predator, fix: Tile): void {
  p.fix = fix;
  p.linger = null;
  if (p.state === "chase") return;
  p.state = "chase";
  if (p.kind !== "lanternjaw") p.alertTime = ALERT_TIME;
  if (p.kind === "gloamfin") {
    p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    p.searchTime = 0;
    p.searchPinged = false;
  }
  if (p.kind === "flarefish") endFlare(p);
}

function dropToWander(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = null;
  p.searchTime = 0;
  p.searchPinged = false;
  if (p.kind === "flarefish") p.flareTimer = FLARE_INTERVAL;
}

/** Leaves the den chamber: loose, patrolling, with fresh timers. */
export function becomeLoose(p: Predator): void {
  dropToWander(p);
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.sincePing = GLOAMFIN_PING_MIN_GAP;
  p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  p.flarePhase = "idle";
  p.flareTime = 0;
  p.flareTimer = FLARE_INTERVAL;
}

/** The light-hunters' chase bookkeeping: sense, linger, or drop. */
function lightHunt(s: FathomState, p: Predator, blind: boolean): void {
  const sense = !blind && seesLight(s, p);
  if (blind && p.state === "chase") dropToWander(p);
  if (sense) {
    acquire(p, foragerTile(s));
  } else if (p.state === "chase") {
    p.linger = (p.linger ?? LINGER_TIME) - TICK_DT;
    if (p.linger <= EPS) dropToWander(p);
  }
}

function flarefishFlare(
  s: FathomState,
  p: Predator,
  blind: boolean,
  cues: Set<CueName>,
): void {
  if (p.state !== "wander") return;
  if (p.flarePhase === "idle") {
    p.flareTimer = countDown(p.flareTimer);
    if (p.flareTimer <= EPS) {
      p.flarePhase = "charge";
      p.flareTime = 0;
    }
    return;
  }
  p.flareTime += TICK_DT;
  if (p.flarePhase === "charge") {
    if (p.flareTime >= FLARE_CHARGE - EPS) {
      p.flarePhase = "bloom";
      p.flareTime = 0;
      cues.add(CUES.flare);
    }
    return;
  }
  const f = s.forager;
  if (!blind && distance(p.x, p.y, f.x, f.y) <= FLARE_RADIUS) {
    acquire(p, foragerTile(s));
    p.flareTimer = FLARE_INTERVAL;
  } else if (p.flareTime >= FLARE_BLOOM - EPS) {
    endFlare(p);
    p.flareTimer = FLARE_INTERVAL;
  }
}

function castPulse(
  s: FathomState,
  source: "forager" | "gloamfin",
  tint: PulseTint,
  origin: Tile,
  range: number,
  caster: number | null,
): void {
  s.pulses.push({
    source,
    tint,
    ox: origin.tx,
    oy: origin.ty,
    front: 0,
    range,
    reached: -1,
    caught: false,
    caster,
    dist: distanceField(s.tiles, [origin], (x, y) => isOpen(s.tiles, x, y)),
  });
}

function gloamfinMind(s: FathomState, p: Predator, cues: Set<CueName>): void {
  p.pingTimer = countDown(p.pingTimer);
  p.sincePing += TICK_DT;
  if (p.state === "chase") {
    p.chaseSpeed = Math.min(
      GLOAMFIN_CHASE_SPEED,
      p.chaseSpeed + RAMP_RATE * TICK_DT,
    );
  }
  const f = s.forager;
  p.hearingLock = distance(p.x, p.y, f.x, f.y) <= GLOAMFIN_HEAR;
  if (p.hearingLock) acquire(p, foragerTile(s));
  if (p.state === "search") {
    p.searchTime += TICK_DT;
    if (p.searchTime >= GLOAMFIN_GIVEUP - EPS) dropToWander(p);
  }
  if (p.hearingLock || p.sincePing < GLOAMFIN_PING_MIN_GAP - EPS) return;
  const guaranteed =
    p.state === "search" &&
    !p.searchPinged &&
    p.searchTime >= GLOAMFIN_SEARCH_DELAY - EPS;
  if (!guaranteed && p.pingTimer > EPS) return;
  if (guaranteed) p.searchPinged = true;
  castPulse(
    s,
    "gloamfin",
    guaranteed ? "orange" : "violet",
    tileOf(p.x, p.y),
    GLOAMFIN_PING_RANGE,
    p.id,
  );
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  cues.add(CUES.predatorPing);
}

function predatorMind(s: FathomState, p: Predator, cues: Set<CueName>): void {
  p.alertTime = countDown(p.alertTime);
  if (p.kind === "gloamfin") {
    gloamfinMind(s, p, cues);
    return;
  }
  const blind = inkBlinds(s, p);
  lightHunt(s, p, blind);
  if (p.kind === "flarefish") flarefishFlare(s, p, blind, cues);
}

/** Reverses a chaser mid-tile when the way back is the shorter route. */
function chaseReversal(
  rows: Rows,
  p: Predator,
  field: readonly number[],
): void {
  const off = along(p);
  if (Math.abs(off) < EPS) return;
  const t = tileOf(p.x, p.y);
  const ahead = off < 0 ? t : neighbor(rows, t.tx, t.ty, p.dir);
  const behind = off < 0 ? neighbor(rows, t.tx, t.ty, OPPOSITE[p.dir]) : t;
  if (!ahead || !behind) return;
  const da = field[index(ahead.tx, ahead.ty)];
  const db = field[index(behind.tx, behind.ty)];
  if (db < 0) return;
  const costAhead = (off < 0 ? -off : TILE - off) + TILE * da;
  const costBehind = (off < 0 ? TILE + off : off) + TILE * db;
  if (da < 0 || costBehind < costAhead - EPS) p.dir = OPPOSITE[p.dir];
}

function searchDecide(
  rows: Rows,
  p: Predator,
  origin: Tile,
  rand: () => number,
): Decide {
  const field = distanceField(rows, [origin], (x, y) => isOpen(rows, x, y));
  const open = opener(rows, isOpen);
  const fieldAt = (t: Tile): number => field[index(t.tx, t.ty)];
  return (t) => {
    const inside = DIRS.filter((d) => {
      const n = open(t, d);
      return (
        d !== OPPOSITE[p.dir] &&
        n &&
        fieldAt(n) >= 0 &&
        fieldAt(n) <= GLOAMFIN_SEARCH_ROAM
      );
    });
    if (inside.length > 0) return inside[Math.floor(rand() * inside.length)];
    let best: Dir | null = null;
    let bestDist = Infinity;
    for (const d of DIRS) {
      const n = open(t, d);
      if (n && fieldAt(n) >= 0 && fieldAt(n) < bestDist) {
        best = d;
        bestDist = fieldAt(n);
      }
    }
    return best;
  };
}

function movePredator(s: FathomState, p: Predator, rand: () => number): void {
  const here = tileOf(p.x, p.y);
  if (!isOpen(s.tiles, here.tx, here.ty)) return;
  const step = speedOf(p) * TICK_DT;
  if (p.state === "chase" && p.fix) {
    const fix = p.fix;
    const field = distanceField(s.tiles, [fix], (x, y) =>
      isOpen(s.tiles, x, y),
    );
    if (field[index(here.tx, here.ty)] < 0) {
      travel(p, step, wanderDecide(s.tiles, p, rand));
      return;
    }
    chaseReversal(s.tiles, p, field);
    const route = descend(s.tiles, field, p, isOpen);
    let turned = false;
    travel(p, step, (t) => {
      const d = route(t);
      if (d && d !== p.dir && d !== OPPOSITE[p.dir]) turned = true;
      return d;
    });
    if (turned && p.kind === "gloamfin") p.chaseSpeed = GLOAMFIN_CORNER_SPEED;
    return;
  }
  if (p.state === "search" && p.fix) {
    travel(p, step, searchDecide(s.tiles, p, p.fix, rand));
    return;
  }
  travel(p, step, wanderDecide(s.tiles, p, rand));
}

function denSwim(s: FathomState, p: Predator): void {
  // A layout with no den chamber holds its den-state predators out of play.
  const exit = denTiles(s.tiles).length > 0 ? denExit(s.tiles) : null;
  const here = tileOf(p.x, p.y);
  if (!exit || !isDenPassable(s.tiles, here.tx, here.ty)) return;
  const field = distanceField(s.tiles, [exit], (x, y) =>
    isDenPassable(s.tiles, x, y),
  );
  if (field[index(here.tx, here.ty)] < 0) return;
  travel(p, speedOf(p) * TICK_DT, descend(s.tiles, field, p, isDenPassable));
  if (atCenter(p) && sameTile(tileOf(p.x, p.y), exit)) becomeLoose(p);
}

function stepPredator(
  s: FathomState,
  p: Predator,
  rand: () => number,
  cues: Set<CueName>,
): void {
  p.markTime = countDown(p.markTime);
  p.fadeTime = countDown(p.fadeTime);
  if (!p.mind) return;
  if (p.state === "den") {
    if (p.released && p.travel) denSwim(s, p);
    return;
  }
  predatorMind(s, p, cues);
  if (!p.travel) return;
  movePredator(s, p, rand);
  if (
    p.kind === "gloamfin" &&
    p.state === "chase" &&
    p.fix &&
    !p.hearingLock &&
    atCenter(p) &&
    sameTile(tileOf(p.x, p.y), p.fix) &&
    !sameTile(foragerTile(s), p.fix)
  ) {
    p.state = "search";
    p.searchTime = 0;
    p.searchPinged = false;
  }
}

// ---- The forager and the drifters -------------------------------------------

function stepForager(s: FathomState, held: boolean): void {
  const f = s.forager;
  const wasMoving = f.moving;
  const here = tileOf(f.x, f.y);
  if (!held || !isOpen(s.tiles, here.tx, here.ty)) {
    f.moving = false;
    return;
  }
  const want = f.desired;
  if (want && want === OPPOSITE[f.dir] && !atCenter(f)) f.dir = want;
  const open = opener(s.tiles, isOpen);
  const moved = travel(f, FORAGER_SPEED * TICK_DT, (t) => {
    if (want && open(t, want)) return want;
    if (!wasMoving) return null;
    return open(t, f.dir) ? f.dir : null;
  });
  f.moving = moved > 0;
}

function stepDrifters(s: FathomState, rand: () => number): void {
  for (const d of s.drifters) {
    const here = tileOf(d.x, d.y);
    if (!d.mind || !d.travel || !isOpen(s.tiles, here.tx, here.ty)) continue;
    travel(d, DRIFTER_SPEED * TICK_DT, wanderDecide(s.tiles, d, rand));
  }
}

export function makeDrifter(id: number, tile: Tile): Drifter {
  return {
    id,
    x: centerX(tile.tx),
    y: centerY(tile.ty),
    dir: "up",
    lit: false,
    mind: true,
    travel: true,
  };
}

function admitDrifters(s: FathomState): void {
  s.drifterIn = countDown(s.drifterIn);
  if (s.drifterIn > EPS) return;
  const exit = denExit(s.tiles);
  if (
    !exit ||
    plankRemaining(s.plankton) === 0 ||
    s.drifters.length >= DRIFTER_MAX
  ) {
    return;
  }
  s.drifters.push(makeDrifter(s.nextId++, exit));
  s.drifterIn = DRIFTER_INTERVAL;
}

/** Eats what shares the forager's tile. Returns true when the maze is cleared. */
function eat(s: FathomState, cues: Set<CueName>): boolean {
  const t = foragerTile(s);
  const row = s.plankton[t.ty];
  if (row[t.tx] === "*") {
    s.plankton[t.ty] = row.slice(0, t.tx) + "-" + row.slice(t.tx + 1);
    s.score += SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + BRIGHT_PER_EAT);
    s.brightHold = BRIGHT_HOLD;
    cues.add(CUES.eat);
    if (plankRemaining(s.plankton) === 0) {
      s.score += SCORE_CLEAR;
      cues.add(CUES.descend);
      setScreenTo(s, "cleared");
      return true;
    }
  }
  const kept = s.drifters.filter((d) => !sameTile(tileOf(d.x, d.y), t));
  s.score += SCORE_DRIFTER * (s.drifters.length - kept.length);
  s.drifters = kept;
  return false;
}

// ---- Wavefronts -------------------------------------------------------------

function ringReached(
  s: FathomState,
  pulse: FathomState["pulses"][number],
  k: number,
): void {
  const f = foragerTile(s);
  if (pulse.source === "gloamfin") {
    if (pulse.caught || pulse.dist[index(f.tx, f.ty)] !== k) return;
    pulse.caught = true;
    const caster = s.predators.find((p) => p.id === pulse.caster);
    if (caster && caster.mind && caster.state !== "den") acquire(caster, f);
    return;
  }
  for (const p of s.predators) {
    if (p.state === "den" || p.kind === "lanternjaw") continue;
    const t = tileOf(p.x, p.y);
    if (pulse.dist[index(t.tx, t.ty)] !== k) continue;
    p.markTime = SONAR_MARK_TIME;
    if (p.kind === "gloamfin" && p.mind) acquire(p, f);
  }
}

/** Advances every wavefront, and lights what the forager's pulses have flooded. */
function stepPulses(s: FathomState, lit: boolean[]): void {
  for (const pulse of s.pulses) {
    pulse.front += SONAR_WAVE_SPEED * TICK_DT;
    const reach = Math.min(pulse.range, Math.floor(pulse.front + EPS));
    for (let k = pulse.reached + 1; k <= reach; k++) ringReached(s, pulse, k);
    pulse.reached = Math.max(pulse.reached, reach);
    if (pulse.source === "forager")
      floodLight(s.tiles, pulse.dist, pulse.reached, lit);
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range + EPS);
}

/** Lights the flooded corridor tiles and the rock that bounds them. */
function floodLight(
  rows: Rows,
  dist: readonly number[],
  reached: number,
  lit: boolean[],
): void {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const d = dist[index(tx, ty)];
      if (d < 0 || d > reached) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (!inGrid(nx, ny)) continue;
          if ((ox === 0 && oy === 0) || tileAt(rows, nx, ny) === "#") {
            lit[index(nx, ny)] = true;
          }
        }
      }
    }
  }
}

// ---- Light -------------------------------------------------------------------

/** The tiles the forager's own light reaches, by straight line within V. */
function lightPocket(s: DeepReadonly<FathomState>): boolean[] {
  const pocket = new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false);
  const f = s.forager;
  const v = visionRadius(s.brightness);
  const here = tileOf(f.x, f.y);
  const reach = Math.ceil(v / TILE) + 1;
  for (let ty = here.ty - reach; ty <= here.ty + reach; ty++) {
    for (let tx = here.tx - reach; tx <= here.tx + reach; tx++) {
      if (!inGrid(tx, ty)) continue;
      const cx = centerX(tx);
      const cy = centerY(ty);
      if (distance(f.x, f.y, cx, cy) > v) continue;
      if (!segmentBlocked(s.tiles, f.x, f.y, cx, cy, { tx, ty })) {
        pocket[index(tx, ty)] = true;
      }
    }
  }
  return pocket;
}

function blooming(s: FathomState): Predator[] {
  return s.predators.filter(
    (p) =>
      p.kind === "flarefish" && p.state !== "den" && p.flarePhase === "bloom",
  );
}

/** Lights the frame's sources, updates the fog's memory, and marks what is drawn. */
function illuminate(s: FathomState, lit: boolean[]): void {
  const pocket = lightPocket(s);
  const flares = blooming(s);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const i = index(tx, ty);
      if (pocket[i]) lit[i] = true;
      const cx = centerX(tx);
      const cy = centerY(ty);
      if (flares.some((p) => distance(p.x, p.y, cx, cy) <= FLARE_RADIUS))
        lit[i] = true;
    }
  }
  s.visibility = s.visibility.map((row, ty) => {
    let out = "";
    for (let tx = 0; tx < GRID_COLS; tx++) {
      out += lit[index(tx, ty)] ? "l" : row[tx] === "u" ? "u" : "r";
    }
    return out;
  });
  const inFlare = (b: Body): boolean =>
    flares.some((p) => distance(p.x, p.y, b.x, b.y) <= FLARE_RADIUS);
  const inPocket = (b: Body): boolean => {
    const t = tileOf(b.x, b.y);
    return pocket[index(t.tx, t.ty)];
  };
  for (const p of s.predators) {
    p.lit =
      p.state !== "den" &&
      (inPocket(p) ||
        inFlare(p) ||
        (p.kind !== "lanternjaw" && (p.markTime > 0 || p.alertTime > 0)));
  }
  for (const d of s.drifters) d.lit = inPocket(d) || inFlare(d);
}

// ---- The tick ------------------------------------------------------------------

function releaseDue(s: FathomState): void {
  const clock = s.releaseClock ?? 0;
  s.releaseClock = clock;
  for (const p of s.predators) {
    if (
      !p.released &&
      p.releaseAt !== null &&
      clock * TICK_DT >= p.releaseAt - EPS
    ) {
      p.released = true;
    }
  }
}

function caught(s: FathomState, cues: Set<CueName>): void {
  cues.add(CUES.caught);
  if (s.lives <= 0) {
    setScreenTo(s, "gameover");
    return;
  }
  s.lives -= 1;
  startAttempt(s);
  setScreenTo(s, "countdown");
}

/** Whether a loose predator's center lies on the forager's tile. */
function inContact(s: FathomState): boolean {
  const here = foragerTile(s);
  return s.predators.some(
    (p) => p.state !== "den" && sameTile(tileOf(p.x, p.y), here),
  );
}

function playingTick(s: FathomState, held: boolean, cues: Set<CueName>): void {
  const rand = drawFrom(s);
  s.releaseClock = (s.releaseClock ?? 0) + 1;
  releaseDue(s);
  s.sonar.cooldown = countDown(s.sonar.cooldown);
  s.ink.cooldown = countDown(s.ink.cooldown);
  if (s.brightHold > 0) s.brightHold = countDown(s.brightHold);
  else s.brightness *= Math.pow(0.5, TICK_DT / BRIGHT_HALFLIFE);
  for (const c of s.inkClouds) c.remaining = countDown(c.remaining);
  s.inkClouds = s.inkClouds.filter((c) => c.remaining > EPS);
  admitDrifters(s);

  stepForager(s, held);
  if (eat(s, cues)) return;
  if (inContact(s)) {
    caught(s, cues);
    return;
  }
  stepDrifters(s, rand);
  if (eat(s, cues)) return;
  const lit = new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false);
  stepPulses(s, lit);
  for (const p of s.predators) stepPredator(s, p, rand, cues);
  if (inContact(s)) {
    caught(s, cues);
    return;
  }
  illuminate(s, lit);
}

/** One TICK_DT of the game on whatever screen it stands. */
export function tick(s: FathomState, held: boolean, cues: Set<CueName>): void {
  switch (s.screen) {
    case "countdown":
      s.screenTimer -= 1;
      if (s.screenTimer <= 0) {
        setScreenTo(s, "playing");
        s.releaseClock = null;
        releaseDue(s);
      }
      illuminate(s, new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false));
      return;
    case "playing":
      playingTick(s, held, cues);
      return;
    case "cleared":
      s.screenTimer -= 1;
      if (s.screenTimer <= 0) {
        s.depth += 1;
        layOutMaze(s);
        setScreenTo(s, "countdown");
      }
      return;
    default:
      return;
  }
}

// ---- The forager's two abilities ---------------------------------------------

export function emitSonar(s: FathomState, cues: Set<CueName>): void {
  if (s.sonar.cooldown > 0) return;
  s.sonar.cooldown = SONAR_COOLDOWN;
  castPulse(s, "forager", "cyan", foragerTile(s), sonarRange(s.depth), null);
  cues.add(CUES.sonar);
}

export function releaseInk(s: FathomState, cues: Set<CueName>): void {
  if (s.ink.cooldown > 0) return;
  s.ink.cooldown = INK_COOLDOWN;
  s.inkClouds.push({
    x: s.forager.x,
    y: s.forager.y,
    radius: INK_RADIUS,
    remaining: INK_LIFE,
  });
  cues.add(CUES.ink);
}
