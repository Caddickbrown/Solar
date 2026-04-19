// ---------------------------------------------------------------------------
// horizon.js — Altitude calculation and horizon crossing detection
//
// Key insight from the spec:
//   A "planet setting" is just the moment altitude crosses zero.
//   No heuristics — just geometry and time.
// ---------------------------------------------------------------------------

import { heliocentricPosition, eclipticToEquatorial, toRaDec } from './kepler.js';
import { julianDate, daysSinceJ2000, altAz, lst } from './astronomy.js';
import { PLANETS } from './elements.js';

// ---------------------------------------------------------------------------
// Core: get altitude (radians) of a body as seen by an observer at a JS Date
//
// body:     planet name string (key in PLANETS) or planet element object
// observer: { lat, lon } in radians
// date:     JS Date (or JD number if isJD=true)
// ---------------------------------------------------------------------------
export function getAltitude(body, observer, date, isJD = false) {
  const { alt } = getAltAz(body, observer, date, isJD);
  return alt;
}

export function getAltAz(body, observer, date, isJD = false) {
  const jd = isJD ? date : julianDate(date);
  const t  = daysSinceJ2000(jd);

  const el = typeof body === 'string' ? PLANETS[body] : body;

  // Heliocentric ecliptic positions
  const posBody  = heliocentricPosition(el,          t);
  const posEarth = heliocentricPosition(PLANETS.Earth, t);

  // Geocentric ecliptic vector
  const rel = {
    x: posBody.x - posEarth.x,
    y: posBody.y - posEarth.y,
    z: posBody.z - posEarth.z,
  };

  // Ecliptic → equatorial → RA/Dec
  const eq = eclipticToEquatorial(rel);
  const { ra, dec, r } = toRaDec(eq);

  // Observer frame → altitude & azimuth
  const { alt, az } = altAz(ra, dec, jd, observer);

  return { alt, az, ra, dec, r, jd };
}

// ---------------------------------------------------------------------------
// Horizon crossing detection — Method B (binary search)
//
// Finds the next rise OR set event from t_start, searching up to
// searchHours hours ahead.
//
// Returns: { type: 'rise'|'set', date: JS Date, jd: number }
//       or null if no crossing found within the search window
//
// Algorithm:
//   1. Step through time at coarse intervals
//   2. When altitude sign changes, we've bracketed a crossing
//   3. Binary-search that bracket to the given tolerance
// ---------------------------------------------------------------------------
export function findNextCrossing(body, observer, startDate, {
  searchHours  = 48,
  stepMinutes  = 15,
  toleranceSec = 30,
} = {}) {
  const stepMs = stepMinutes * 60 * 1000;
  const endMs  = startDate.getTime() + searchHours * 3600 * 1000;

  let t_prev = startDate.getTime();
  let h_prev = getAltitude(body, observer, new Date(t_prev));

  for (let t = t_prev + stepMs; t <= endMs; t += stepMs) {
    const h = getAltitude(body, observer, new Date(t));

    if ((h_prev < 0) !== (h < 0)) {
      // Sign change detected — binary search this bracket
      const type     = h_prev < 0 ? 'rise' : 'set';
      const crossing = binarySearch(body, observer, t_prev, t, h_prev, toleranceSec * 1000);
      return { type, date: new Date(crossing), jd: julianDate(new Date(crossing)) };
    }

    h_prev = h;
    t_prev = t;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Find next RISE (altitude: − → +)
// Find next SET  (altitude: + → −)
// Convenience wrappers
// ---------------------------------------------------------------------------
export function findNextRise(body, observer, startDate, opts = {}) {
  // Start the search just before now so we don't miss something already rising
  return findNextCrossing(body, observer, startDate, opts);
}

export function findNextSet(body, observer, startDate, opts = {}) {
  return findNextCrossing(body, observer, startDate, opts);
}

// ---------------------------------------------------------------------------
// Find both next rise AND set, labelled correctly regardless of order
// ---------------------------------------------------------------------------
export function findRiseSet(body, observer, startDate) {
  let rise = null, set = null;

  // Find the first two crossings; classify each
  let searchFrom = startDate;
  for (let i = 0; i < 4 && (!rise || !set); i++) {
    const c = findNextCrossing(body, observer, searchFrom);
    if (!c) break;
    if (c.type === 'rise' && !rise) rise = c;
    if (c.type === 'set'  && !set)  set  = c;
    // Start next search 1 minute after this crossing
    searchFrom = new Date(c.date.getTime() + 60 * 1000);
  }

  return { rise, set };
}

// ---------------------------------------------------------------------------
// Binary search implementation (millisecond timestamps)
// ---------------------------------------------------------------------------
function binarySearch(body, observer, t1_ms, t2_ms, h1, toleranceMs) {
  while ((t2_ms - t1_ms) > toleranceMs) {
    const mid = (t1_ms + t2_ms) / 2;
    const h_mid = getAltitude(body, observer, new Date(mid));
    const h_t1  = getAltitude(body, observer, new Date(t1_ms));

    if ((h_t1 < 0) === (h_mid < 0)) {
      t1_ms = mid;
    } else {
      t2_ms = mid;
    }
  }
  return (t1_ms + t2_ms) / 2;
}

// ---------------------------------------------------------------------------
// Get current visibility summary for all planets
// ---------------------------------------------------------------------------
export function getAllVisibility(observer, date) {
  const results = {};
  for (const name of Object.keys(PLANETS)) {
    if (name === 'Earth') continue;
    const { alt, az, ra, dec, r } = getAltAz(name, observer, date);
    results[name] = {
      alt,
      az,
      ra,
      dec,
      distance: r,
      visible: alt > 0,
    };
  }
  return results;
}
