// ---------------------------------------------------------------------------
// moon.js — Sun and Moon geocentric positions, phase, and phase search
//
// Moon: truncated Meeus (Astronomical Algorithms, ch. 47) — the largest
// periodic terms only, good to roughly 0.1–0.3°. Longitude is rotated back
// from mean-equinox-of-date to J2000 so it sits in the same frame as the
// planets and the star catalogue.
// Sun: reverse of Earth's heliocentric vector from the Kepler solver.
// ---------------------------------------------------------------------------

import { PLANETS } from './elements.js';
import { heliocentricPosition } from './kepler.js';

const D2R = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const AU_KM = 149597870.7;

const norm360 = d => ((d % 360) + 360) % 360;

// [D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)]
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],   [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],     [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],     [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],     [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],   [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],     [2, 0, 0, -2, 15327, 0],
  [0, 0, 1, 2, -12528, 0],          [0, 0, 1, -2, 10980, 0],
];
// [D, M, M', F, Σb (1e-6 deg)]
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],   [0, 0, 2, 1, 17198],  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
];

// Ecliptic longitude/latitude (J2000 frame, radians) and distance (km)
export function moonEcliptic(jd) {
  const T = (jd - 2451545.0) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T);
  const D  = norm360(297.8501921 + 445267.1114034 * T) * D2R;
  const M  = norm360(357.5291092 + 35999.0502909 * T) * D2R;
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * D2R;
  const F  = norm360(93.2720950 + 483202.0175233 * T) * D2R;
  const E  = 1 - 0.002516 * T;
  const A1 = norm360(119.75 + 131.849 * T) * D2R;
  const A2 = norm360(53.09 + 479264.290 * T) * D2R;
  const A3 = norm360(313.45 + 481266.484 * T) * D2R;
  const Lr = Lp * D2R;

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const e = Math.abs(m) === 1 ? E : 1;
    const arg = d * D + m * M + mp * Mp + f * F;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    const e = Math.abs(m) === 1 ? E : 1;
    sb += b * e * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(Lr - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(Lr) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F)
      + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lr - Mp) - 115 * Math.sin(Lr + Mp);

  const lonOfDate = Lp + sl / 1e6;               // degrees
  const lonJ2000  = lonOfDate - 1.3969713 * T;   // remove general precession
  return {
    lon: norm360(lonJ2000) * D2R,
    lat: (sb / 1e6) * D2R,
    km: 385000.56 + sr / 1000,
  };
}

// Geocentric ecliptic vector (AU, J2000 frame)
export function moonVector(jd) {
  const { lon, lat, km } = moonEcliptic(jd);
  const r = km / AU_KM;
  return {
    x: r * Math.cos(lat) * Math.cos(lon),
    y: r * Math.cos(lat) * Math.sin(lon),
    z: r * Math.sin(lat),
  };
}

// Geocentric ecliptic vector of the Sun (AU)
export function sunVector(jd) {
  const e = heliocentricPosition(PLANETS.Earth, jd - 2451545.0);
  return { x: -e.x, y: -e.y, z: -e.z };
}

const lonOf = v => Math.atan2(v.y, v.x);

// Elongation of the Moon east of the Sun, radians in [0, 2π)
export function moonElongation(jd) {
  return (((lonOf(moonVector(jd)) - lonOf(sunVector(jd))) % TWO_PI) + TWO_PI) % TWO_PI;
}

export function moonPhase(jd) {
  const D = moonElongation(jd);
  const k = (1 - Math.cos(D)) / 2;          // illuminated fraction
  const waxing = D < Math.PI;
  let name;
  if (k < 0.03) name = 'New moon';
  else if (k > 0.97) name = 'Full moon';
  else if (Math.abs(k - 0.5) < 0.06) name = waxing ? 'First quarter' : 'Last quarter';
  else name = (waxing ? 'Waxing ' : 'Waning ') + (k < 0.5 ? 'crescent' : 'gibbous');
  return { elong: D, k, waxing, name };
}

// Next new / first quarter / full / last quarter after jd
const TARGETS = [
  { name: 'New moon', a: 0 }, { name: 'First quarter', a: Math.PI / 2 },
  { name: 'Full moon', a: Math.PI }, { name: 'Last quarter', a: 1.5 * Math.PI },
];
const wrapPi = x => ((x + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

export function nextMoonPhases(jd) {
  const out = [];
  for (const { name, a } of TARGETS) {
    const g = t => wrapPi(moonElongation(t) - a);
    let t0 = jd, g0 = g(t0);
    for (let i = 0; i < 140; i++) {          // up to ~35 days in 6h steps
      const t1 = t0 + 0.25, g1 = g(t1);
      if (g0 < 0 && g1 >= 0 && g1 - g0 < 1) {
        let lo = t0, hi = t1;
        for (let j = 0; j < 30; j++) {
          const mid = (lo + hi) / 2;
          if (g(mid) < 0) lo = mid; else hi = mid;
        }
        out.push({ name, jd: (lo + hi) / 2 });
        break;
      }
      t0 = t1; g0 = g1;
    }
  }
  return out.sort((p, q) => p.jd - q.jd);
}
