import { describe, expect, it } from "vitest";
import {
  FALLBACK_MAZE,
  distanceField,
  generateMaze,
  isOpen,
  mazeViolations,
  measureMaze,
  neighbor,
  segmentBlocked,
  startTileOf,
  tileOf,
  wrapRowOf,
  denExit,
  centerX,
  centerY,
  index,
} from "./maze";
import { drawFrom } from "./random";
import { fixtureMaze } from "./testkit";

describe("the maze generator", () => {
  it("lays out mazes that satisfy every rule of specs/maze.md", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rows = generateMaze(drawFrom({ rng: seed * 7919 }));
      expect(mazeViolations(rows), `seed ${seed}`).toEqual([]);
    }
  });

  it("keeps its fallback layout conforming", () => {
    expect(mazeViolations(FALLBACK_MAZE)).toEqual([]);
  });

  it("is deterministic in its generator state", () => {
    const a = generateMaze(drawFrom({ rng: 42 }));
    const b = generateMaze(drawFrom({ rng: 42 }));
    expect(a).toEqual(b);
  });

  it("measures the three proportions within their bounds", () => {
    const m = measureMaze(FALLBACK_MAZE);
    expect(m.openness).toBeGreaterThanOrEqual(2);
    expect(m.openness).toBeLessThanOrEqual(2.8);
    expect(m.mazing).toBeGreaterThanOrEqual(2);
    expect(m.mazing).toBeLessThanOrEqual(8);
    expect(m.density).toBeGreaterThanOrEqual(0.4);
  });

  it("starts the forager in the lower half", () => {
    const start = startTileOf(FALLBACK_MAZE);
    expect(start).not.toBeNull();
    expect(start?.ty).toBeGreaterThanOrEqual(9);
    expect(start?.ty).toBeLessThanOrEqual(16);
    expect(isOpen(FALLBACK_MAZE, start?.tx ?? -1, start?.ty ?? -1)).toBe(true);
  });
});

describe("the validator", () => {
  it("names the rules a fixture breaks", () => {
    const problems = mazeViolations(fixtureMaze()).join("\n");
    expect(problems).toMatch(/2x2|dead end|den mismatch|corridor run/);
    expect(mazeViolations(["#"])).toEqual(["wrong size"]);
  });
});

describe("grid geometry", () => {
  const rows = fixtureMaze();

  it("joins the two mouths of the wrap row", () => {
    expect(wrapRowOf(rows)).toBe(9);
    expect(neighbor(rows, 0, 9, "left")).toEqual({ tx: 35, ty: 9 });
    expect(neighbor(rows, 35, 9, "right")).toEqual({ tx: 0, ty: 9 });
    expect(neighbor(rows, 0, 5, "left")).toBeNull();
  });

  it("maps points to tiles and tiles to centers", () => {
    expect(tileOf(centerX(3), centerY(4))).toEqual({ tx: 3, ty: 4 });
    expect(tileOf(-50, 9999)).toEqual({ tx: 0, ty: 17 });
  });

  it("measures corridor steps through the tunnel", () => {
    const d = distanceField(rows, [{ tx: 0, ty: 9 }], (x, y) =>
      isOpen(rows, x, y),
    );
    expect(d[index(35, 9)]).toBe(1);
    expect(d[index(5, 3)]).toBe(-1);
  });

  it("finds the corridor tile outside the den gate", () => {
    expect(denExit(rows)).toEqual({ tx: 17, ty: 10 });
  });

  it("blocks a line of sight at rock and passes one along a corridor", () => {
    expect(
      segmentBlocked(rows, centerX(2), centerY(1), centerX(20), centerY(1)),
    ).toBe(false);
    expect(
      segmentBlocked(rows, centerX(5), centerY(1), centerX(5), centerY(5)),
    ).toBe(true);
    // The far tile itself may be rock when it is the one being lit.
    expect(
      segmentBlocked(rows, centerX(5), centerY(1), centerX(5), centerY(2), {
        tx: 5,
        ty: 2,
      }),
    ).toBe(false);
    // A diagonal through cell corners touches neither side cell.
    expect(
      segmentBlocked(rows, centerX(1), centerY(1), centerX(3), centerY(3)),
    ).toBe(true);
  });
});
