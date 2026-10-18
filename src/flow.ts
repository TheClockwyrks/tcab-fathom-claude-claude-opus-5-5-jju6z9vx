// Fathom — one frame of the game: the controls each screen reads, the menus
// and their pointer regions, and the fixed-step loop that turns the frame's
// delta time into whole simulation ticks.

import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  DRIFTER_INTERVAL,
  START_LIVES,
  TICK_HZ,
  type CueName,
} from "./constants";
import type { Art, FathomState } from "./game";
import { hitItem, menuItems, menuRects } from "./layout";
import { DIRS } from "./maze";
import {
  beginDive,
  emitSonar,
  freshDive,
  releaseInk,
  setScreenTo,
  thaw,
  tick,
} from "./sim";

/** The title-screen state a session opens on and a reset returns to. */
export function createState(
  seed: number,
  art: Art,
  muted: boolean,
): FathomState {
  const s: FathomState = {
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: START_LIVES,
    muted,
    simTime: 0,
    carry: 0,
    screenTimer: 0,
    tiles: [],
    plankton: [],
    visibility: [],
    brightness: 0,
    brightHold: 0,
    sonar: { cooldown: 0 },
    ink: { cooldown: 0 },
    drifterIn: DRIFTER_INTERVAL,
    forager: { x: 0, y: 0, dir: "left", moving: false, desired: null },
    drifters: [],
    predators: [],
    pulses: [],
    inkClouds: [],
    releaseClock: null,
    nextId: 1,
    rng: seed >>> 0,
    seed: seed >>> 0,
    press: null,
    art,
  };
  freshDive(s);
  return s;
}

function returnToTitle(s: FathomState): void {
  freshDive(s);
  setScreenTo(s, "title");
}

/** Takes the item at `index` on the menu the current screen shows. */
function confirmItem(s: FathomState, index: number): void {
  switch (s.screen) {
    case "title":
      s.titleIndex = index;
      if (index === 0) beginDive(s);
      else setScreenTo(s, "howto");
      return;
    case "paused":
      if (index === 0) setScreenTo(s, "playing");
      else if (index === 1) beginDive(s);
      else returnToTitle(s);
      return;
    case "gameover":
      if (index === 0) beginDive(s);
      else returnToTitle(s);
      return;
    default:
      return;
  }
}

function moveSelection(s: FathomState, api: UpdateApi): void {
  const items = menuItems(s.screen);
  if (!items) return;
  const n = items.length;
  if (api.input.pressed("up")) s.menuIndex = ((s.menuIndex ?? 0) + n - 1) % n;
  if (api.input.pressed("down")) s.menuIndex = ((s.menuIndex ?? 0) + 1) % n;
}

/**
 * Pointer and touch on a menu: moving onto an item selects it, and a press and
 * its release inside one item select and confirm it. On the how-to-play screen,
 * which has no items, a press and release anywhere returns to the title.
 */
function readPointer(s: FathomState, api: UpdateApi): void {
  const rects = menuRects(s.screen);
  const screen = s.screen;
  for (const sample of api.input.pointerSamples()) {
    if (!sample.primary || s.screen !== screen) continue;
    const hit = rects ? hitItem(rects, sample.x, sample.y) : 0;
    if (sample.type === "move") {
      if (rects && hit >= 0) s.menuIndex = hit;
    } else if (sample.type === "down") {
      s.press = hit;
      if (rects && hit >= 0) s.menuIndex = hit;
    } else {
      const pressed = s.press;
      s.press = null;
      if (hit < 0 || pressed !== hit) continue;
      if (!rects) {
        returnToTitle(s);
        continue;
      }
      s.menuIndex = hit;
      confirmItem(s, hit);
    }
  }
}

function readPlaying(s: FathomState, api: UpdateApi, cues: Set<CueName>): void {
  if (api.input.pressed("pause")) {
    setScreenTo(s, "paused");
    return;
  }
  if (api.input.pressed("a")) emitSonar(s, cues);
  if (api.input.pressed("b")) releaseInk(s, cues);
  const f = s.forager;
  for (const d of DIRS) if (api.input.pressed(d)) f.desired = d;
  if (f.desired === null) {
    f.desired = DIRS.find((d) => api.input.value(d) > 0) ?? null;
  }
}

/** Reads the actions in the current screen's row, and no others. */
function readScreen(s: FathomState, api: UpdateApi, cues: Set<CueName>): void {
  switch (s.screen) {
    case "title":
    case "gameover":
      moveSelection(s, api);
      if (api.input.pressed("confirm")) confirmItem(s, s.menuIndex ?? 0);
      else if (api.input.pressed("back") && s.screen === "gameover") {
        returnToTitle(s);
      } else readPointer(s, api);
      return;
    case "paused": {
      const pause = api.input.pressed("pause");
      const back = api.input.pressed("back");
      if (pause || back) {
        setScreenTo(s, "playing");
        return;
      }
      moveSelection(s, api);
      if (api.input.pressed("confirm")) confirmItem(s, s.menuIndex ?? 0);
      else readPointer(s, api);
      return;
    }
    case "howto":
      if (api.input.pressed("confirm") || api.input.pressed("back")) {
        returnToTitle(s);
      } else readPointer(s, api);
      return;
    case "playing":
      readPlaying(s, api, cues);
      return;
    default:
      return;
  }
}

function play(api: UpdateApi, cues: Set<CueName>): void {
  for (const cue of cues) api.audio.play(cue);
}

/** The game's `update`: input, then the whole ticks this frame's time completes. */
export function frame(
  state: DeepReadonly<FathomState>,
  api: UpdateApi,
  dt: number,
): FathomState {
  const s = thaw(state);
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

  const cues = new Set<CueName>();
  readScreen(s, api, cues);
  play(api, cues);

  const held = DIRS.some((d) => api.input.value(d) > 0);
  const total = s.carry + (Number.isFinite(dt) && dt > 0 ? dt : 0);
  const ticks = Math.floor(total * TICK_HZ + 1e-6);
  s.carry = Math.max(0, total - ticks / TICK_HZ);
  for (let i = 0; i < ticks; i++) {
    const tickCues = new Set<CueName>();
    tick(s, held, tickCues);
    play(api, tickCues);
  }
  s.simTime = (Math.round(s.simTime * TICK_HZ) + ticks) / TICK_HZ;
  s.muted = api.audio.muted();
  return s;
}
