// ---------------------------------------------------------------------------
// kepler.js — Keplerian orbital mechanics
//
// Pipeline:  elements + time  →  heliocentric ecliptic position (AU)
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

// Normalise angle to [0, 2π)
function norm(rad) {
  return ((rad % TWO_PI) + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Solve Kepler's equation:  M = E - e·sin(E)
// Uses Newton-Raphson iteration; converges in ~4–6 steps for e < 0.9
// ---------------------------------------------------------------------------
export function solveKepler(M, e, tol = 1e-10) {
  M = norm(M);
  let E = M; // initial guess
  for (let i = 0; i < 50; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

// ---------------------------------------------------------------------------
// Compute heliocentric ecliptic position vector from orbital elements + time
//
// elements: { a, e, i, omega (Ω), w (ω), M0, n }
//   a     — semi-major axis (AU)
//   e     — eccentricity
//   i     — inclination (rad)
//   omega — longitude of ascending node Ω (rad)
//   w     — argument of periapsis ω (rad)
//   M0    — mean anomaly at J2000.0 (rad)
//   n     — mean motion (rad/day)
//
// t: days since J2000.0
//
// Returns: { x, y, z } in AU (ecliptic frame, x → vernal equinox)
// ---------------------------------------------------------------------------
export function heliocentricPosition(el, t) {
  // Step 1 — Mean anomaly at time t
  const M = norm(el.M0 + el.n * t);

  // Step 2 — Eccentric anomaly via Newton-Raphson
  const E = solveKepler(M, el.e);

  // Step 3 — Position in the orbital plane (perifocal coords)
  const x_orb = el.a * (Math.cos(E) - el.e);
  const y_orb = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);

  // Step 4 — Rotate orbital plane → ecliptic via ω, i, Ω
  const cw = Math.cos(el.w),  sw = Math.sin(el.w);
  const ci = Math.cos(el.i),  si = Math.sin(el.i);
  const cO = Math.cos(el.omega), sO = Math.sin(el.omega);

  // Standard rotation matrix  R_z(-Ω) · R_x(-i) · R_z(-ω)
  const x = (cO * cw - sO * sw * ci) * x_orb + (-cO * sw - sO * cw * ci) * y_orb;
  const y = (sO * cw + cO * sw * ci) * x_orb + (-sO * sw + cO * cw * ci) * y_orb;
  const z = (sw * si)                * x_orb + ( cw * si)                 * y_orb;

  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Convert ecliptic coords → equatorial coords
// ε ≈ 23.439° (obliquity of the ecliptic at J2000.0)
// ---------------------------------------------------------------------------
const OBLIQUITY = 23.43929111 * (Math.PI / 180);
const COS_EPS   = Math.cos(OBLIQUITY);
const SIN_EPS   = Math.sin(OBLIQUITY);

export function eclipticToEquatorial({ x, y, z }) {
  return {
    x,
    y: y * COS_EPS - z * SIN_EPS,
    z: y * SIN_EPS + z * COS_EPS,
  };
}

// ---------------------------------------------------------------------------
// Equatorial Cartesian → RA / Dec
// Returns: { ra, dec } in radians;  ra ∈ [0, 2π),  dec ∈ [-π/2, π/2]
// ---------------------------------------------------------------------------
export function toRaDec({ x, y, z }) {
  const r = Math.sqrt(x * x + y * y + z * z);
  return {
    ra:  norm(Math.atan2(y, x)),
    dec: Math.asin(z / r),
    r,
  };
}
