// ---------------------------------------------------------------------------
// smallbodies.js — dwarf planets and comets from JPL's Small-Body Database.
//
// Two-body propagation from each object's osculating epoch. Good for years
// near the epoch (arcminutes for Ceres, a fraction of a degree for the distant
// dwarfs); comets are rougher the further you travel from their perihelion.
// Magnitudes: asteroid H (phase ignored) and the comet M1/K1 total-magnitude
// law, so treat them as predictions, not measurements.
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;
const K = 0.01720209895;             // Gaussian gravitational constant

export const SMALL = {};             // key → body, filled by loadSmall()
export const SMALL_ORDER = [];       // keys in display order

const DWARF_COLORS = {
  Ceres: '#bfb4a3', Pluto: '#cdb5a0', Haumea: '#d9d2c5', Makemake: '#c79b7e', Eris: '#d5d3cf',
};
export const COMET_COLOR = '#a9d4c4';

let earthFn = null;
export function setEarthFn(fn) { earthFn = fn; }

export async function loadSmall(url) {
  const d = await (await fetch(url)).json();
  for (const b of d.dwarfs) {
    const n = b.n * D2R;
    const M0 = b.ma * D2R - n * (b.epoch - 2451545.0);
    SMALL[b.name] = {
      key: b.name, label: b.name, kind: 'dwarf', color: DWARF_COLORS[b.name] || '#c8c0b0',
      H: b.H, el: { a: b.a, e: b.e, i: b.i * D2R, omega: b.om * D2R, w: b.w * D2R, M0, n },
    };
    SMALL_ORDER.push(b.name);
  }
  for (const c of d.comets) {
    SMALL[c.key] = {
      key: c.key, label: c.label, full: c.name, kind: 'comet', color: COMET_COLOR,
      M1: c.M1, K1: c.K1, orb: { q: c.q, e: c.e, i: c.i * D2R, omega: c.om * D2R, w: c.w * D2R, tp: c.tp },
    };
    SMALL_ORDER.push(c.key);
  }
}

// when does a comet look brightest within ±2 years of a given JD? (needs setEarthFn first)
export function findPeak(b, jdCentre) {
  let best = { m: 99, jd: 0 };
  for (let jd = jdCentre - 730; jd <= jdCentre + 730; jd += 5) {
    const m = smallMagnitude(b, jd - 2451545.0);
    if (m < best.m) best = { m, jd };
  }
  return best;
}

// heliocentric ecliptic position (AU), t = days since J2000
export function smallPosition(b, t) {
  if (b.kind === 'dwarf') return keplerEllipse(b.el, t);
  return cometPosition(b.orb, t + 2451545.0);
}

function keplerEllipse(el, t) {
  const M = (((el.M0 + el.n * t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = M + el.e * Math.sin(M);
  for (let i = 0; i < 40; i++) {
    const d = (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
    E -= d; if (Math.abs(d) < 1e-12) break;
  }
  const x = el.a * (Math.cos(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return rotate(x, y, el.w, el.i, el.omega);
}

function rotate(x, y, w, i, om) {
  const cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i), co = Math.cos(om), so = Math.sin(om);
  return {
    x: (co * cw - so * sw * ci) * x + (-co * sw - so * cw * ci) * y,
    y: (so * cw + co * sw * ci) * x + (-so * sw + co * cw * ci) * y,
    z: (sw * si) * x + (cw * si) * y,
  };
}

// ellipse, hyperbola or near-parabola from q, e, tp
function cometPosition(o, jd) {
  const dt = jd - o.tp;
  let x, y;
  if (o.e < 0.999) {
    const a = o.q / (1 - o.e), n = K / Math.pow(a, 1.5);
    const M = ((n * dt) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    let E = M + o.e * Math.sin(M);
    for (let i = 0; i < 60; i++) { const d = (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (Math.cos(E) - o.e); y = a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  } else if (o.e > 1.001) {
    const a = o.q / (o.e - 1), n = K / Math.pow(a, 1.5), M = n * dt;
    let H = Math.asinh(M / o.e);
    for (let i = 0; i < 80; i++) { const d = (o.e * Math.sinh(H) - H - M) / (o.e * Math.cosh(H) - 1); H -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (o.e - Math.cosh(H)); y = a * Math.sqrt(o.e * o.e - 1) * Math.sinh(H);
  } else {
    // parabolic (Barker's equation), used for e within 0.1% of 1
    const W = 3 * K / Math.sqrt(2) * dt / Math.pow(o.q, 1.5);
    const Y = Math.cbrt(W / 2 + Math.sqrt(W * W / 4 + 1));
    const s = Y - 1 / Y;                    // tan(ν/2)
    const nu = 2 * Math.atan(s), r = o.q * (1 + s * s);
    x = r * Math.cos(nu); y = r * Math.sin(nu);
  }
  return rotate(x, y, o.w, o.i, o.omega);
}

function approxEarth(t) {
  const L = (100.46 + 0.9856474 * t) * D2R;
  return { x: Math.cos(L), y: Math.sin(L), z: 0 };
}

// apparent magnitude at time t (days since J2000)
export function smallMagnitude(b, t) {
  const p = smallPosition(b, t);
  const e = earthFn ? earthFn(t) : approxEarth(t);
  const r = Math.hypot(p.x, p.y, p.z);
  const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
  if (b.kind === 'dwarf') return b.H + 5 * Math.log10(r * d);
  return b.M1 + 5 * Math.log10(d) + b.K1 * Math.log10(r);
}

// points along the orbit for drawing: [{x,y,z}] in AU
export function orbitSamples(b, rMax = 70) {
  const pts = [];
  if (b.kind === 'dwarf') {
    for (let i = 0; i <= 360; i++) pts.push(keplerEllipse({ ...b.el, M0: i / 360 * 2 * Math.PI, n: 0 }, 0));
    return pts;
  }
  const o = b.orb, p = o.q * (1 + o.e);
  let lim = Math.PI * 0.999;
  const rr = o.e >= 1 ? rMax : Math.min(rMax, p / (1 - o.e));
  lim = Math.min(lim, Math.acos(Math.max(-1, Math.min(1, (p / rr - 1) / o.e))));
  for (let i = -120; i <= 120; i++) {
    const nu = lim * Math.sign(i) * Math.pow(Math.abs(i) / 120, 1.6);
    const r = p / (1 + o.e * Math.cos(nu));
    pts.push(rotate(r * Math.cos(nu), r * Math.sin(nu), o.w, o.i, o.omega));
  }
  return pts;
}
