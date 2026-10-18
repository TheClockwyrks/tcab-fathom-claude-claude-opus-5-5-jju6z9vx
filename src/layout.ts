// Fathom — where the menus sit on the stage. Shared by the drawing, the pointer
// hit tests, and the debug surface's `menuItemRect`, so all three agree.

import { GAMEOVER_ITEMS, PAUSE_ITEMS, STAGE_W, TITLE_ITEMS } from "./constants";
import type { Screen } from "./game";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const ITEM_W = 380;
const ITEM_H = 52;
const ITEM_GAP = 14;

/** The items of the menu a screen shows, or null on a screen with none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return null;
  }
}

const MENU_TOP: Partial<Record<Screen, number>> = {
  title: 440,
  paused: 318,
  gameover: 468,
};

/** Each item's hit region, stacked down the stage's center line. */
export function menuRects(screen: Screen): Rect[] | null {
  const items = menuItems(screen);
  const top = MENU_TOP[screen];
  if (!items || top === undefined) return null;
  return items.map((_, i) => ({
    x: (STAGE_W - ITEM_W) / 2,
    y: top + i * (ITEM_H + ITEM_GAP),
    w: ITEM_W,
    h: ITEM_H,
  }));
}

/** The index of the item whose region holds a point, or -1. */
export function hitItem(rects: readonly Rect[], x: number, y: number): number {
  return rects.findIndex(
    (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
  );
}
