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

// Full Meeus ch. 47 tables.
// [D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)]
const LR = [
  [0,0,1,0,6288774,-20905355],
  [2,0,-1,0,1274027,-3699111],
  [2,0,0,0,658314,-2955968],
  [0,0,2,0,213618,-569925],
  [0,1,0,0,-185116,48888],
  [0,0,0,2,-114332,-3149],
  [2,0,-2,0,58793,246158],
  [2,-1,-1,0,57066,-152138],
  [2,0,1,0,53322,-170733],
  [2,-1,0,0,45758,-204586],
  [0,1,-1,0,-40923,-129620],
  [1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],
  [2,0,0,-2,15327,10321],
  [0,0,1,2,-12528,0],
  [0,0,1,-2,10980,79661],
  [4,0,-1,0,10675,-34782],
  [0,0,3,0,10034,-23210],
  [4,0,-2,0,8548,-21636],
  [2,1,-1,0,-7888,24208],
  [2,1,0,0,-6766,30824],
  [1,0,-1,0,-5163,-8379],
  [1,1,0,0,4987,-16675],
  [2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],
  [4,0,0,0,3861,-11650],
  [2,0,-3,0,3665,14403],
  [0,1,-2,0,-2689,-7003],
  [2,0,-1,2,-2602,0],
  [2,-1,-2,0,2390,10056],
  [1,0,1,0,-2348,6322],
  [2,-2,0,0,2236,-9884],
  [0,1,2,0,-2120,5751],
  [0,2,0,0,-2069,0],
  [2,-2,-1,0,2048,-4950],
  [2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],
  [4,-1,-1,0,1215,-3958],
  [0,0,2,2,-1110,0],
  [3,0,-1,0,-892,3258],
  [2,1,1,0,-810,2616],
  [4,-1,-2,0,759,-1897],
  [0,2,-1,0,-713,-2117],
  [2,2,-1,0,-700,2354],
  [2,1,-2,0,691,0],
  [2,-1,0,-2,596,0],
  [4,0,1,0,549,-1423],
  [0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],
  [1,0,-2,0,-487,-1739],
  [2,1,0,-2,-399,0],
  [0,0,2,-2,-381,-4421],
  [1,1,1,0,351,0],
  [3,0,-2,0,-340,0],
  [4,0,-3,0,330,0],
  [2,-1,2,0,327,0],
  [0,2,1,0,-323,1165],
  [1,1,-1,0,299,0],
  [2,0,3,0,294,0],
  [2,0,-1,-2,0,8752],
];
// [D, M, M', F, Σb (1e-6 deg)]
const B = [
  [0,0,0,1,5128122],
  [0,0,1,1,280602],
  [0,0,1,-1,277693],
  [2,0,0,-1,173237],
  [2,0,-1,1,55413],
  [2,0,-1,-1,46271],
  [2,0,0,1,32573],
  [0,0,2,1,17198],
  [2,0,1,-1,9266],
  [0,0,2,-1,8822],
  [2,-1,0,-1,8216],
  [2,0,-2,-1,4324],
  [2,0,1,1,4200],
  [2,1,0,-1,-3359],
  [2,-1,-1,1,2463],
  [2,-1,0,1,2211],
  [2,-1,-1,-1,2065],
  [0,1,-1,-1,-1870],
  [4,0,-1,-1,1828],
  [0,1,0,1,-1794],
  [0,0,0,3,-1749],
  [0,1,-1,1,-1565],
  [1,0,0,1,-1491],
  [0,1,1,1,-1475],
  [0,1,1,-1,-1410],
  [0,1,0,-1,-1344],
  [1,0,0,-1,-1335],
  [0,0,3,1,1107],
  [4,0,0,-1,1021],
  [4,0,-1,1,833],
  [0,0,1,-3,777],
  [4,0,-2,1,671],
  [2,0,0,-3,607],
  [2,0,2,-1,596],
  [2,-1,1,-1,491],
  [2,0,-2,1,-451],
  [0,0,3,-1,439],
  [2,0,2,1,422],
  [2,0,-3,-1,421],
  [2,1,-1,1,-366],
  [2,1,0,1,-351],
  [4,0,0,1,331],
  [2,-1,1,1,315],
  [2,-2,0,-1,302],
  [0,0,1,3,-283],
  [2,1,1,-1,-229],
  [1,1,0,-1,223],
  [1,1,0,1,223],
  [0,1,-2,-1,-220],
  [2,1,-1,-1,-220],
  [1,0,1,1,-185],
  [2,-1,-2,-1,181],
  [0,1,2,1,-177],
  [4,0,-2,-1,176],
  [4,-1,-1,-1,166],
  [1,0,1,-1,-164],
  [4,0,1,-1,132],
  [1,0,-1,-1,-119],
  [4,-1,0,-1,115],
  [2,-2,0,1,107],
];

// Ecliptic longitude/latitude (J2000 frame, radians) and distance (km)
export function moonEcliptic(jdUT) {
  const jd = jdUT + 69 / 86400;                  // UT → TT (≈69 s)
  const T = (jd - 2451545.0) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000);
  const D  = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000) * D2R;
  const M  = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000) * D2R;
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000) * D2R;
  const F  = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000) * D2R;
  const E  = 1 - 0.002516 * T - 0.0000074 * T * T;
  const A1 = norm360(119.75 + 131.849 * T) * D2R;
  const A2 = norm360(53.09 + 479264.290 * T) * D2R;
  const A3 = norm360(313.45 + 481266.484 * T) * D2R;
  const Lr = Lp * D2R;

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    const arg = d * D + m * M + mp * Mp + f * F;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
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
