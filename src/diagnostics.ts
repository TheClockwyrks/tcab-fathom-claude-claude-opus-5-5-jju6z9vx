// Fathom — the values the engine's debug overlay shows. Each source is a pure
// read of the state current at the read.

import type { InitApi } from "@clockwyrks/simple-2d";
import type { FathomState } from "./game";
import { tileOf } from "./maze";
import { plankRemaining, speedOf, visionRadius, windowRadius } from "./sim";

/** Overlay lines reserved for predators; a roster past this shows its count. */
const PREDATOR_LINES = 8;

export function registerDiagnostics(api: InitApi<FathomState>): void {
  const d = api.diagnostics;
  d.register("screen", (s) => s.screen);
  d.register("depth", (s) => s.depth);
  d.register("score", (s) => s.score);
  d.register("lives", (s) => s.lives);
  d.register("G", (s) => s.brightness);
  d.register("V", (s) => visionRadius(s.brightness));
  d.register("R", (s) => windowRadius(s.brightness));
  d.register("sonar cd", (s) => s.sonar.cooldown);
  d.register("ink cd", (s) => s.ink.cooldown);
  d.register("plankton", (s) => plankRemaining(s.plankton));
  d.register("forager", (s) => {
    const t = tileOf(s.forager.x, s.forager.y);
    return `${t.tx},${t.ty} ${s.forager.dir}`;
  });
  d.register("predators", (s) => s.predators.length);
  for (let i = 0; i < PREDATOR_LINES; i++) {
    d.register(`pred ${i}`, (s) => {
      const p = s.predators[i];
      if (!p) return "-";
      const t = tileOf(p.x, p.y);
      const alert = p.alertTime > 0 ? " ALERT" : "";
      return `${p.kind} ${p.state} ${t.tx},${t.ty} ${speedOf(p).toFixed(0)}${alert}`;
    });
  }
}
