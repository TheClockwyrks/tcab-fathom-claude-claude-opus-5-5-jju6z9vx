import { describe, expect, it } from "vitest";
import {
  DRIFTER_INTERVAL,
  FATHOM_DEBUG_VERSION,
  START_LIVES,
} from "./constants";
import { boot, fixtureMaze } from "./testkit";

describe("reset and the snapshot", () => {
  it("opens on the title-screen values", async () => {
    const h = await boot();
    const s = h.snap();
    expect(h.debug.version).toBe(FATHOM_DEBUG_VERSION);
    expect(s).toMatchObject({
      version: 1,
      screen: "title",
      menuIndex: 0,
      titleIndex: 0,
      depth: 1,
      score: 0,
      lives: START_LIVES,
      muted: false,
      drifterIn: DRIFTER_INTERVAL,
      brightness: 0,
      brightHold: 0,
      visionRadius: 96,
      windowRadius: 192,
      sonar: { ready: true, cooldown: 0, range: 9 },
      ink: { ready: true, cooldown: 0 },
      grid: { cols: 36, rows: 18, tile: 32, originX: 64, originY: 80 },
      drifters: [],
      pulses: [],
      inkClouds: [],
      simTime: 0,
    });
    expect(s.tiles).toHaveLength(18);
    expect(s.tiles.every((r) => r.length === 36)).toBe(true);
    expect(s.visibility.join("")).toMatch(/^u+$/);
    expect(s.planktonRemaining).toBe(s.tiles.join("").split(".").length - 1);
    expect(s.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);
    for (const p of s.predators) {
      expect(p).toMatchObject({
        state: "den",
        released: false,
        mind: true,
        travel: true,
      });
      expect(s.tiles[p.ty][p.tx]).toBe("d");
    }
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("returns to exactly the opening state, keeping the mute bit", async () => {
    const h = await boot();
    const opening = h.snap();
    await h.tap("Enter");
    await h.seconds(3);
    await h.tap("KeyM");
    h.pose((d, s) => d.setScore(s, 900));
    h.pose((d, s) => d.reset(s));
    const s = h.snap();
    expect({ ...s, muted: false }).toEqual(opening);
    expect(s.muted).toBe(true);
  });

  it("reports a pure reading, and reconcile changes nothing", async () => {
    const h = await boot();
    const before = h.engine.state;
    const once = h.debug.reconcile(before);
    expect(once).toEqual(before);
    expect(h.debug.reconcile(once)).toEqual(once);
    expect(h.debug.snapshot(before)).toEqual(h.debug.snapshot(before));
  });
});

describe("poses", () => {
  it("set one thing each", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScore(s, 1234));
    h.pose((d, s) => d.setLives(s, 0));
    h.pose((d, s) => d.setDepth(s, 6));
    h.pose((d, s) => d.setBrightness(s, 0.5));
    h.pose((d, s) => d.setSonarCooldown(s, 40));
    h.pose((d, s) => d.setInkCooldown(s, 2));
    h.pose((d, s) => d.setDrifterIn(s, 3));
    const s = h.snap();
    expect(s).toMatchObject({
      score: 1234,
      lives: 0,
      depth: 6,
      brightness: 0.5,
      drifterIn: 3,
    });
    expect(s.sonar).toEqual({ ready: false, cooldown: 40, range: 5 });
    expect(s.ink).toEqual({ ready: false, cooldown: 2 });
    expect(s.predators).toHaveLength(6);
    expect(s.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
      "flarefish",
    ]);
    expect(s.visionRadius).toBe(128);
    expect(s.windowRadius).toBe(256);
  });

  it("move between screens with the menu following", async () => {
    const h = await boot();
    h.pose((d, s) => d.setTitleIndex(s, 1));
    expect(h.snap()).toMatchObject({
      screen: "title",
      menuIndex: 0,
      titleIndex: 1,
    });
    h.pose((d, s) => d.setScreen(s, "paused"));
    expect(h.snap().menuIndex).toBe(0);
    h.pose((d, s) => d.setMenuIndex(s, 2));
    expect(h.snap().menuIndex).toBe(2);
    h.pose((d, s) => d.setScreen(s, "howto"));
    expect(h.snap().menuIndex).toBeNull();
    h.pose((d, s) => d.setScreen(s, "title"));
    expect(h.snap().menuIndex).toBe(1);
    expect(h.debug.menuItemRect(h.engine.state, 1)).toMatchObject({
      w: 380,
      h: 52,
    });
    expect(h.debug.menuItemRect(h.engine.state, 2)).toBeNull();
    h.pose((d, s) => d.setScreen(s, "playing"));
    expect(h.debug.menuItemRect(h.engine.state, 0)).toBeNull();
  });

  it("accept a fixture maze exactly as given", async () => {
    const h = await boot();
    const rows = fixtureMaze().map((r) => r.replace(/[gd]/g, "#"));
    h.pose((d, s) => d.setMaze(s, rows));
    let s = h.snap();
    expect(s.tiles).toEqual(rows);
    expect(
      s.plankton.every((r, y) =>
        [...r].every((c, x) => c === "-" || rows[y][x] === "."),
      ),
    ).toBe(true);
    // With no den chamber the roster is held out of play.
    h.pose((d, st) => d.setScreen(st, "playing"));
    await h.seconds(6);
    s = h.snap();
    expect(s.screen).toBe("playing");
    expect(s.predators.every((p) => p.state === "den" && !p.lit)).toBe(true);
    expect(s.drifters).toHaveLength(0);
  });

  it("pose predators and drifters", async () => {
    const h = await boot();
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 3, 1));
    let p = h.snap().predators[3];
    expect(p).toMatchObject({
      kind: "gloamfin",
      tx: 3,
      ty: 1,
      state: "wander",
      released: true,
      dir: "up",
    });
    expect(p.hearingRange).toBe(64);
    expect(p.hearingLock).toBe(false);
    expect(p.detectRange).toBeNull();
    h.pose((d, s) => d.setPredatorTile(s, 0, 17, 11));
    h.pose((d, s) => d.setPredatorDir(s, 0, "right"));
    h.pose((d, s) => d.setPredatorReleased(s, 0, true));
    h.pose((d, s) => d.setPredatorTile(s, 2, 6, 5));
    h.pose((d, s) => d.setPredatorState(s, 2, "chase"));
    const s = h.snap();
    expect(s.predators[0]).toMatchObject({
      tx: 17,
      ty: 11,
      dir: "right",
      released: true,
      state: "den",
    });
    p = s.predators[2];
    expect(p).toMatchObject({
      kind: "flarefish",
      state: "chase",
      flaring: false,
      speed: 116,
    });
    h.pose((d, st) => d.spawnDrifter(st, 2, 1));
    h.pose((d, st) => d.setDrifterTravel(st, 0, false));
    expect(h.snap().drifters[0]).toMatchObject({
      tx: 2,
      ty: 1,
      travel: false,
      mind: true,
    });
    h.pose((d, st) => d.clearDrifters(st));
    h.pose((d, st) => d.clearPredators(st));
    expect(h.snap().drifters).toEqual([]);
    expect(h.snap().predators).toEqual([]);
  });

  it("fail loudly outside their domain", async () => {
    const h = await boot();
    const s = h.engine.state;
    const d = h.debug;
    expect(() => d.setScreen(s, "menu" as never)).toThrow();
    expect(() => d.setMenuIndex(s, 2)).toThrow();
    expect(() => d.setTitleIndex(s, -1)).toThrow();
    expect(() => d.setScore(s, 1.5)).toThrow();
    expect(() => d.setLives(s, -1)).toThrow();
    expect(() => d.setDepth(s, 0)).toThrow();
    expect(() => d.setMaze(s, ["#"])).toThrow();
    expect(() =>
      d.setMaze(
        s,
        fixtureMaze().map((r) => r.replace("g", "d")),
      ),
    ).toThrow();
    expect(() =>
      d.setMaze(
        s,
        fixtureMaze().map((r) => r.replace(/\./g, "x")),
      ),
    ).toThrow();
    expect(() => d.setBrightness(s, 1.1)).toThrow();
    expect(() => d.setBrightHold(s, 2)).toThrow();
    expect(() => d.setDrifterIn(s, 26)).toThrow();
    expect(() => d.setSonarCooldown(s, -1)).toThrow();
    expect(() => d.setInkCooldown(s, Number.NaN)).toThrow();
    expect(() => d.setForagerTile(s, 0, 0)).toThrow();
    expect(() => d.setForagerTile(s, 99, 0)).toThrow();
    expect(() => d.setForagerDir(s, "north" as never)).toThrow();
    expect(() => d.addPredator(s, "shark" as never, 1, 1)).toThrow();
    expect(() => d.setPredatorTile(s, 7, 1, 1)).toThrow();
    expect(() => d.setPredatorState(s, 0, "search" as never)).toThrow();
    expect(() => d.setPredatorState(s, 0, "wander")).toThrow();
    expect(() => d.setPredatorMind(s, 0, "yes" as never)).toThrow();
    expect(() => d.setDrifterMind(s, 0, true)).toThrow();
    expect(() => d.setPlankton(s, 0, 0, true)).toThrow();
  });
});
