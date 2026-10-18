// Fathom — the seven cues of specs/progression.md, each synthesized from its
// declaration and each a distinct short sound.

import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";
import { CUES, type CueName } from "./constants";

const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.eat]: {
    wave: "sine",
    freq: 920,
    freqTo: 1380,
    gain: 0.08,
    durationMs: 45,
  },
  [CUES.sonar]: {
    wave: "sine",
    freq: 1500,
    freqTo: 320,
    gain: 0.2,
    durationMs: 420,
  },
  [CUES.ink]: {
    wave: "sawtooth",
    freq: 170,
    freqTo: 55,
    gain: 0.1,
    durationMs: 280,
  },
  [CUES.predatorPing]: {
    wave: "triangle",
    freq: 480,
    freqTo: 860,
    gain: 0.14,
    durationMs: 320,
  },
  [CUES.flare]: {
    wave: "square",
    freq: 240,
    freqTo: 1300,
    gain: 0.08,
    durationMs: 360,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 420,
    freqTo: 60,
    gain: 0.2,
    durationMs: 650,
  },
  [CUES.descend]: {
    wave: "triangle",
    freq: 330,
    freqTo: 990,
    gain: 0.16,
    durationMs: 720,
  },
};

export function defineCues<S>(api: InitApi<S>): void {
  for (const [name, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(name, spec);
  }
}
