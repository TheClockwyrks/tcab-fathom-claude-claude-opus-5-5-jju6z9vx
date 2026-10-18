// Fathom — the seeded generator. Its whole state is one 32-bit integer carried
// in FathomState, so a run replays exactly from the state it started from.

/** One mulberry32 draw: the value in [0, 1) and the generator's next state. */
export function nextRandom(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A draw function over a holder of the seed, advancing it with every draw. */
export function drawFrom(holder: { rng: number }): () => number {
  return () => {
    const [value, next] = nextRandom(holder.rng);
    holder.rng = next;
    return value;
  };
}
