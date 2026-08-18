// surfacing.js — pick ONE shelved thought to hand back. Mirrors surfacing.ts exactly.
export const CONFIG = {
  cooldownHalfLifeDays: 1, // how fast a just-shown thought becomes eligible again
  ageWeight: 0.5,          // how hard staleness pulls a thought up
  nagDecayPerSurface: 0.8, // score shrinks by this each time shown-but-not-acted
  candidatePoolSize: 5,    // weighted-random pick among the top K
  minRestDays: 0.02,       // ~30 min floor, so nothing repeats back-to-back
};

const DAY_MS = 86_400_000;

export function scoreThought(t, now, cfg = CONFIG) {
  const ageDays = Math.max(0, (now - t.createdAt) / DAY_MS);
  const restDays =
    t.lastSurfacedAt == null ? Infinity : (now - t.lastSurfacedAt) / DAY_MS;

  const cooldown =
    restDays === Infinity ? 1 : restDays / (restDays + cfg.cooldownHalfLifeDays);
  const nagDecay = Math.pow(cfg.nagDecayPerSurface, t.surfaceCount);
  const agePull = Math.log1p(ageDays);

  return cooldown * nagDecay * (1 + cfg.ageWeight * agePull);
}

export function surfaceOne(thoughts, now = Date.now(), rng = Math.random, cfg = CONFIG) {
  const open = thoughts.filter((t) => t.status === "open");
  if (open.length === 0) return null;

  const eligible = open.filter(
    (t) =>
      t.lastSurfacedAt == null ||
      (now - t.lastSurfacedAt) / DAY_MS >= cfg.minRestDays,
  );
  const pool = eligible.length > 0 ? eligible : open;

  const top = pool
    .map((t) => ({ t, score: scoreThought(t, now, cfg) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.candidatePoolSize);

  const total = top.reduce((s, x) => s + x.score, 0);
  if (total <= 0) return top[0]?.t ?? null;

  let r = rng() * total;
  for (const { t, score } of top) {
    r -= score;
    if (r <= 0) return t;
  }
  return top[top.length - 1].t;
}

export function markSurfaced(t, now = Date.now()) {
  return { ...t, lastSurfacedAt: now, surfaceCount: t.surfaceCount + 1 };
}
export function markDone(t) {
  return { ...t, status: "done" };
}
export function kill(t) {
  return { ...t, status: "killed" };
}
