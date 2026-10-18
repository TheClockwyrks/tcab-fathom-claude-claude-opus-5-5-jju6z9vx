// Fathom — a harness for the unit tests: the real engine over a native canvas
// and a scripted clock, so a test poses the game through the debug surface,
// steps an exact number of ticks, and reads the outcome back.

import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { createCanvas } from "@napi-rs/canvas";
import { LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import {
  BACKGROUND,
  game,
  type FathomDebugApi,
  type FathomState,
} from "./game";

export interface Harness {
  readonly engine: Engine<FathomState, FathomDebugApi>;
  readonly debug: FathomDebugApi;
  /** Applies a pose built from the debug surface. */
  pose(
    f: (
      d: FathomDebugApi,
      s: Engine<FathomState, FathomDebugApi>["state"],
    ) => FathomState,
  ): void;
  snap(): ReturnType<FathomDebugApi["snapshot"]>;
  /** Runs `n` frames of one tick each. */
  ticks(n: number): Promise<void>;
  seconds(t: number): Promise<void>;
  keyDown(code: string): void;
  keyUp(code: string): void;
  /** Presses and releases a key across one frame. */
  tap(code: string): Promise<void>;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  readonly cues: string[];
}

/**
 * A fixture layout: a rectangular loop round the grid's edge, a cross corridor
 * on row 9 that pierces both borders as the wrap tunnel, a long straight on
 * row 5, and the den chamber below row 9 with its gate opening onto row 10.
 */
export function fixtureMaze(): string[] {
  const rows = Array.from({ length: 18 }, () =>
    new Array<string>(36).fill("#"),
  );
  for (let x = 1; x <= 34; x++) {
    rows[1][x] = ".";
    rows[5][x] = ".";
    rows[9][x] = ".";
    rows[16][x] = ".";
  }
  for (let y = 1; y <= 16; y++) {
    rows[y][1] = ".";
    rows[y][34] = ".";
  }
  rows[9][0] = ".";
  rows[9][35] = ".";
  rows[10][17] = ".";
  rows[11][17] = "g";
  for (let y = 12; y <= 14; y++)
    for (let x = 16; x <= 19; x++) rows[y][x] = "d";
  return rows.map((r) => r.join(""));
}

/** The center of a tile, as the snapshot reports positions. */
export function center(tx: number, ty: number): { x: number; y: number } {
  return { x: 64 + tx * 32 + 16, y: 80 + ty * 32 + 16 };
}

export async function boot(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const target = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(1000 / TICK_HZ),
    surface: {
      cssWidth: () => STAGE_W,
      cssHeight: () => STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  const cues: string[] = [];
  engine.events.on("cue:played", (e) => cues.push(e.cue));
  await engine.initialize();
  const key = (type: string, code: string): void => {
    target.dispatchEvent(
      Object.assign(new Event(type), { code, repeat: false }),
    );
  };
  return {
    engine,
    debug: engine.debug,
    pose: (f) => {
      engine.apply((s) => f(engine.debug, s));
    },
    snap: () => engine.debug.snapshot(engine.state),
    ticks: (n) => engine.advance(n),
    seconds: async (t) => {
      // Whole frames of a tenth of a second, then single ticks for the rest.
      const total = Math.round(t * TICK_HZ);
      const bulk = Math.floor(total / 12);
      engine.setClock(new ConstantClock(100));
      await engine.advance(bulk);
      engine.setClock(new ConstantClock(1000 / TICK_HZ));
      await engine.advance(total - bulk * 12);
    },
    keyDown: (code) => key("keydown", code),
    keyUp: (code) => key("keyup", code),
    tap: async (code) => {
      key("keydown", code);
      await engine.advance(1);
      key("keyup", code);
    },
    pointer: (type, x, y) => {
      target.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    cues,
  };
}
