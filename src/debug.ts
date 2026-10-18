// Fathom — the debugging and automation surface (specs/instrumentation.md).
// Every pose takes the current state and returns the next one, built on a
// draft; every reading takes the state and returns what it read. An argument
// outside its operation's domain throws rather than being guessed at.

import type { DeepReadonly } from "ts-essentials";
import {
  BRIGHT_HOLD,
  DRIFTER_INTERVAL,
  FATHOM_DEBUG_VERSION,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
  TITLE_ITEMS,
  type PredatorKind,
} from "./constants";
import type {
  Dir,
  FathomDebugApi,
  FathomSnapshot,
  FathomState,
  Predator,
  PredatorState,
  Screen,
} from "./game";
import { createState } from "./flow";
import { menuItems, menuRects } from "./layout";
import { DIRS, tileAt, tileOf } from "./maze";
import {
  becomeLoose,
  detectRange,
  foragerTile,
  layOutRoster,
  makeDrifter,
  makePredator,
  plankRemaining,
  setScreenTo,
  sonarRange,
  speedOf,
  thaw,
  visionRadius,
  windowRadius,
} from "./sim";
import { centerX, centerY } from "./maze";

const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];
const KINDS: readonly PredatorKind[] = ["lanternjaw", "gloamfin", "flarefish"];
const POSABLE: readonly PredatorState[] = ["den", "wander", "chase"];

function fail(op: string, message: string): never {
  throw new Error(`Fathom debug ${op}: ${message}`);
}

function wholeAtLeast(
  op: string,
  name: string,
  v: unknown,
  min: number,
): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
    fail(
      op,
      `${name} must be a whole number of at least ${min}, got ${String(v)}`,
    );
  }
  return v;
}

function within(
  op: string,
  name: string,
  v: unknown,
  lo: number,
  hi: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
    fail(op, `${name} must be a number in [${lo}, ${hi}], got ${String(v)}`);
  }
  return v;
}

function oneOf<T extends string>(
  op: string,
  name: string,
  v: unknown,
  set: readonly T[],
): T {
  if (typeof v !== "string" || !(set as readonly string[]).includes(v)) {
    fail(op, `${name} must be one of ${set.join(", ")}, got ${String(v)}`);
  }
  return v as T;
}

function flag(op: string, name: string, v: unknown): boolean {
  if (typeof v !== "boolean")
    fail(op, `${name} must be a boolean, got ${String(v)}`);
  return v;
}

/** A tile on the grid whose character is one of `kinds`. */
function tileArg(
  op: string,
  s: DeepReadonly<FathomState>,
  tx: unknown,
  ty: unknown,
  kinds: string,
): { tx: number; ty: number } {
  const x = wholeAtLeast(op, "tx", tx, 0);
  const y = wholeAtLeast(op, "ty", ty, 0);
  if (x >= GRID_COLS || y >= GRID_ROWS)
    fail(op, `tile ${x},${y} is off the grid`);
  if (!kinds.includes(tileAt(s.tiles, x, y))) {
    fail(op, `tile ${x},${y} is not open to it`);
  }
  return { tx: x, ty: y };
}

function predatorAt(op: string, s: FathomState, index: unknown): Predator {
  const i = wholeAtLeast(op, "index", index, 0);
  if (i >= s.predators.length) fail(op, `no predator at index ${i}`);
  return s.predators[i];
}

function drifterIndex(op: string, s: FathomState, index: unknown): number {
  const i = wholeAtLeast(op, "index", index, 0);
  if (i >= s.drifters.length) fail(op, `no drifter at index ${i}`);
  return i;
}

/** A pose: thaw the state, apply the change, hand the draft back. */
function pose(
  state: DeepReadonly<FathomState>,
  change: (s: FathomState) => void,
): FathomState {
  const s = thaw(state);
  change(s);
  return s;
}

function readMaze(op: string, rows: unknown): string[] {
  if (
    !Array.isArray(rows) ||
    rows.length !== GRID_ROWS ||
    rows.some((r) => typeof r !== "string" || r.length !== GRID_COLS)
  ) {
    fail(op, `rows must be ${GRID_ROWS} strings of ${GRID_COLS} characters`);
  }
  const all = (rows as string[]).join("");
  if (!/^[#.gd]*$/.test(all)) fail(op, "rows may hold only # . g d");
  const gates = all.split("g").length - 1;
  if (/[gd]/.test(all) && gates !== 1) {
    fail(op, "a layout with a den needs exactly one gate");
  }
  return [...(rows as string[])];
}

export function snapshot(s: DeepReadonly<FathomState>): FathomSnapshot {
  const g = s.brightness;
  const f = foragerTile(s);
  return {
    version: FATHOM_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: plankRemaining(s.plankton),
    drifterIn: s.drifterIn,
    brightness: g,
    brightHold: s.brightHold,
    visionRadius: visionRadius(g),
    windowRadius: windowRadius(g),
    sonar: {
      ready: s.sonar.cooldown === 0,
      cooldown: s.sonar.cooldown,
      range: sonarRange(s.depth),
    },
    ink: { ready: s.ink.cooldown === 0, cooldown: s.ink.cooldown },
    grid: {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: {
      x: s.forager.x,
      y: s.forager.y,
      tx: f.tx,
      ty: f.ty,
      dir: s.forager.dir,
      moving: s.forager.moving,
    },
    drifters: s.drifters.map((d) => {
      const t = tileOf(d.x, d.y);
      return {
        x: d.x,
        y: d.y,
        tx: t.tx,
        ty: t.ty,
        lit: d.lit,
        mind: d.mind,
        travel: d.travel,
      };
    }),
    predators: s.predators.map((p) => {
      const t = tileOf(p.x, p.y);
      const flare = p.kind === "flarefish";
      return {
        kind: p.kind,
        x: p.x,
        y: p.y,
        tx: t.tx,
        ty: t.ty,
        dir: p.dir,
        state: p.state,
        released: p.released,
        mind: p.mind,
        travel: p.travel,
        speed: speedOf(p),
        alert: p.kind !== "lanternjaw" && p.alertTime > 0,
        lit: p.lit,
        detectRange: p.kind === "gloamfin" ? null : detectRange(g),
        hearingRange: p.kind === "gloamfin" ? GLOAMFIN_HEAR : null,
        hearingLock: p.kind === "gloamfin" ? p.hearingLock : null,
        flareCharging: flare ? p.flarePhase === "charge" : null,
        flaring: flare ? p.flarePhase === "bloom" : null,
        flareRadius: flare
          ? p.flarePhase === "bloom"
            ? FLARE_RADIUS
            : 0
          : null,
      };
    }),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: s.inkClouds.map((c) => ({
      x: c.x,
      y: c.y,
      radius: c.radius,
      remaining: c.remaining,
    })),
    simTime: s.simTime,
  };
}

function setPredatorMode(
  s: FathomState,
  p: Predator,
  value: PredatorState,
): void {
  const t = tileOf(p.x, p.y);
  const here = tileAt(s.tiles, t.tx, t.ty);
  const op = "setPredatorState";
  if (value === "den" && here !== "d" && here !== "g") {
    fail(op, "a predator posed into the den stands on a den tile or the gate");
  }
  if (value !== "den" && here !== ".") {
    fail(
      op,
      `a predator posed into "${value}" stands on an open corridor tile`,
    );
  }
  if (p.flarePhase === "bloom") p.fadeTime = 0;
  p.flarePhase = "idle";
  p.flareTime = 0;
  p.linger = null;
  p.searchTime = 0;
  p.searchPinged = false;
  p.state = value;
  p.fix = value === "chase" ? foragerTile(s) : null;
  if (value === "chase") p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  if (value === "den") p.hearingLock = false;
}

export function createDebug(): FathomDebugApi {
  return {
    version: FATHOM_DEBUG_VERSION,

    reset: (state) =>
      createState(state.seed, state.art as FathomState["art"], state.muted),

    snapshot,

    reconcile: (state) => thaw(state),

    setScreen: (state, screen) => {
      const next = oneOf("setScreen", "screen", screen, SCREENS);
      return pose(state, (s) => {
        if (
          next === "playing" &&
          s.screen !== "paused" &&
          s.screen !== "playing"
        ) {
          s.releaseClock = null;
        }
        setScreenTo(s, next);
      });
    },

    setMenuIndex: (state, index) => {
      const items = menuItems(state.screen);
      if (!items)
        fail("setMenuIndex", `the "${state.screen}" screen shows no menu`);
      const i = wholeAtLeast("setMenuIndex", "index", index, 0);
      if (i >= items.length)
        fail("setMenuIndex", `the menu holds no item ${i}`);
      return pose(state, (s) => {
        s.menuIndex = i;
      });
    },

    setTitleIndex: (state, index) => {
      const i = wholeAtLeast("setTitleIndex", "index", index, 0);
      if (i >= TITLE_ITEMS.length)
        fail("setTitleIndex", `the title menu holds no item ${i}`);
      return pose(state, (s) => {
        s.titleIndex = i;
      });
    },

    menuItemRect: (state, index) => {
      const rects = menuRects(state.screen);
      if (
        !rects ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= rects.length
      ) {
        return null;
      }
      return { ...rects[index] };
    },

    setScore: (state, points) => {
      const v = wholeAtLeast("setScore", "points", points, 0);
      return pose(state, (s) => {
        s.score = v;
      });
    },

    setLives: (state, n) => {
      const v = wholeAtLeast("setLives", "n", n, 0);
      return pose(state, (s) => {
        s.lives = v;
      });
    },

    setDepth: (state, d) => {
      const v = wholeAtLeast("setDepth", "d", d, 1);
      return pose(state, (s) => {
        s.depth = v;
        layOutRoster(s);
      });
    },

    setMaze: (state, rows) => {
      const layout = readMaze("setMaze", rows);
      return pose(state, (s) => {
        s.tiles = layout;
        s.plankton = s.plankton.map((row, ty) =>
          row.replace(/./g, (c, tx: number) =>
            layout[ty][tx] === "." ? c : "-",
          ),
        );
      });
    },

    setPlankton: (state, tx, ty, present) => {
      const t = tileArg("setPlankton", state, tx, ty, ".");
      const on = flag("setPlankton", "present", present);
      return pose(state, (s) => {
        const row = s.plankton[t.ty];
        s.plankton[t.ty] =
          row.slice(0, t.tx) + (on ? "*" : "-") + row.slice(t.tx + 1);
      });
    },

    clearPlankton: (state) =>
      pose(state, (s) => {
        s.plankton = s.plankton.map((row) => "-".repeat(row.length));
      }),

    clearFog: (state) =>
      pose(state, (s) => {
        s.visibility = s.visibility.map((row) => "u".repeat(row.length));
      }),

    setForagerTile: (state, tx, ty) => {
      const t = tileArg("setForagerTile", state, tx, ty, ".");
      return pose(state, (s) => {
        s.forager.x = centerX(t.tx);
        s.forager.y = centerY(t.ty);
        s.forager.moving = false;
        s.forager.desired = null;
      });
    },

    setForagerDir: (state, dir) => {
      const d = oneOf<Dir>("setForagerDir", "dir", dir, DIRS);
      return pose(state, (s) => {
        s.forager.dir = d;
        s.forager.moving = false;
        s.forager.desired = null;
      });
    },

    setBrightness: (state, g) => {
      const v = within("setBrightness", "g", g, 0, 1);
      return pose(state, (s) => {
        s.brightness = v;
      });
    },

    setBrightHold: (state, seconds) => {
      const v = within("setBrightHold", "seconds", seconds, 0, BRIGHT_HOLD);
      return pose(state, (s) => {
        s.brightHold = v;
      });
    },

    clearPredators: (state) =>
      pose(state, (s) => {
        s.predators = [];
      }),

    addPredator: (state, kind, tx, ty) => {
      const k = oneOf("addPredator", "kind", kind, KINDS);
      const t = tileArg("addPredator", state, tx, ty, ".");
      return pose(state, (s) => {
        const p = makePredator(s.nextId++, k, t, null);
        becomeLoose(p);
        p.released = true;
        s.predators.push(p);
      });
    },

    setPredatorTile: (state, index, tx, ty) => {
      const t = tileArg("setPredatorTile", state, tx, ty, ".dg");
      return pose(state, (s) => {
        const p = predatorAt("setPredatorTile", s, index);
        p.x = centerX(t.tx);
        p.y = centerY(t.ty);
      });
    },

    setPredatorDir: (state, index, dir) => {
      const d = oneOf<Dir>("setPredatorDir", "dir", dir, DIRS);
      return pose(state, (s) => {
        predatorAt("setPredatorDir", s, index).dir = d;
      });
    },

    setPredatorState: (state, index, value) => {
      const v = oneOf("setPredatorState", "value", value, POSABLE);
      return pose(state, (s) => {
        setPredatorMode(s, predatorAt("setPredatorState", s, index), v);
      });
    },

    setPredatorReleased: (state, index, released) => {
      const v = flag("setPredatorReleased", "released", released);
      return pose(state, (s) => {
        predatorAt("setPredatorReleased", s, index).released = v;
      });
    },

    setPredatorMind: (state, index, enabled) => {
      const v = flag("setPredatorMind", "enabled", enabled);
      return pose(state, (s) => {
        predatorAt("setPredatorMind", s, index).mind = v;
      });
    },

    setPredatorTravel: (state, index, enabled) => {
      const v = flag("setPredatorTravel", "enabled", enabled);
      return pose(state, (s) => {
        predatorAt("setPredatorTravel", s, index).travel = v;
      });
    },

    spawnDrifter: (state, tx, ty) => {
      const t = tileArg("spawnDrifter", state, tx, ty, ".");
      return pose(state, (s) => {
        s.drifters.push(makeDrifter(s.nextId++, t));
      });
    },

    clearDrifters: (state) =>
      pose(state, (s) => {
        s.drifters = [];
      }),

    setDrifterMind: (state, index, enabled) => {
      const v = flag("setDrifterMind", "enabled", enabled);
      return pose(state, (s) => {
        s.drifters[drifterIndex("setDrifterMind", s, index)].mind = v;
      });
    },

    setDrifterTravel: (state, index, enabled) => {
      const v = flag("setDrifterTravel", "enabled", enabled);
      return pose(state, (s) => {
        s.drifters[drifterIndex("setDrifterTravel", s, index)].travel = v;
      });
    },

    setDrifterIn: (state, seconds) => {
      const v = within("setDrifterIn", "seconds", seconds, 0, DRIFTER_INTERVAL);
      return pose(state, (s) => {
        s.drifterIn = v;
      });
    },

    setSonarCooldown: (state, seconds) => {
      const v = within(
        "setSonarCooldown",
        "seconds",
        seconds,
        0,
        Number.MAX_VALUE,
      );
      return pose(state, (s) => {
        s.sonar.cooldown = v;
      });
    },

    setInkCooldown: (state, seconds) => {
      const v = within(
        "setInkCooldown",
        "seconds",
        seconds,
        0,
        Number.MAX_VALUE,
      );
      return pose(state, (s) => {
        s.ink.cooldown = v;
      });
    },
  };
}
