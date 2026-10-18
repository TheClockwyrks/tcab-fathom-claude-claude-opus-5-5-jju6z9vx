# Fathom

A bioluminescent deep-sea maze chase that runs entirely in the browser.

You are a glimmerfin, a tiny glowing forager threading the flooded corridors of
a pitch-dark maze. Graze every plankton mote to clear the maze and descend to a
deeper one, while three predators hunt you, each by a different sense:

- **Lanternjaw** hunts your light. Its amber lure looks exactly like a harmless
  bonus drifter.
- **Gloamfin** is blind and hunts by sound. It pings the maze with violet sonar,
  hears you up close, and hears your own sonar too.
- **Flarefish** stays invisible until it flares, lighting the maze around it and
  locking onto anything caught in the bloom.

This is the **Kindle** dive. You see the maze only through a circle around you
that grows as you eat. Ground you have explored stays remembered, but outside
the circle it goes dark again. Your sonar pulse floods the nearby corridors and
shows the hunters it touches, and an ink cloud blinds the hunters that see.

## Install

Requires Node.js 20 or later.

```sh
npm ci
```

## Run in development

```sh
npm run dev
```

Then open the URL Vite prints (by default <http://localhost:5173>).

## Production build

```sh
npm run build
```

This type-checks and writes a self-contained static site to `dist/`, with
`index.html` at its root. Serve that directory as-is from any static host, at
the server root or under a sub-path. Every URL the game requests is relative to
the page. To preview the build locally:

```sh
npm run preview
```

## Controls

| Key                   | Action                                              |
| --------------------- | --------------------------------------------------- |
| Arrow keys / W A S D  | Swim. A turn pressed early is taken at the next junction. |
| Space                 | Sonar pulse (in play), or confirm a menu item       |
| Shift                 | Release an ink cloud                                |
| Enter                 | Confirm a menu item                                 |
| Escape                | Pause and resume, or go back from a menu            |
| P                     | Pause and resume                                    |
| M                     | Mute or unmute the sound                            |
| ` (backtick)          | Toggle the debug overlay                            |

The menus also take the mouse and touch: point at an item to select it, then
click or tap it to confirm. On a touchscreen, the game shows a direction pad
and buttons for the sonar pulse, the ink, and confirm.

## Scoring

| Event               | Points |
| ------------------- | ------ |
| Eat a plankton      | 10     |
| Eat a bonus drifter | 200    |
| Clear a maze        | 500    |

A dive starts with 3 lives in reserve. Each deeper maze holds one more predator,
up to six, and your sonar's reach shrinks by one tile per depth, down to five
tiles.

## Development

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run typecheck` | Type-checks with `tsc --noEmit`                |
| `npm run lint`      | Runs ESLint                                    |
| `npm run format`    | Checks formatting with Prettier                |
| `npm test`          | Runs the Vitest suite in Node, with coverage   |

The game is built on the Simple 2D engine, which is documented in `engine/`. The
specification it implements is in `specs/`. The source is in `src/`:

| Module           | Contents                                                     |
| ---------------- | ------------------------------------------------------------ |
| `game.ts`        | The state and debug-surface types, and the engine binding    |
| `flow.ts`        | Each frame's input and the fixed 120 Hz simulation loop      |
| `sim.ts`         | The simulation: movement, sensing, predators, scoring        |
| `maze.ts`        | Grid geometry, line of sight, and the maze generator         |
| `debug.ts`       | The debug and automation surface, and the snapshot           |
| `render.ts`      | All drawing                                                  |
| `layout.ts`      | Menu layout, shared by drawing and pointer hit tests         |
| `art.ts`, `audio.ts`, `diagnostics.ts` | Sprite loading, sound cues, overlay values |

The tests run the real engine over a native canvas with a scripted clock. They
set up scenarios through the debug surface and step an exact number of ticks.
`src/testkit.ts` is the harness.

The store-page presentation is in `showcase/`.
