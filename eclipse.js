// ---------------------------------------------------------------------------
// eclipse.js — solar and lunar eclipses.
//
// Finds each new and full moon, refines the moment of least separation from
// the Sun (or the Earth's shadow), and classifies it from the real angular
// sizes at that moment. Local circumstances use the topocentric Moon from
// horizon.js, so parallax is included. Timing is good to a few minutes; the
// classification is checked against known eclipses.
// ---------------------------------------------------------------------------

import { moonVector, sunVector, moonElongation } from './moon.js';
import { getAltAz } from './horizon.js';

const AU_KM = 149597870.7, RE_KM = 6378.14, RM_KM = 1737.4;
const ASEC = Math.PI / 648000;
const SUN_SD_1AU = 959.63 * ASEC;       // Sun's angular radius at 1 AU
const SUN_PAR_1AU = 8.794 * ASEC;       // horizontal parallax of the Sun at 1 AU
const TWO_PI = 2 * Math.PI;
const wrapPi = x => ((x + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
const jdToMs = jd => (jd - 2440587.5) * 86400000;
const msToJd = ms => ms / 86400000 + 2440587.5;

const unit = v => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));

// geometry at one instant
export function geometry(jd) {
  const m = moonVector(jd), s = sunVector(jd);
  const dist = Math.hypot(m.x, m.y, m.z) * AU_KM, rs = Math.hypot(s.x, s.y, s.z);
  const mu = unit(m), su = unit(s);
  return {
    moonSD: Math.asin(RM_KM / dist), moonPar: Math.asin(RE_KM / dist),
    sunSD: SUN_SD_1AU / rs, sunPar: SUN_PAR_1AU / rs,
    sepSun: angle(mu, su),
    sepAnti: angle(mu, { x: -su.x, y: -su.y, z: -su.z }),
  };
}

// local solar obscuration (0..1) and magnitude from a separation and the two radii
export function obscuration(sep, sunSD, moonSD) {
  if (sep >= sunSD + moonSD) return { obsc: 0, mag: 0 };
  const mag = (sunSD + moonSD - sep) / (2 * sunSD);
  if (sep <= Math.abs(sunSD - moonSD)) return { obsc: moonSD >= sunSD ? 1 : (moonSD * moonSD) / (sunSD * sunSD), mag };
  const R = sunSD, r = moonSD, d = sep;
  const A = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r))
          + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
          - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return { obsc: A / (Math.PI * R * R), mag };
}

// umbra / penumbra radii of the Earth's shadow at the Moon's distance
export function shadowRadii(g) {
  return { umbra: 1.02 * (g.moonPar + g.sunPar - g.sunSD), penumbra: 1.02 * (g.moonPar + g.sunPar + g.sunSD) };
}

// next time elongation passes `target` after jd (6 h steps then bisection)
function nextConjunction(target, jd) {
  const f = t => wrapPi(moonElongation(t) - target);
  let t0 = jd, f0 = f(t0);
  for (let i = 0; i < 130; i++) {
    const t1 = t0 + 0.25, f1 = f(t1);
    if (f0 < 0 && f1 >= 0 && f1 - f0 < 1) {
      let lo = t0, hi = t1;
      for (let j = 0; j < 30; j++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    t0 = t1; f0 = f1;
  }
  return null;
}

// time of least separation within ±0.15 d of jd
function refine(jd, key) {
  let lo = jd - 0.15, hi = jd + 0.15;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (geometry(a)[key] < geometry(b)[key]) hi = b; else lo = a;
  }
  return (lo + hi) / 2;
}

function classify(kind, jd) {
  const g = geometry(jd);
  if (kind === 'solar') {
    const gamma = g.sepSun / g.moonPar;                        // shadow-axis miss distance in Earth radii
    if (!(g.sepSun < g.moonPar + g.sunSD + g.moonSD)) return null;
    if (gamma < 0.9972) {
      const diff = g.moonSD - g.sunSD;
      return { type: Math.abs(diff) < 0.00002 ? 'Hybrid' : diff > 0 ? 'Total' : 'Annular', gamma, g };
    }
    return { type: 'Partial', gamma, g };
  }
  const { umbra, penumbra } = shadowRadii(g);
  const sep = g.sepAnti;
  let type = null;
  if (sep < umbra - g.moonSD) type = 'Total';
  else if (sep < umbra + g.moonSD) type = 'Partial';
  else if (sep < penumbra + g.moonSD) type = 'Penumbral';
  if (!type) return null;
  return { type, mag: (umbra + g.moonSD - sep) / (2 * g.moonSD), g };   // umbral magnitude
}

// Next `count` eclipses after startMs. Returns [{kind,type,ms,gamma?,mag?}]
export function nextEclipses(startMs, count = 4) {
  const out = [];
  let jd = msToJd(startMs) - 0.3;
  for (let guard = 0; guard < 90 && out.length < count; guard++) {
    const cands = [];
    const jn = nextConjunction(0, jd), jf = nextConjunction(Math.PI, jd);
    if (jn) cands.push(['solar', jn]);
    if (jf) cands.push(['lunar', jf]);
    if (!cands.length) break;
    cands.sort((a, b) => a[1] - b[1]);
    const [kind, jc] = cands[0];
    jd = jc + 1;
    const tmax = refine(jc, kind === 'solar' ? 'sepSun' : 'sepAnti');
    const c = classify(kind, tmax);
    if (!c || jdToMs(tmax) < startMs - 6 * 3600e3) continue;
    out.push({ kind, type: c.type, ms: jdToMs(tmax), gamma: c.gamma, mag: c.mag });
  }
  return out;
}

const sepOf = (m, s) => Math.acos(Math.max(-1, Math.min(1,
  Math.sin(m.dec) * Math.sin(s.dec) + Math.cos(m.dec) * Math.cos(s.dec) * Math.cos(m.ra - s.ra))));

// How an eclipse looks from one place
export function localCircumstances(ev, obs) {
  if (ev.kind === 'lunar') {
    const a = getAltAz('Moon', obs, new Date(ev.ms));
    return { visible: a.alt > 0, alt: a.alt, ms: ev.ms };
  }
  const at = ms => {
    const d = new Date(ms), m = getAltAz('Moon', obs, d), s = getAltAz('Sun', obs, d);
    return { sep: sepOf(m, s), alt: s.alt };
  };
  // scan ±4 h in 2-minute steps for the least topocentric separation, then refine
  let best = { sep: 9, ms: ev.ms };
  for (let dm = -240; dm <= 240; dm += 2) {
    const ms = ev.ms + dm * 60000, v = at(ms);
    if (v.sep < best.sep) best = { sep: v.sep, ms };
  }
  let lo = best.ms - 120000, hi = best.ms + 120000;
  for (let i = 0; i < 24; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (at(a).sep < at(b).sep) hi = b; else lo = a;
  }
  const ms = (lo + hi) / 2, { sep, alt } = at(ms);
  const g = geometry(msToJd(ms));
  const { obsc, mag } = obscuration(sep, g.sunSD, g.moonSD);
  return { visible: obsc > 0 && alt > -0.5 * Math.PI / 180, obsc, mag, ms, sunAlt: alt, sep, total: obsc > 0.999 };
}
