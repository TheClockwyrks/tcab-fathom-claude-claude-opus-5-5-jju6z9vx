import { afterEach, describe, expect, it, vi } from "vitest";
import { JitterClock, SequenceClock } from "@clockwyrks/simple-2d";
import { loadImage } from "@napi-rs/canvas";
import { START_LIVES } from "./constants";
import { boot, fixtureMaze, type Harness } from "./testkit";

function rectCenter(h: Harness, index: number): { x: number; y: number } {
  const r = h.debug.menuItemRect(h.engine.state, index);
  if (!r) throw new Error(`no menu item ${index}`);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe("the title menu", () => {
  it("moves the selection with wrap and remembers what was confirmed", async () => {
    const h = await boot();
    await h.tap("ArrowUp");
    expect(h.snap().menuIndex).toBe(1);
    await h.tap("ArrowDown");
    expect(h.snap().menuIndex).toBe(0);
    await h.tap("KeyS");
    await h.tap("Enter");
    expect(h.snap()).toMatchObject({
      screen: "howto",
      menuIndex: null,
      titleIndex: 1,
    });
    await h.tap("Escape");
    expect(h.snap()).toMatchObject({ screen: "title", menuIndex: 1 });
    await h.tap("Escape");
    expect(h.snap().screen).toBe("title");
  });

  it("begins a dive on DIVE", async () => {
    const h = await boot();
    await h.tap("Space");
    const s = h.snap();
    expect(s).toMatchObject({
      screen: "countdown",
      score: 0,
      lives: START_LIVES,
      depth: 1,
    });
    expect(s.pulses).toHaveLength(0);
  });

  it("takes a pointer press and release inside one item", async () => {
    const h = await boot();
    const how = rectCenter(h, 1);
    h.pointer("pointermove", how.x, how.y);
    await h.ticks(1);
    expect(h.snap().menuIndex).toBe(1);
    const dive = rectCenter(h, 0);
    h.pointer("pointerdown", dive.x, dive.y);
    h.pointer("pointerup", how.x, how.y);
    await h.ticks(1);
    expect(h.snap().screen).toBe("title");
    h.pointer("pointerdown", dive.x, dive.y);
    h.pointer("pointerup", dive.x, dive.y);
    await h.ticks(1);
    expect(h.snap()).toMatchObject({ screen: "countdown", titleIndex: 0 });
  });

  it("leaves how-to-play on a click anywhere", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScreen(s, "howto"));
    h.pointer("pointerdown", 30, 30);
    h.pointer("pointerup", 1000, 700);
    await h.ticks(1);
    expect(h.snap().screen).toBe("title");
  });
});

describe("pause and game over", () => {
  it("opens and closes the pause menu on one Escape each", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScreen(s, "playing"));
    await h.tap("Escape");
    expect(h.snap()).toMatchObject({ screen: "paused", menuIndex: 0 });
    const frozen = h.snap();
    await h.seconds(1);
    expect(h.snap().predators).toEqual(frozen.predators);
    await h.tap("Escape");
    expect(h.snap().screen).toBe("playing");
    await h.tap("KeyP");
    await h.tap("ArrowDown");
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(h.snap()).toMatchObject({ screen: "title", menuIndex: 0 });
  });

  it("restarts a fresh dive from the pause menu", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScreen(s, "paused"));
    h.pose((d, s) => d.setScore(s, 50));
    h.pose((d, s) => d.setMenuIndex(s, 1));
    await h.tap("Enter");
    expect(h.snap()).toMatchObject({ screen: "countdown", score: 0 });
  });

  it("offers another dive or the menu after the last life", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScreen(s, "gameover"));
    h.pose((d, s) => d.setScore(s, 70));
    await h.tap("ArrowDown");
    expect(h.snap().menuIndex).toBe(1);
    await h.tap("Enter");
    expect(h.snap()).toMatchObject({ screen: "title", score: 0 });
    h.pose((d, s) => d.setScreen(s, "gameover"));
    await h.tap("Enter");
    expect(h.snap().screen).toBe("countdown");
  });
});

describe("audio", () => {
  it("toggles mute from any screen and mirrors the engine's bit", async () => {
    const h = await boot();
    const gains: number[] = [];
    h.engine.events.on("cue:played", (e) => gains.push(e.gain));
    await h.tap("KeyM");
    expect(h.snap().muted).toBe(true);
    h.pose((d, s) => d.setScreen(s, "playing"));
    await h.tap("Space");
    expect(gains.length).toBeGreaterThan(0);
    expect(gains.every((g) => g === 0)).toBe(true);
    await h.tap("KeyM");
    expect(h.snap().muted).toBe(false);
  });
});

describe("the fixed-step core", () => {
  async function run(clock: unknown, frames: number): Promise<Harness> {
    const h = await boot();
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.clearPredators(s));
    h.pose((d, s) => d.clearPlankton(s));
    h.pose((d, s) => d.setPlankton(s, 5, 1, true));
    h.pose((d, s) => d.setPlankton(s, 9, 1, true));
    h.pose((d, s) => d.setForagerTile(s, 2, 1));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.engine.setClock(clock as never);
    h.keyDown("ArrowRight");
    await h.engine.advance(frames);
    return h;
  }

  it("advances the same ticks however time is cut into frames", async () => {
    const even = await run(new SequenceClock([25]), 40);
    const uneven = await run(new SequenceClock([7, 18, 3, 22, 50]), 50);
    expect(even.snap().simTime).toBeCloseTo(1, 9);
    expect(uneven.snap().simTime).toBeCloseTo(1, 9);
    expect(uneven.snap().forager.x).toBeCloseTo(even.snap().forager.x, 9);
    expect(uneven.snap().score).toBe(even.snap().score);
  });

  it("keeps whole ticks under a jittery clock", async () => {
    const h = await run(new JitterClock(4, 30, 7), 50);
    const s = h.snap();
    expect(
      Math.abs(s.simTime * 120 - Math.round(s.simTime * 120)),
    ).toBeLessThan(1e-6);
  });
});

describe("diagnostics", () => {
  it("reports the dive's vital signs on the overlay", async () => {
    const h = await boot();
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.setForagerTile(s, 3, 1));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 4, 1));
    await h.ticks(0);
    h.pose((d, s) => d.setScreen(s, "playing"));
    await h.ticks(1);
    const read = Object.fromEntries(
      h.engine.diagnostics().map((r) => [r.name, r.value ?? r.error]),
    );
    expect(read).toMatchObject({
      screen: "playing",
      depth: 1,
      score: 10,
      lives: 3,
      V: 96 + 64 * 0.34,
      forager: "3,1 left",
      predators: 4,
      "pred 7": "-",
    });
    expect(read["pred 3"]).toMatch(/^gloamfin chase 4,1 1(15|34) ALERT$/);
    expect(read["pred 0"]).toMatch(/^lanternjaw den/);
  });
});

describe("drawing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function everyScreen(h: Harness): Promise<void> {
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as const) {
      h.pose((d, s) => d.setScreen(s, screen));
      await h.ticks(2);
    }
  }

  it("draws every screen with no art at all", async () => {
    const h = await boot();
    await everyScreen(h);
    expect(h.snap().screen).toBe("gameover");
  });

  it("draws every screen and effect from the seeded sheets", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(url));
    vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
      loadImage(await blob.text()),
    );
    const h = await boot();
    expect(h.engine.state.art.tiles.every((f) => f !== null)).toBe(true);
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.setForagerTile(s, 6, 1));
    h.pose((d, s) => d.clearPredators(s));
    for (const kind of ["lanternjaw", "gloamfin", "flarefish"] as const) {
      h.pose((d, s) => d.addPredator(s, kind, 8, 1));
    }
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.pose((d, s) => d.spawnDrifter(s, 4, 1));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.engine.startRecording();
    await h.tap("Space");
    await h.tap("ShiftLeft");
    await h.seconds(8);
    const recording = h.engine.stopRecording();
    expect(recording.frames.length).toBeGreaterThan(10);
    await everyScreen(h);
  });
});
