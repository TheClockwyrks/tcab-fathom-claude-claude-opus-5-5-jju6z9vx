// Fathom — the game: the state it holds, the debug surface that poses and reads
// that state, and the three functions the engine drives.
//
// The simulation lives in `sim.ts`, a frame's input and fixed-step loop in
// `flow.ts`, the debug surface in `debug.ts`, and the drawing in `render.ts`.
// This module declares the types they share and binds them to the engine.

import type { Game, InitApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { ACTIONS, BINDINGS, type PredatorKind } from "./constants";
import { loadArt, type Art } from "./art";
import { defineCues } from "./audio";
import { createDebug } from "./debug";
import { createState, frame } from "./flow";
import { BACKGROUND, draw } from "./render";
import { registerDiagnostics } from "./diagnostics";

export { BACKGROUND };
export type { Art, PredatorKind };

// ---- The state ---------------------------------------------------------------

export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

export type Dir = "up" | "down" | "left" | "right";

/** A tile of the grid, by column and row. */
export interface Tile {
  readonly tx: number;
  readonly ty: number;
}

export type PredatorState = "den" | "wander" | "chase" | "search";
export type FlarePhase = "idle" | "charge" | "bloom";
export type PulseSource = "forager" | "gloamfin";
export type PulseTint = "cyan" | "violet" | "orange";

export interface Forager {
  /** Its center, in logical units. */
  x: number;
  y: number;
  /** Its facing, whether moving or at rest. */
  dir: Dir;
  moving: boolean;
  /** The buffered direction the last movement action asked for. */
  desired: Dir | null;
}

export interface Drifter {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  /** Whether its body is drawn this instant. */
  lit: boolean;
  mind: boolean;
  travel: boolean;
}

export interface Predator {
  /** Unique for the session, so a ping in flight still knows its caster. */
  id: number;
  kind: PredatorKind;
  x: number;
  y: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  mind: boolean;
  travel: boolean;
  /** Seconds into live play its den slot opens; null for one added by a pose. */
  releaseAt: number | null;
  /** The tile it believes the forager is on, while it holds a fix. */
  fix: Tile | null;
  /** Seconds left on its detection alert. */
  alertTime: number;
  /** Seconds left on a sonar mark. */
  markTime: number;
  /** Whether its body is drawn this instant. */
  lit: boolean;
  /** Seconds left before a lapsed light-sense fix is dropped. */
  linger: number | null;
  // The Gloamfin.
  hearingLock: boolean;
  pingTimer: number;
  /** Seconds since its last ping. */
  sincePing: number;
  chaseSpeed: number;
  /** Seconds into its current search. */
  searchTime: number;
  searchPinged: boolean;
  // The Flarefish.
  flarePhase: FlarePhase;
  /** Seconds into the current charge or bloom. */
  flareTime: number;
  /** Seconds until the next charge-up, counted while it wanders. */
  flareTimer: number;
  /** Seconds left on the bloom art's fade beat. */
  fadeTime: number;
}

export interface Pulse {
  source: PulseSource;
  tint: PulseTint;
  ox: number;
  oy: number;
  /** How far the front has traveled, in corridor steps. */
  front: number;
  range: number;
  /** The furthest whole step whose tiles the front has already reached. */
  reached: number;
  /** Whether a ping has already caught the forager. */
  caught: boolean;
  /** The id of the Gloamfin that cast a ping. */
  caster: number | null;
  /** Corridor steps from the origin to every tile, -1 where it never floods. */
  dist: number[];
}

export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/**
 * The whole of the game's state. The fields named in specs/state.md carry the
 * names and meanings given there; the readings that follow from the world —
 * tiles of bodies, V and R, ranges, readiness, the plankton count and predator
 * speeds — are worked out at the read by the snapshot.
 */
export interface FathomState {
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  /** Accumulated simulation time, in seconds, always a whole number of ticks. */
  simTime: number;
  /** Frame time not yet spent on a whole tick, in seconds. */
  carry: number;
  /** Ticks left on the dive countdown or the cleared interstitial. */
  screenTimer: number;
  /** The layout, in the snapshot's alphabet. */
  tiles: string[];
  /** `*` where a plankton stands, `-` elsewhere. */
  plankton: string[];
  /** `u`, `r` or `l` per tile, as the fog of war last drew it. */
  visibility: string[];
  brightness: number;
  brightHold: number;
  sonar: { cooldown: number };
  ink: { cooldown: number };
  drifterIn: number;
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  /** Ticks of live play since the release schedule's origin; null before it. */
  releaseClock: number | null;
  nextId: number;
  /** The generator's state, and the seed a reset restarts it from. */
  rng: number;
  seed: number;
  /** The menu item a pointer press landed on, awaiting its release. */
  press: number | null;
  /** The sprite sheets, loaded once. */
  art: Art;
}

// ---- The snapshot -------------------------------------------------------------

export interface FathomSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    moving: boolean;
  };
  drifters: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    lit: boolean;
    mind: boolean;
    travel: boolean;
  }[];
  predators: {
    kind: PredatorKind;
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    state: PredatorState;
    released: boolean;
    mind: boolean;
    travel: boolean;
    speed: number;
    alert: boolean;
    lit: boolean;
    detectRange: number | null;
    hearingRange: number | null;
    hearingLock: boolean | null;
    flareCharging: boolean | null;
    flaring: boolean | null;
    flareRadius: number | null;
  }[];
  pulses: {
    source: PulseSource;
    tint: PulseTint;
    ox: number;
    oy: number;
    front: number;
    range: number;
  }[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
}

// ---- The debug surface ----------------------------------------------------------

type View = DeepReadonly<FathomState>;

/** The debugging and automation surface of specs/instrumentation.md. */
export interface FathomDebugApi {
  readonly version: number;
  reset(state: View): FathomState;
  snapshot(state: View): FathomSnapshot;
  reconcile(state: View): FathomState;
  setScreen(state: View, s: Screen): FathomState;
  setMenuIndex(state: View, index: number): FathomState;
  setTitleIndex(state: View, index: number): FathomState;
  menuItemRect(
    state: View,
    index: number,
  ): { x: number; y: number; w: number; h: number } | null;
  setScore(state: View, points: number): FathomState;
  setLives(state: View, n: number): FathomState;
  setDepth(state: View, d: number): FathomState;
  setMaze(state: View, rows: readonly string[]): FathomState;
  setPlankton(
    state: View,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(state: View): FathomState;
  clearFog(state: View): FathomState;
  setForagerTile(state: View, tx: number, ty: number): FathomState;
  setForagerDir(state: View, dir: Dir): FathomState;
  setBrightness(state: View, g: number): FathomState;
  setBrightHold(state: View, seconds: number): FathomState;
  clearPredators(state: View): FathomState;
  addPredator(
    state: View,
    kind: PredatorKind,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorTile(
    state: View,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(state: View, index: number, dir: Dir): FathomState;
  setPredatorState(
    state: View,
    index: number,
    value: "den" | "wander" | "chase",
  ): FathomState;
  setPredatorReleased(
    state: View,
    index: number,
    released: boolean,
  ): FathomState;
  setPredatorMind(state: View, index: number, enabled: boolean): FathomState;
  setPredatorTravel(state: View, index: number, enabled: boolean): FathomState;
  spawnDrifter(state: View, tx: number, ty: number): FathomState;
  clearDrifters(state: View): FathomState;
  setDrifterMind(state: View, index: number, enabled: boolean): FathomState;
  setDrifterTravel(state: View, index: number, enabled: boolean): FathomState;
  setDrifterIn(state: View, seconds: number): FathomState;
  setSonarCooldown(state: View, seconds: number): FathomState;
  setInkCooldown(state: View, seconds: number): FathomState;
}

// ---- The game -------------------------------------------------------------------

/** A seed for the session's mazes. Gameplay itself never draws from Math.random. */
function sessionSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(
    api: InitApi<FathomState>,
  ): Promise<[FathomState, FathomDebugApi]> {
    for (const name of ACTIONS) {
      api.input.register(name, { keys: [...BINDINGS[name]] });
    }
    defineCues(api);
    registerDiagnostics(api);
    const art = await loadArt(api);
    return [createState(sessionSeed(), art, false), createDebug()];
  },

  update: frame,

  render: draw,
};
