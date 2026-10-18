import { describe, expect, it } from "vitest";
import {
  ALERT_TIME,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_PING_INTERVAL,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  LINGER_TIME,
  PREDATOR_SPEED,
  DRIFTER_SPEED,
  SONAR_COOLDOWN,
  SONAR_WAVE_SPEED,
  TICK_HZ,
} from "./constants";
import { boot, fixtureMaze, type Harness } from "./testkit";

async function arena(tx: number, ty: number): Promise<Harness> {
  const h = await boot();
  h.pose((d, s) => d.setMaze(s, fixtureMaze()));
  h.pose((d, s) => d.clearPredators(s));
  h.pose((d, s) => d.clearPlankton(s));
  h.pose((d, s) => d.setForagerTile(s, tx, ty));
  h.pose((d, s) => d.setScreen(s, "playing"));
  return h;
}

describe("the fog of war", () => {
  it("lights the pocket around the forager and remembers it", async () => {
    const h = await arena(5, 1);
    await h.ticks(1);
    let s = h.snap();
    expect(s.visibility[1][5]).toBe("l");
    expect(s.visibility[1][7]).toBe("l");
    expect(s.visibility[1][9]).toBe("u");
    expect(s.visibility[2][5]).toBe("l"); // the rock face the light lands on
    expect(s.visibility[3][5]).toBe("u"); // and nothing behind it
    h.pose((d, st) => d.setForagerTile(st, 30, 16));
    await h.ticks(1);
    s = h.snap();
    expect(s.visibility[1][5]).toBe("r");
  });

  it("forgets everything on clearFog until light returns", async () => {
    const h = await arena(5, 1);
    await h.ticks(1);
    h.pose((d, s) => d.clearFog(s));
    h.pose((d, s) => d.reconcile(s));
    expect(h.snap().visibility.join("")).not.toMatch(/[rl]/);
    await h.ticks(1);
    expect(h.snap().visibility[1][5]).toBe("l");
  });
});

describe("the sonar pulse", () => {
  it("floods the corridors as a wavefront and marks the hunters it reaches", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "flarefish", 12, 1));
    h.pose((d, s) => d.setPredatorMind(s, 0, false));
    await h.tap("Space");
    let s = h.snap();
    expect(s.pulses).toHaveLength(1);
    expect(s.pulses[0]).toMatchObject({
      source: "forager",
      tint: "cyan",
      ox: 5,
      oy: 1,
      range: 9,
    });
    expect(s.sonar).toMatchObject({
      ready: false,
      cooldown: SONAR_COOLDOWN - 1 / TICK_HZ,
    });
    expect(h.cues).toContain("sonar");
    expect(s.predators[0].lit).toBe(false);
    await h.ticks(Math.ceil((7 / SONAR_WAVE_SPEED) * TICK_HZ));
    s = h.snap();
    expect(s.predators[0].lit).toBe(true);
    expect(s.visibility[1][12]).toBe("l");
    await h.seconds(SONAR_COOLDOWN);
    s = h.snap();
    expect(s.pulses).toHaveLength(0);
    expect(s.sonar.ready).toBe(true);
    expect(s.visibility[1][12]).toBe("r");
    expect(s.predators[0].lit).toBe(false);
  });

  it("waits out its cooldown", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.setSonarCooldown(s, 1));
    await h.tap("Space");
    expect(h.snap().pulses).toHaveLength(0);
  });

  it("hands a Gloamfin a fix when the front arrives", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 10, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.tap("Space");
    expect(h.snap().predators[0].state).toBe("wander");
    await h.ticks(Math.ceil((5 / SONAR_WAVE_SPEED) * TICK_HZ));
    const p = h.snap().predators[0];
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.speed).toBe(GLOAMFIN_CHASE_SPEED);
  });
});

describe("ink", () => {
  it("stands where it was released for its life", async () => {
    const h = await arena(5, 1);
    await h.tap("ShiftLeft");
    let s = h.snap();
    expect(s.inkClouds).toHaveLength(1);
    expect(s.inkClouds[0]).toMatchObject({
      x: 240,
      y: 128,
      radius: INK_RADIUS,
    });
    expect(s.ink.cooldown).toBeCloseTo(INK_COOLDOWN - 1 / TICK_HZ, 9);
    expect(h.cues).toContain("ink");
    await h.seconds(INK_LIFE);
    s = h.snap();
    expect(s.inkClouds).toHaveLength(0);
  });

  it("blinds a Lanternjaw that would otherwise see the forager", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 8, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.ticks(1);
    expect(h.snap().predators[0].state).toBe("chase");
    await h.tap("ShiftLeft");
    await h.ticks(1);
    expect(h.snap().predators[0].state).toBe("wander");
  });
});

describe("the Lanternjaw", () => {
  it("drifts at the drifter's pace until it sees the forager's light", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 20, 1));
    let p = h.snap().predators[0];
    expect(p).toMatchObject({
      state: "wander",
      released: true,
      dir: "up",
      speed: DRIFTER_SPEED,
    });
    expect(p.detectRange).toBe(128);
    expect(p.hearingRange).toBeNull();
    h.pose((d, s) => d.setBrightness(s, 1));
    h.pose((d, s) => d.setBrightHold(s, 1));
    expect(h.snap().predators[0].detectRange).toBe(320);
    h.pose((d, s) => d.setPredatorTile(s, 0, 14, 1));
    await h.ticks(1);
    p = h.snap().predators[0];
    expect(p.state).toBe("chase");
    expect(p.speed).toBe(PREDATOR_SPEED);
    expect(p.alert).toBe(false);
  });

  it("lingers at the last tile it saw, then gives up", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 8, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.ticks(1);
    expect(h.snap().predators[0].state).toBe("chase");
    h.pose((d, s) => d.setForagerTile(s, 1, 9));
    await h.seconds(LINGER_TIME - 0.05);
    expect(h.snap().predators[0].state).toBe("chase");
    await h.seconds(0.1);
    expect(h.snap().predators[0].state).toBe("wander");
  });
});

describe("the Gloamfin", () => {
  it("hears the forager close by, through anything", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 5, 5));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.ticks(1);
    expect(h.snap().predators[0].hearingLock).toBe(false);
    h.pose((d, s) => d.setForagerTile(s, 6, 1));
    h.pose((d, s) => d.setPredatorTile(s, 0, 7, 1));
    await h.ticks(1);
    const p = h.snap().predators[0];
    expect(p.hearingLock).toBe(true);
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    await h.seconds(ALERT_TIME);
    expect(h.snap().predators[0].alert).toBe(false);
  });

  it("pings on its own timer, and a ping that finds the forager fixes it", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 12, 1));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.seconds(GLOAMFIN_PING_INTERVAL);
    let s = h.snap();
    expect(s.pulses).toHaveLength(1);
    expect(s.pulses[0]).toMatchObject({
      source: "gloamfin",
      tint: "violet",
      ox: 12,
      oy: 1,
      range: 9,
    });
    expect(h.cues).toContain("predator-ping");
    const before = s.visibility.join("");
    await h.ticks(Math.ceil((7 / SONAR_WAVE_SPEED) * TICK_HZ) + 1);
    s = h.snap();
    expect(s.predators[0].state).toBe("chase");
    expect(s.predators[0].lit).toBe(true); // its alert
    expect(s.visibility.join("")).toBe(before); // a ping reveals nothing
  });

  it("searches an empty fixed tile, pings orange, then gives up", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 9, 1));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    h.pose((d, s) => d.setForagerTile(s, 1, 16));
    await h.seconds(1.2);
    const s = h.snap();
    expect(s.predators[0].state).toBe("search");
    expect(s.predators[0].speed).toBe(PREDATOR_SPEED);
    const tints = new Set<string>();
    for (let k = 0; k < 20; k++) {
      await h.seconds(0.1);
      for (const p of h.snap().pulses) tints.add(p.tint);
    }
    expect(tints.has("orange")).toBe(true);
    await h.seconds(4);
    expect(h.snap().predators[0].state).toBe("wander");
  });

  it("loses its chase edge on a corner", async () => {
    const h = await arena(1, 9);
    h.pose((d, s) => d.addPredator(s, "gloamfin", 4, 1));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    h.pose((d, s) => d.setPredatorDir(s, 0, "left"));
    await h.seconds(0.85);
    const speed = h.snap().predators[0].speed;
    expect(speed).toBeGreaterThanOrEqual(GLOAMFIN_CORNER_SPEED);
    expect(speed).toBeLessThan(GLOAMFIN_CHASE_SPEED);
  });
});

describe("the Flarefish", () => {
  it("charges, blooms, reveals the disc, and re-arms", async () => {
    const h = await arena(5, 1);
    h.pose((d, s) => d.addPredator(s, "flarefish", 30, 16));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    let p = h.snap().predators[0];
    expect(p).toMatchObject({
      flareCharging: false,
      flaring: false,
      flareRadius: 0,
    });
    await h.seconds(FLARE_INTERVAL);
    p = h.snap().predators[0];
    expect(p.flareCharging).toBe(true);
    await h.seconds(FLARE_CHARGE);
    const s = h.snap();
    p = s.predators[0];
    expect(p).toMatchObject({
      flareCharging: false,
      flaring: true,
      flareRadius: FLARE_RADIUS,
      lit: true,
    });
    expect(h.cues).toContain("flare");
    expect(s.visibility[16][30]).toBe("l");
    expect(s.visibility[16][25]).toBe("l");
    expect(s.visibility[13][30]).toBe("l"); // rock inside the disc
    await h.seconds(1);
    p = h.snap().predators[0];
    expect(p.flaring).toBe(false);
    expect(h.snap().visibility[16][25]).toBe("r");
  });

  it("locks on with its bloom past its ordinary range", async () => {
    const h = await arena(5, 9);
    h.pose((d, s) => d.addPredator(s, "flarefish", 5, 5));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.seconds(FLARE_INTERVAL + FLARE_CHARGE - 0.02);
    expect(h.snap().predators[0].state).toBe("wander");
    await h.ticks(3);
    const p = h.snap().predators[0];
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.flaring).toBe(false);
  });
});
