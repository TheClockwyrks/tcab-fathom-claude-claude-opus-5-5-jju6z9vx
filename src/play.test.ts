import { describe, expect, it } from "vitest";
import {
  BRIGHT_HALFLIFE,
  BRIGHT_PER_EAT,
  DRIFTER_INTERVAL,
  FORAGER_SPEED,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  START_LIVES,
  TICK_HZ,
} from "./constants";
import { boot, center, fixtureMaze, type Harness } from "./testkit";

/** A fixture maze in live play with nothing in it but the forager. */
async function arena(tx: number, ty: number): Promise<Harness> {
  const h = await boot();
  h.pose((d, s) => d.setMaze(s, fixtureMaze()));
  h.pose((d, s) => d.clearPredators(s));
  h.pose((d, s) => d.clearPlankton(s));
  h.pose((d, s) => d.setForagerTile(s, tx, ty));
  h.pose((d, s) => d.setScreen(s, "playing"));
  return h;
}

const TILE_TICKS = (32 / FORAGER_SPEED) * TICK_HZ;

describe("the forager's travel", () => {
  it("swims one tile per quarter second while a key is held", async () => {
    const h = await arena(5, 1);
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS);
    const f = h.snap().forager;
    expect(f.x).toBeCloseTo(center(6, 1).x, 6);
    expect(f.tx).toBe(6);
    expect(f.dir).toBe("right");
    expect(f.moving).toBe(true);
    h.keyUp("ArrowRight");
    await h.ticks(1);
    expect(h.snap().forager.moving).toBe(false);
  });

  it("stops at a center facing rock", async () => {
    const h = await arena(32, 1);
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS * 4);
    const f = h.snap().forager;
    expect(f.tx).toBe(34);
    expect(f.x).toBeCloseTo(center(34, 1).x, 6);
    expect(f.moving).toBe(false);
  });

  it("buffers a perpendicular turn until the junction", async () => {
    const h = await arena(3, 5);
    h.keyDown("ArrowLeft");
    await h.ticks(5);
    h.keyDown("ArrowDown");
    await h.ticks(1);
    h.keyUp("ArrowDown");
    await h.ticks(TILE_TICKS * 2 + 10);
    const f = h.snap().forager;
    expect(f.tx).toBe(1);
    expect(f.dir).toBe("down");
    expect(f.ty).toBeGreaterThan(5);
  });

  it("reverses at once, mid-tile", async () => {
    const h = await arena(10, 1);
    h.keyDown("ArrowRight");
    await h.ticks(10);
    const x = h.snap().forager.x;
    h.keyUp("ArrowRight");
    h.keyDown("ArrowLeft");
    await h.ticks(1);
    const f = h.snap().forager;
    expect(f.dir).toBe("left");
    expect(f.x).toBeLessThan(x);
  });

  it("crosses the wrap tunnel as one continuous move", async () => {
    const h = await arena(1, 9);
    h.keyDown("ArrowLeft");
    await h.ticks(TILE_TICKS);
    expect(h.snap().forager.tx).toBe(0);
    await h.ticks(TILE_TICKS / 2 + 1);
    const f = h.snap().forager;
    expect(f.tx).toBe(35);
    expect(f.x).toBeGreaterThan(1200);
    expect(f.x).toBeLessThanOrEqual(1216);
    await h.ticks(TILE_TICKS / 2 - 1);
    expect(h.snap().forager.x).toBeCloseTo(center(35, 9).x, 6);
  });

  it("never enters the den gate", async () => {
    const h = await arena(17, 9);
    h.keyDown("ArrowDown");
    await h.ticks(TILE_TICKS * 3);
    expect(h.snap().forager.ty).toBe(10);
  });
});

describe("plankton and brightness", () => {
  it("eats on entering a tile, scores, and brightens", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setPlankton(s, 6, 1, true));
    h.pose((d, s) => d.setPlankton(s, 9, 1, true));
    expect(h.snap().planktonRemaining).toBe(2);
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS);
    const s = h.snap();
    expect(s.score).toBe(SCORE_PLANKTON);
    expect(s.planktonRemaining).toBe(1);
    expect(s.plankton[1][6]).toBe("-");
    expect(s.brightness).toBeCloseTo(BRIGHT_PER_EAT, 9);
    // The center crossed into the tile halfway through the step, give or take
    // the tick the boundary falls on.
    expect(
      Math.abs(s.brightHold - (1 - TILE_TICKS / 2 / TICK_HZ)),
    ).toBeLessThan(1.5 / TICK_HZ);
    expect(s.visionRadius).toBeCloseTo(96 + 64 * BRIGHT_PER_EAT, 6);
    expect(s.windowRadius).toBeCloseTo(192 + 128 * BRIGHT_PER_EAT, 6);
    expect(h.cues).toContain("eat");
  });

  it("holds G steady through the hold, then halves it every half-life", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setBrightness(s, 0.8));
    h.pose((d, s) => d.setBrightHold(s, 0.5));
    await h.seconds(0.5);
    expect(h.snap().brightness).toBeCloseTo(0.8, 9);
    expect(h.snap().brightHold).toBe(0);
    await h.seconds(BRIGHT_HALFLIFE);
    expect(h.snap().brightness).toBeCloseTo(0.4, 6);
  });

  it("clears the maze on the last plankton and descends", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setPlankton(s, 6, 1, true));
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS);
    h.keyUp("ArrowRight");
    let s = h.snap();
    expect(s.screen).toBe("cleared");
    expect(s.score).toBe(SCORE_PLANKTON + SCORE_CLEAR);
    expect(h.cues).toContain("descend");
    await h.seconds(3);
    s = h.snap();
    expect(s.screen).toBe("countdown");
    expect(s.depth).toBe(2);
    expect(s.sonar.range).toBe(8);
    expect(s.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
    ]);
    // Fresh fog: only the light the forager casts during the countdown.
    expect(s.visibility.join("")).not.toMatch(/r/);
    expect(s.planktonRemaining).toBe(s.tiles.join("").split(".").length - 1);
  });

  it("does not clear a maze emptied by a pose", async () => {
    const h = await arena(5, 1);
    await h.seconds(1);
    expect(h.snap().screen).toBe("playing");
  });
});

describe("contact", () => {
  it("costs a life and resets the attempt", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "flarefish", 7, 1));
    h.pose((d, s) => d.setPredatorMind(s, 0, false));
    h.pose((d, s) => d.setScore(s, 120));
    h.pose((d, s) => d.setBrightness(s, 0.6));
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS * 2);
    const s = h.snap();
    expect(s.screen).toBe("countdown");
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.score).toBe(120);
    expect(s.brightness).toBe(0);
    expect(s.forager).toMatchObject({ tx: 17, ty: 10, moving: false });
    expect(s.predators).toHaveLength(3);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(h.cues).toContain("caught");
  });

  it("ends the dive with no life in reserve", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setLives(s, 0));
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 6, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.keyDown("ArrowRight");
    await h.ticks(TILE_TICKS);
    const s = h.snap();
    expect(s.screen).toBe("gameover");
    expect(s.menuIndex).toBe(0);
  });

  it("is made with a predator moving into the forager", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 9, 1));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    await h.seconds(1.5);
    expect(h.snap().lives).toBe(START_LIVES - 1);
  });
});

describe("the den", () => {
  it("releases on the staggered schedule from the start of live play", async () => {
    const h = await boot();
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.setDepth(s, 1));
    h.pose((d, s) => d.setScreen(s, "playing"));
    await h.ticks(1);
    expect(h.snap().predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await h.ticks(5 * TICK_HZ - 2);
    expect(h.snap().predators[1].released).toBe(false);
    await h.ticks(1);
    expect(h.snap().predators[1].released).toBe(true);
    expect(h.snap().predators[1].state).toBe("den");
    await h.seconds(4);
    const s = h.snap();
    expect(s.predators[0].state).toBe("wander");
    expect(s.predators[1].state).not.toBe("den");
    expect(s.predators[2].released).toBe(false);
  });

  it("holds a released predator whose travel is off", async () => {
    const h = await boot();
    h.pose((d, s) => d.setMaze(s, fixtureMaze()));
    h.pose((d, s) => d.setDepth(s, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.pose((d, s) => d.setScreen(s, "playing"));
    await h.seconds(3);
    const p = h.snap().predators[0];
    expect(p.released).toBe(true);
    expect(p.state).toBe("den");
  });

  it("releases nothing during the countdown", async () => {
    const h = await boot();
    h.pose((d, s) => d.setScreen(s, "countdown"));
    await h.seconds(1);
    expect(h.snap().predators.some((p) => p.released)).toBe(false);
    await h.seconds(1.1);
    expect(h.snap().screen).toBe("playing");
    expect(h.snap().predators[0].released).toBe(true);
  });
});

describe("bonus drifters", () => {
  it("are admitted at the gate on the cadence while plankton remain", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setPlankton(s, 30, 16, true));
    h.pose((d, s) => d.setDrifterIn(s, 0.5));
    await h.seconds(0.5);
    let s = h.snap();
    expect(s.drifters).toHaveLength(1);
    expect(s.drifters[0]).toMatchObject({ tx: 17, ty: 10 });
    expect(s.drifterIn).toBeCloseTo(DRIFTER_INTERVAL, 6);
    h.pose((d, st) => d.spawnDrifter(st, 30, 1));
    h.pose((d, st) => d.setDrifterIn(st, 0));
    await h.ticks(2);
    s = h.snap();
    expect(s.drifters).toHaveLength(2);
  });

  it("admits none into a maze without plankton", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setDrifterIn(s, 0));
    await h.ticks(3);
    expect(h.snap().drifters).toHaveLength(0);
  });

  it("wander at half the forager's pace and pay the bonus when eaten", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.spawnDrifter(s, 10, 1));
    await h.seconds(0.5);
    const moved = h.snap().drifters[0];
    expect(Math.abs(moved.x - center(10, 1).x)).toBeCloseTo(32, 6);
    h.pose((d, s) => d.setDrifterMind(s, 0, false));
    h.pose((d, s) => d.setForagerTile(s, moved.tx, 1));
    h.pose((d, s) => d.setPlankton(s, 30, 16, true));
    await h.ticks(1);
    const s = h.snap();
    expect(s.drifters).toHaveLength(0);
    expect(s.score).toBe(SCORE_DRIFTER);
  });
});
