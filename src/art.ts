// Fathom — the sprite sheets of specs/assets.md, loaded through the engine's
// asset loader. A frame that fails to load is held as null and the renderer
// draws a plain stand-in for it, so a missing file never stops the game.

import type { InitApi } from "@clockwyrks/simple-2d";

export type Frames = readonly (ImageBitmap | null)[];

export interface Art {
  readonly forager: Frames;
  readonly lanternjaw: Frames;
  readonly gloamfin: Frames;
  readonly flarefish: Frames;
  readonly drifter: Frames;
  readonly bloom: Frames;
  readonly tiles: Frames;
}

const SHEETS: Readonly<Record<keyof Art, readonly [string, number]>> = {
  forager: ["glimmerfin", 8],
  lanternjaw: ["lanternjaw", 16],
  gloamfin: ["gloamfin", 8],
  flarefish: ["flarefish", 8],
  drifter: ["drifter", 8],
  bloom: ["flare-bloom", 8],
  tiles: ["trench-walls", 19],
};

/** The maze sheet's fixed frames past the sixteen-frame wall autotile. */
export const FLOOR_FRAME = 16;
export const FOG_FRAME = 17;
export const GATE_FRAME = 18;

export async function loadArt<S>(api: InitApi<S>): Promise<Art> {
  const entries = await Promise.all(
    (Object.keys(SHEETS) as (keyof Art)[]).map(async (key) => {
      const [folder, count] = SHEETS[key];
      const frames = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          api.assets
            .loadImage(`${folder}/${i}.png`)
            .catch((): ImageBitmap | null => null),
        ),
      );
      return [key, frames] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as Art;
}
