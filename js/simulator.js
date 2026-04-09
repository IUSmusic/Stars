export const DEFAULT_SCENARIO_PRESETS = {
  balanced: { label: 'Balanced Test', rq: 0.74, intention: 0.55, polarity: 0.0, empathy: 0.56 },
  world:    { label: 'World Mode',    rq: 0.62, intention: 0.58, polarity: -0.06, empathy: 0.42 },
  crisis:   { label: 'Crisis Shock',  rq: 0.40, intention: 0.72, polarity: -0.42, empathy: 0.22 },
  repair:   { label: 'Repair Cycle',  rq: 0.82, intention: 0.64, polarity: 0.24, empathy: 0.84 },
  lowQ:     { label: 'Low-Q',         rq: 0.30, intention: 0.55, polarity: -0.10, empathy: 0.38 },
  highQ:    { label: 'High-Q',        rq: 0.90, intention: 0.55, polarity: 0.10, empathy: 0.76 },
};

export function mulberry32(seed = 42) {
  let t = seed >>> 0;
  return function seeded() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRandom(seed = 42) {
  return mulberry32(seed);
}

export function gaussianRandom(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function edgeKey(a, b) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}
