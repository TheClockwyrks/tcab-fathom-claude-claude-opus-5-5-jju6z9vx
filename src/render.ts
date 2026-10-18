// Fathom — the drawing. Everything is drawn in logical units through the
// context the engine hands `render`, from the sheets under `assets/` where
// specs/assets.md names one and in code everywhere else. Nothing here writes
// to the state: it arrives read-only.

import type { RenderApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  ALERT_TIME,
  DIVE_LABEL,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_RADIUS,
  GRID_COLS,
  GRID_ROWS,
  INK_COOLDOWN,
  PLANKTON_DOT,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TICK_HZ,
  TILE,
  TITLE_TEXT,
} from "./constants";
import { FLOOR_FRAME, FOG_FRAME, GATE_FRAME, type Frames } from "./art";
import type { Dir, FathomState, Predator, Pulse, Screen } from "./game";
import { menuItems, menuRects } from "./layout";
import {
  MAZE_BOTTOM,
  MAZE_LEFT,
  MAZE_RIGHT,
  MAZE_TOP,
  centerX,
  centerY,
  index,
  tileAt,
} from "./maze";
import { FLARE_FADE, visionRadius, windowRadius } from "./sim";

type View = DeepReadonly<FathomState>;
type Ctx = CanvasRenderingContext2D;

/** The stage background: the near-black of deep water. */
export const BACKGROUND = "#02060c";

const FONT =
  'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

const COLOR = {
  fog: "#04080e",
  rock: "#1b2a3a",
  floor: "#0b1724",
  dim: "rgba(2, 6, 12, 0.64)",
  forager: "120, 236, 255",
  plankton: "#d2fff3",
  text: "#dff6ff",
  textDim: "#6f8ea3",
  label: "#4d6a7d",
  cyan: "95, 243, 255",
  violet: "184, 126, 255",
  orange: "255, 150, 60",
  gloamfin: "#b87eff",
  flarefish: "#ff6a5a",
  lanternjaw: "#ffb04a",
} as const;

const TINTS: Readonly<Record<Pulse["tint"], string>> = {
  cyan: COLOR.cyan,
  violet: COLOR.violet,
  orange: COLOR.orange,
};

/** The pair of frames each facing takes in a four-facing sheet. */
const FACING: Readonly<Record<Dir, number>> = {
  down: 0,
  up: 2,
  left: 4,
  right: 6,
};

/** The flare bloom art's lit radius, in source pixels, at frame 5. */
const BLOOM_ART_RADIUS = 64;

// ---- Small drawing helpers -------------------------------------------------------

function sprite(
  frames: DeepReadonly<Frames>,
  i: number,
): CanvasImageSource | null {
  return (frames[i] ?? null) as CanvasImageSource | null;
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  weight = "",
): void {
  ctx.font = `${weight} ${size}px ${FONT}`.trim();
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

/** Text with its letters spread apart, centered on x. */
function spacedText(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  spacing: number,
  weight = "",
): void {
  ctx.font = `${weight} ${size}px ${FONT}`.trim();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  const widths = [...value].map((c) => ctx.measureText(c).width);
  const total =
    widths.reduce((a, w) => a + w, 0) + spacing * (value.length - 1);
  let cx = x - total / 2;
  [...value].forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
}

function clipCircle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  ctx.clip();
}

function glow(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---- The maze --------------------------------------------------------------------

function wallFrame(rows: readonly string[], tx: number, ty: number): number {
  const rock = (x: number, y: number): boolean =>
    x < 0 ||
    y < 0 ||
    x >= GRID_COLS ||
    y >= GRID_ROWS ||
    tileAt(rows, x, y) === "#";
  return (
    (rock(tx, ty - 1) ? 1 : 0) |
    (rock(tx + 1, ty) ? 2 : 0) |
    (rock(tx, ty + 1) ? 4 : 0) |
    (rock(tx - 1, ty) ? 8 : 0)
  );
}

function tileLeft(tx: number): number {
  return MAZE_LEFT + tx * TILE;
}

function tileTop(ty: number): number {
  return MAZE_TOP + ty * TILE;
}

/** One tile of terrain at full brightness. */
function terrain(ctx: Ctx, s: View, tx: number, ty: number): void {
  const c = tileAt(s.tiles, tx, ty);
  const x = tileLeft(tx);
  const y = tileTop(ty);
  const frame =
    c === "#"
      ? wallFrame(s.tiles, tx, ty)
      : c === "g"
        ? GATE_FRAME
        : FLOOR_FRAME;
  const img = sprite(s.art.tiles, frame);
  if (img) ctx.drawImage(img, x, y, TILE, TILE);
  else {
    ctx.fillStyle = c === "#" ? COLOR.rock : COLOR.floor;
    ctx.fillRect(x, y, TILE, TILE);
  }
  if (c === "d") {
    ctx.fillStyle = "rgba(20, 4, 24, 0.45)";
    ctx.fillRect(x, y, TILE, TILE);
  }
}

/** Cool light on open water, so a lit corridor reads apart from the rock. */
function wash(ctx: Ctx, tx: number, ty: number, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(60, 150, 190, ${alpha})`;
  ctx.fillRect(tileLeft(tx), tileTop(ty), TILE, TILE);
  ctx.restore();
}

function fogTile(ctx: Ctx, s: View, tx: number, ty: number): void {
  const img = sprite(s.art.tiles, FOG_FRAME);
  if (img) ctx.drawImage(img, tileLeft(tx), tileTop(ty), TILE, TILE);
  else {
    ctx.fillStyle = COLOR.fog;
    ctx.fillRect(tileLeft(tx), tileTop(ty), TILE, TILE);
  }
}

function plankton(
  ctx: Ctx,
  tx: number,
  ty: number,
  bright: boolean,
  t: number,
): void {
  const x = centerX(tx);
  const y = centerY(ty);
  if (!bright) {
    ctx.fillStyle = "rgba(150, 225, 210, 0.32)";
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    return;
  }
  const shimmer = 0.75 + 0.25 * Math.sin(t * 3 + tx * 1.7 + ty * 2.3);
  glow(ctx, x, y, PLANKTON_DOT * 1.6, "190, 255, 240", 0.45 * shimmer);
  ctx.fillStyle = COLOR.plankton;
  ctx.beginPath();
  ctx.arc(x, y, PLANKTON_DOT / 2, 0, Math.PI * 2);
  ctx.fill();
}

/** The fog everywhere, then what the vision circle shows of the fog's memory. */
function drawMaze(ctx: Ctx, s: View, t: number): void {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) fogTile(ctx, s, tx, ty);
  }
  const f = s.forager;
  const r = windowRadius(s.brightness);
  const v = visionRadius(s.brightness);
  ctx.save();
  clipCircle(ctx, f.x, f.y, r);
  const span = Math.ceil(r / TILE) + 1;
  const fx = Math.floor((f.x - MAZE_LEFT) / TILE);
  const fy = Math.floor((f.y - MAZE_TOP) / TILE);
  for (
    let ty = Math.max(0, fy - span);
    ty <= Math.min(GRID_ROWS - 1, fy + span);
    ty++
  ) {
    for (
      let tx = Math.max(0, fx - span);
      tx <= Math.min(GRID_COLS - 1, fx + span);
      tx++
    ) {
      const vis = s.visibility[ty][tx];
      if (vis === "u") continue;
      terrain(ctx, s, tx, ty);
      const water = tileAt(s.tiles, tx, ty) !== "#";
      if (vis === "r") {
        ctx.fillStyle = COLOR.dim;
        ctx.fillRect(tileLeft(tx), tileTop(ty), TILE, TILE);
        if (water) wash(ctx, tx, ty, 0.05);
      } else if (water) {
        const near = Math.hypot(centerX(tx) - f.x, centerY(ty) - f.y);
        wash(ctx, tx, ty, 0.08 + 0.16 * Math.max(0, 1 - near / (v + TILE)));
      }
      if (s.plankton[ty][tx] === "*") plankton(ctx, tx, ty, vis === "l", t);
    }
  }
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, f.x, f.y, r, COLOR.forager, 0.07);
  glow(
    ctx,
    f.x,
    f.y,
    visionRadius(s.brightness),
    COLOR.forager,
    0.1 + 0.08 * s.brightness,
  );
  ctx.restore();
}

/** A blooming flare's disc: full vision, drawn over the mask. */
function drawFlareDiscs(ctx: Ctx, s: View, t: number): void {
  for (const p of s.predators) {
    if (p.kind !== "flarefish" || p.state === "den" || p.flarePhase !== "bloom")
      continue;
    ctx.save();
    clipCircle(ctx, p.x, p.y, FLARE_RADIUS);
    const span = Math.ceil(FLARE_RADIUS / TILE) + 1;
    const px = Math.floor((p.x - MAZE_LEFT) / TILE);
    const py = Math.floor((p.y - MAZE_TOP) / TILE);
    for (
      let ty = Math.max(0, py - span);
      ty <= Math.min(GRID_ROWS - 1, py + span);
      ty++
    ) {
      for (
        let tx = Math.max(0, px - span);
        tx <= Math.min(GRID_COLS - 1, px + span);
        tx++
      ) {
        terrain(ctx, s, tx, ty);
        if (s.plankton[ty][tx] === "*") plankton(ctx, tx, ty, true, t);
      }
    }
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, p.x, p.y, FLARE_RADIUS, "255, 170, 90", 0.16);
    ctx.restore();
  }
}

// ---- Creatures and effects -----------------------------------------------------------

/** The amber bulb-light, drawn identically for a drifter and a Lanternjaw. */
function bulb(ctx: Ctx, x: number, y: number, t: number): void {
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.6);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, x, y - 4, 15 * pulse, "255, 120, 40", 0.55);
  glow(ctx, x, y - 4, 7, "255, 190, 110", 0.8);
  ctx.restore();
  ctx.fillStyle = "#ffe2b0";
  ctx.beginPath();
  ctx.arc(x, y - 4, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function body(
  ctx: Ctx,
  frames: DeepReadonly<Frames>,
  i: number,
  x: number,
  y: number,
  fallback: string,
): void {
  const img = sprite(frames, i);
  if (img) {
    ctx.drawImage(img, x - TILE / 2, y - TILE / 2, TILE, TILE);
    return;
  }
  ctx.fillStyle = fallback;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
}

/** The drifter sway loop, shared by a wandering Lanternjaw's disguise. */
function swayFrame(t: number): number {
  return Math.floor(t * 8) % 8;
}

function predatorFrame(p: DeepReadonly<Predator>, t: number): number {
  if (p.kind === "lanternjaw") {
    return p.state === "chase"
      ? FACING[p.dir] + (Math.floor(t * 7) % 2)
      : 8 + swayFrame(t);
  }
  return FACING[p.dir] + (Math.floor(t * 6 + p.id * 0.5) % 2);
}

function drawCreatures(ctx: Ctx, s: View, t: number): void {
  for (const d of s.drifters) {
    if (d.lit) body(ctx, s.art.drifter, swayFrame(t), d.x, d.y, "#c9a25a");
  }
  for (const p of s.predators) {
    if (!p.lit) continue;
    const tile =
      s.visibility[Math.floor((p.y - MAZE_TOP) / TILE)]?.[
        Math.floor((p.x - MAZE_LEFT) / TILE)
      ];
    const live = tile === "l" || p.alertTime > 0;
    ctx.save();
    ctx.globalAlpha = live ? 1 : Math.max(0.2, p.markTime / SONAR_MARK_TIME);
    body(ctx, s.art[p.kind], predatorFrame(p, t), p.x, p.y, COLOR[p.kind]);
    ctx.restore();
  }
}

function drawInk(ctx: Ctx, s: View): void {
  for (const c of s.inkClouds) {
    const fade = Math.min(1, c.remaining / 0.5);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius);
    g.addColorStop(0, `rgba(0, 0, 2, ${0.9 * fade})`);
    g.addColorStop(0.7, `rgba(2, 3, 8, ${0.78 * fade})`);
    g.addColorStop(1, "rgba(2, 3, 8, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The amber lights, clipped to the vision circle. */
function drawAmber(ctx: Ctx, s: View, t: number): void {
  ctx.save();
  clipCircle(ctx, s.forager.x, s.forager.y, windowRadius(s.brightness));
  for (const d of s.drifters) bulb(ctx, d.x, d.y, t);
  for (const p of s.predators) {
    if (p.kind === "lanternjaw" && p.state !== "den") bulb(ctx, p.x, p.y, t);
  }
  ctx.restore();
}

function drawForager(ctx: Ctx, s: View, t: number): void {
  const f = s.forager;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(
    ctx,
    f.x,
    f.y,
    26 + 14 * s.brightness,
    COLOR.forager,
    0.35 + 0.3 * s.brightness,
  );
  ctx.restore();
  const chomp = f.moving ? Math.floor(t * 9) % 2 : 0;
  body(ctx, s.art.forager, FACING[f.dir] + chomp, f.x, f.y, "#78ecff");
}

/** The flare art over the mask: charge-up, bloom, then the fade beat. */
function drawFlares(ctx: Ctx, s: View): void {
  const size = 128 * (FLARE_RADIUS / BLOOM_ART_RADIUS);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = false;
  for (const p of s.predators) {
    if (p.kind !== "flarefish" || p.state === "den") continue;
    let frame = -1;
    if (p.flarePhase === "charge") {
      frame = Math.min(2, Math.floor((p.flareTime / FLARE_CHARGE) * 3));
    } else if (p.flarePhase === "bloom") {
      frame = 3 + Math.min(2, Math.floor((p.flareTime / FLARE_BLOOM) * 3));
    } else if (p.fadeTime > 0) {
      frame = p.fadeTime > FLARE_FADE / 2 ? 6 : 7;
    }
    if (frame < 0) continue;
    const img = sprite(s.art.bloom, frame);
    if (img) ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
    else
      glow(ctx, p.x, p.y, frame < 3 ? 40 : FLARE_RADIUS, "255, 170, 90", 0.5);
  }
  ctx.restore();
}

function drawAlerts(ctx: Ctx, s: View): void {
  for (const p of s.predators) {
    if (p.alertTime <= 0 || p.kind === "lanternjaw") continue;
    const a = 1 - p.alertTime / ALERT_TIME;
    const color = p.kind === "gloamfin" ? COLOR.violet : "255, 96, 80";
    const r = 12 + 46 * Math.sqrt(a);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, p.x, p.y, r, color, 0.5 * (1 - a));
    ctx.strokeStyle = `rgba(${color}, ${1 - a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(
        p.x + Math.cos(ang) * r * 0.55,
        p.y + Math.sin(ang) * r * 0.55,
      );
      ctx.lineTo(
        p.x + Math.cos(ang) * r * 1.25,
        p.y + Math.sin(ang) * r * 1.25,
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Each wavefront as a crest flowing through the corridors it floods: a soft
 * wake over the tiles it has just passed, and a bright bar standing across
 * every corridor at the front's exact position, so it bends round corners and
 * splits at junctions the way the reveal does.
 */
function drawPulses(ctx: Ctx, s: View): void {
  const trail = 2.2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const p of s.pulses) {
    const rgb = TINTS[p.tint];
    const at = (tx: number, ty: number): number =>
      tx < 0 || ty < 0 || tx >= GRID_COLS || ty >= GRID_ROWS
        ? -1
        : p.dist[index(tx, ty)];
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        const d = at(tx, ty);
        if (d < 0 || d > p.range || d > p.front) continue;
        const x = centerX(tx);
        const y = centerY(ty);
        const behind = p.front - d;
        if (behind < trail) {
          const k = 1 - behind / trail;
          ctx.fillStyle = `rgba(${rgb}, ${0.2 * k})`;
          ctx.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
        }
        if (behind >= 1) continue;
        const ahead = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(
          ([dx, dy]) => at(tx + dx, ty + dy) === d + 1 && d + 1 <= p.range,
        );
        const fade = Math.min(1, (p.range + 1 - p.front) * 2);
        for (const [dx, dy] of ahead) {
          const cx = x + dx * behind * TILE;
          const cy = y + dy * behind * TILE;
          glow(ctx, cx, cy, TILE * 0.75, rgb, 0.55 * fade);
          ctx.strokeStyle = `rgba(${rgb}, ${0.95 * fade})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(cx - dy * TILE * 0.38, cy - dx * TILE * 0.38);
          ctx.lineTo(cx + dy * TILE * 0.38, cy + dx * TILE * 0.38);
          ctx.stroke();
        }
        if (ahead.length === 0 && behind < 0.5) {
          // The front meets rock or its range here and breaks against it.
          glow(ctx, x, y, TILE * 0.7, rgb, 0.6 * (1 - behind * 2));
        }
      }
    }
  }
  ctx.restore();
}

function drawWorld(ctx: Ctx, s: View, t: number): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(
    MAZE_LEFT,
    MAZE_TOP,
    MAZE_RIGHT - MAZE_LEFT,
    MAZE_BOTTOM - MAZE_TOP,
  );
  drawMaze(ctx, s, t);
  drawFlareDiscs(ctx, s, t);
  drawCreatures(ctx, s, t);
  drawInk(ctx, s);
  drawAmber(ctx, s, t);
  drawForager(ctx, s, t);
  drawFlares(ctx, s);
  drawAlerts(ctx, s);
  drawPulses(ctx, s);
  ctx.strokeStyle = `rgba(${COLOR.forager}, 0.10)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, windowRadius(s.brightness), 0, Math.PI * 2);
  ctx.stroke();
}

// ---- The HUD ---------------------------------------------------------------------------

function gauge(
  ctx: Ctx,
  label: string,
  x: number,
  y: number,
  fill: number,
  rgb: string,
): void {
  const ready = fill >= 1;
  text(
    ctx,
    label,
    x,
    y + 9,
    14,
    ready ? COLOR.text : COLOR.textDim,
    "left",
    "bold",
  );
  const bx = x + 64;
  ctx.fillStyle = "rgba(120, 160, 190, 0.14)";
  ctx.fillRect(bx, y - 1, 120, 12);
  ctx.fillStyle = ready ? `rgba(${rgb}, 0.95)` : `rgba(${rgb}, 0.4)`;
  ctx.fillRect(bx, y - 1, 120 * Math.max(0, Math.min(1, fill)), 12);
  ctx.strokeStyle = `rgba(${rgb}, ${ready ? 0.9 : 0.35})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, y - 0.5, 119, 11);
}

function drawHud(ctx: Ctx, s: View): void {
  ctx.fillStyle = "#03080f";
  ctx.fillRect(0, 0, STAGE_W, MAZE_TOP);
  ctx.fillRect(0, MAZE_BOTTOM, STAGE_W, STAGE_H - MAZE_BOTTOM);
  ctx.fillStyle = "rgba(95, 243, 255, 0.18)";
  ctx.fillRect(MAZE_LEFT, MAZE_TOP - 2, MAZE_RIGHT - MAZE_LEFT, 1);
  ctx.fillRect(MAZE_LEFT, MAZE_BOTTOM + 1, MAZE_RIGHT - MAZE_LEFT, 1);

  text(ctx, String(s.score), MAZE_LEFT, 64, 48, COLOR.text, "left", "bold");
  text(ctx, DIVE_LABEL, MAZE_RIGHT, 30, 14, COLOR.label, "right");
  text(ctx, "GLOW", MAZE_RIGHT - 196, 60, 14, COLOR.textDim, "left");
  ctx.fillStyle = "rgba(120, 160, 190, 0.14)";
  ctx.fillRect(MAZE_RIGHT - 140, 49, 140, 12);
  ctx.fillStyle = `rgba(${COLOR.forager}, 0.85)`;
  ctx.fillRect(MAZE_RIGHT - 140, 49, 140 * Math.min(1, s.brightness), 12);

  const y = 688;
  const icon = sprite(s.art.forager, FACING.right);
  for (let i = 0; i < s.lives; i++) {
    const x = MAZE_LEFT + 4 + i * 30;
    if (icon) ctx.drawImage(icon, x, y - 12, 24, 24);
    else {
      ctx.fillStyle = "#78ecff";
      ctx.beginPath();
      ctx.arc(x + 12, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  text(ctx, `DEPTH ${s.depth}`, 400, y + 8, 22, COLOR.text, "left", "bold");
  gauge(
    ctx,
    "SONAR",
    780,
    y - 5,
    1 - s.sonar.cooldown / SONAR_COOLDOWN,
    COLOR.cyan,
  );
  gauge(
    ctx,
    "INK",
    1032,
    y - 5,
    1 - s.ink.cooldown / INK_COOLDOWN,
    "170, 150, 230",
  );
}

// ---- Menus and screens ------------------------------------------------------------------

function drawMenu(ctx: Ctx, s: View, screen: Screen): void {
  const items = menuItems(screen);
  const rects = menuRects(screen);
  if (!items || !rects) return;
  items.forEach((label, i) => {
    const r = rects[i];
    const on = s.menuIndex === i;
    if (on) {
      ctx.fillStyle = `rgba(${COLOR.cyan}, 0.13)`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = `rgba(${COLOR.cyan}, 0.8)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    const label2 = on ? `>  ${label}  <` : label;
    text(
      ctx,
      label2,
      r.x + r.w / 2,
      r.y + r.h / 2 + 8,
      24,
      on ? COLOR.text : COLOR.textDim,
      "center",
      on ? "bold" : "",
    );
  });
}

/** A dim slice of the maze as a backdrop for the title and game-over screens. */
function drawBackdrop(ctx: Ctx, s: View, t: number): void {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) terrain(ctx, s, tx, ty);
  }
  ctx.fillStyle = "rgba(2, 6, 12, 0.8)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  const g = ctx.createRadialGradient(640, 360, 120, 640, 360, 720);
  g.addColorStop(0, "rgba(2, 6, 12, 0)");
  g.addColorStop(1, "rgba(2, 6, 12, 1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 28; k++) {
    const x = (k * 197 + t * (6 + (k % 5))) % STAGE_W;
    const y = (k * 131 + Math.sin(t * 0.4 + k) * 24 + STAGE_H) % STAGE_H;
    glow(
      ctx,
      x,
      y,
      5 + (k % 3),
      "160, 245, 235",
      0.25 + 0.2 * Math.sin(t * 1.3 + k),
    );
  }
  ctx.restore();
}

function drawTitle(ctx: Ctx, s: View, t: number): void {
  drawBackdrop(ctx, s, t);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 640, 230, 360, COLOR.forager, 0.12);
  ctx.restore();
  ctx.save();
  ctx.shadowColor = `rgba(${COLOR.forager}, 0.9)`;
  ctx.shadowBlur = 28;
  spacedText(ctx, TITLE_TEXT, 640, 280, 120, "#c8f7ff", 22, "bold");
  ctx.restore();
  spacedText(ctx, TAGLINE_TEXT, 640, 336, 22, COLOR.textDim, 10);
  const fx = 640 + Math.sin(t * 0.7) * 220;
  const fy = 384 + Math.sin(t * 1.4) * 6;
  const dir: Dir = Math.cos(t * 0.7) >= 0 ? "right" : "left";
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, fx, fy, 34, COLOR.forager, 0.45);
  ctx.restore();
  body(
    ctx,
    s.art.forager,
    FACING[dir] + (Math.floor(t * 8) % 2),
    fx,
    fy,
    "#78ecff",
  );
  drawMenu(ctx, s, "title");
  text(
    ctx,
    "ARROWS / WASD  SWIM    SPACE  SONAR    SHIFT  INK    ESC / P  PAUSE    M  MUTE",
    640,
    680,
    14,
    COLOR.label,
  );
}

const HOWTO: readonly (readonly [string, string])[] = [
  ["", "You are a glimmerfin, a tiny glowing forager lost in a drowned maze."],
  ["", "Eat every plankton mote to clear the maze, then sink to the next one."],
  ["CONTROLS", ""],
  [
    "ARROWS / WASD",
    "swim; tap a turn early and you'll take it at the junction",
  ],
  [
    "SPACE",
    "sonar pulse: floods nearby corridors and shows hunters it touches",
  ],
  ["SHIFT", "ink cloud: blinds any hunter that hunts by sight"],
  ["ESC / P", "pause, and resume"],
  ["M", "sound on or off"],
  ["READING THE DARK", ""],
  [
    "",
    "Your own glow lights a small pocket around you. Eating makes you brighter,",
  ],
  ["", "and your circle of sight widens - but brighter is easier to spot."],
  [
    "",
    "Ground you've explored is remembered, but outside your circle it goes dark.",
  ],
  ["THE HUNTERS", ""],
  [
    "LANTERNJAW",
    "hunts your light. Its amber lure looks just like a harmless drifter.",
  ],
  [
    "GLOAMFIN",
    "blind; hunts by sound. Its violet ping finds you, and so does your sonar.",
  ],
  [
    "FLAREFISH",
    "unseen until it flares. If its burst touches you, it's coming.",
  ],
];

function drawHowto(ctx: Ctx, s: View, t: number): void {
  drawBackdrop(ctx, s, t);
  spacedText(ctx, "HOW TO PLAY", 640, 92, 40, COLOR.text, 8, "bold");
  let y = 150;
  for (const [head, line] of HOWTO) {
    if (head && !line) {
      y += 10;
      text(ctx, head, 150, y, 18, `rgb(${COLOR.cyan})`, "left", "bold");
    } else if (head) {
      text(ctx, head, 150, y, 17, COLOR.text, "left", "bold");
      text(ctx, line, 330, y, 17, COLOR.textDim, "left");
    } else {
      text(ctx, line, 150, y, 17, "#a9c4d4", "left");
    }
    y += 30;
  }
  text(ctx, "ENTER / ESC / CLICK  BACK", 640, 690, 16, COLOR.label);
}

function drawGameover(ctx: Ctx, s: View, t: number): void {
  drawBackdrop(ctx, s, t);
  ctx.save();
  ctx.shadowColor = "rgba(255, 90, 80, 0.7)";
  ctx.shadowBlur = 24;
  spacedText(ctx, "THE DARK TAKES YOU", 640, 220, 52, "#ffd2cc", 6, "bold");
  ctx.restore();
  text(ctx, "FINAL SCORE", 640, 300, 18, COLOR.textDim);
  text(ctx, String(s.score), 640, 360, 56, COLOR.text, "center", "bold");
  text(
    ctx,
    `DEPTH REACHED  ${s.depth}`,
    640,
    414,
    22,
    `rgb(${COLOR.cyan})`,
    "center",
    "bold",
  );
  drawMenu(ctx, s, "gameover");
}

function band(ctx: Ctx, y: number, h: number): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(2, 6, 12, 0)");
  g.addColorStop(0.25, "rgba(2, 6, 12, 0.82)");
  g.addColorStop(0.75, "rgba(2, 6, 12, 0.82)");
  g.addColorStop(1, "rgba(2, 6, 12, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(MAZE_LEFT, y, MAZE_RIGHT - MAZE_LEFT, h);
}

function drawOverlay(ctx: Ctx, s: View): void {
  if (s.screen === "countdown") {
    band(ctx, 250, 170);
    spacedText(ctx, "DIVE", 640, 338, 72, "#c8f7ff", 18, "bold");
    const left = Math.max(1, Math.ceil(s.screenTimer / TICK_HZ));
    text(
      ctx,
      String(left),
      640,
      392,
      32,
      `rgb(${COLOR.cyan})`,
      "center",
      "bold",
    );
  } else if (s.screen === "cleared") {
    band(ctx, 250, 170);
    spacedText(
      ctx,
      `DEPTH ${s.depth} CLEARED`,
      640,
      340,
      48,
      "#c8f7ff",
      8,
      "bold",
    );
    text(ctx, "DESCENDING...", 640, 388, 20, COLOR.textDim);
  } else if (s.screen === "paused") {
    ctx.fillStyle = "rgba(2, 6, 12, 0.72)";
    ctx.fillRect(
      MAZE_LEFT,
      MAZE_TOP,
      MAZE_RIGHT - MAZE_LEFT,
      MAZE_BOTTOM - MAZE_TOP,
    );
    spacedText(ctx, "PAUSED", 640, 270, 48, COLOR.text, 12, "bold");
    drawMenu(ctx, s, "paused");
  }
}

/** The game's `render`. */
export function draw(state: View, api: RenderApi): void {
  const ctx = api.ctx;
  const t = state.simTime;
  ctx.imageSmoothingEnabled = false;
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state, t);
      return;
    case "howto":
      drawHowto(ctx, state, t);
      return;
    case "gameover":
      drawGameover(ctx, state, t);
      return;
    default:
      drawWorld(ctx, state, t);
      drawHud(ctx, state);
      drawOverlay(ctx, state);
  }
}
