// ---------------------------------------------------------------------------
// elements.js — J2000.0 orbital elements for the eight major planets
//
// Source: JPL "Keplerian Elements for Approximate Positions of the Major Planets"
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
//
// Epoch: J2000.0 (JD 2451545.0 = 2000-Jan-1.5 TT)
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;

// Gaussian gravitational constant (AU^(3/2) / day)
const K = 0.01720209895;

// Raw elements in degrees / AU
const RAW = {
  //           a (AU)        e           i (°)       Ω (°)         ω (°)         L₀ (°)
  Mercury: [ 0.38709927,  0.20563593,  7.00497902,  48.33076593,  29.12703035, 252.25032350 ],
  Venus:   [ 0.72333566,  0.00677672,  3.39467605,  76.67984255,  54.92262463, 181.97909950 ],
  Earth:   [ 1.00000261,  0.01671123, -0.00001531,   0.0,        102.93768193, 100.46457166 ],
  Mars:    [ 1.52371034,  0.09339410,  1.84969142,  49.55953891, 286.49942645, 355.44656800 ],
  Jupiter: [ 5.20288700,  0.04838624,  1.30439695, 100.47390909, 273.86760060,  34.39644051 ],
  Saturn:  [ 9.53667594,  0.05386179,  2.48599187, 113.66242448, 339.39235800,  49.95424423 ],
  Uranus:  [19.18916464,  0.04725744,  0.77263783,  74.01692503,  96.99895929, 313.23810451 ],
  Neptune: [30.06992276,  0.00859048,  1.77004347, 131.78422574, 272.84678138, 304.87997031 ],
};

// Build usable elements: convert to radians, compute mean motion + M0
export const PLANETS = {};
for (const [name, [a, e, i_deg, O_deg, w_deg, L0_deg]] of Object.entries(RAW)) {
  const omega = O_deg * D2R;
  const w     = w_deg * D2R;
  const M0    = (((L0_deg - O_deg - w_deg) * D2R) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const n     = K / Math.pow(a, 1.5); // mean motion (rad/day)

  PLANETS[name] = { name, a, e, i: i_deg * D2R, omega, w, M0, n };
}

// ---------------------------------------------------------------------------
// Visual properties
// ---------------------------------------------------------------------------
export const PLANET_COLORS = {
  Mercury: '#9e9e9e',
  Venus:   '#ffcc80',
  Earth:   '#4fc3f7',
  Mars:    '#ef5350',
  Jupiter: '#ffb74d',
  Saturn:  '#ffe082',
  Uranus:  '#80deea',
  Neptune: '#5c6bc0',
};

// Relative display radii (scaled for visual clarity — not physical)
export const PLANET_RADII = {
  Mercury: 0.18,
  Venus:   0.30,
  Earth:   0.32,
  Mars:    0.22,
  Jupiter: 0.80,
  Saturn:  0.65,
  Uranus:  0.45,
  Neptune: 0.42,
};

export const PLANET_NAMES = Object.keys(PLANETS);
