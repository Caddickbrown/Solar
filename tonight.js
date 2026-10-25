// ---------------------------------------------------------------------------
// tonight.js — what the night holds from a given place: sun and twilight
// times, moon, which bodies are up when, and close approaches.
// ---------------------------------------------------------------------------

import { getAltAz } from './horizon.js';
import { julianDate } from './astronomy.js';
import { moonPhase, nextMoonPhases } from './moon.js';

const R2D = 180 / Math.PI;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const BODIES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

const altOf = (body, obs, ms) => getAltAz(body, obs, new Date(ms)).alt * R2D;

// First time f(t) crosses `level` going in `dir` (+1 rising, -1 falling),
// stepping by stepMs (negative steps search backwards). Returns ms or null.
export function findCrossing(f, level, dir, fromMs, stepMs, maxSteps) {
  let t = fromMs, v = f(t) - level;
  for (let i = 0; i < maxSteps; i++) {
    const t2 = t + stepMs, v2 = f(t2) - level;
    const crossed = dir > 0 ? (v < 0 && v2 >= 0) : (v > 0 && v2 <= 0);
    if (crossed) {
      let lo = t, hi = t2;
      for (let j = 0; j < 22; j++) {
        const mid = (lo + hi) / 2, vm = f(mid) - level;
        const before = (dir > 0 ? vm < 0 : vm > 0);
        if (before) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    t = t2; v = v2;
  }
  return null;
}

// The dark part of the day around `ms`: sunset → sunrise, with twilight bounds
export function nightWindow(obs, ms) {
  const sun = t => altOf('Sun', obs, t);
  let sunset;
  if (sun(ms) > -0.83) sunset = findCrossing(sun, -0.83, -1, ms, 10 * MIN, 150);
  else sunset = findCrossing(sun, -0.83, +1, ms, -10 * MIN, 150); // last sunset (searching back)
  if (sunset == null) return { sunset: null, sunrise: null, start: ms, end: ms + 12 * HOUR, polar: true };
  const sunrise = findCrossing(sun, -0.83, +1, sunset + HOUR, 10 * MIN, 150);
  const darkStart = findCrossing(sun, -18, -1, sunset, 10 * MIN, 90);
  const darkEnd   = darkStart != null ? findCrossing(sun, -18, +1, darkStart, 10 * MIN, 150) : null;
  return { sunset, sunrise, darkStart, darkEnd, start: sunset, end: sunrise || sunset + 12 * HOUR };
}

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export const compass = azRad => COMPASS[Math.round((((azRad * R2D) % 360) + 360) % 360 / 22.5) % 16];

// Altitude track across the window for each body
export function nightTracks(obs, win, names = [...BODIES, 'Moon']) {
  const out = {};
  const n = Math.max(2, Math.ceil((win.end - win.start) / (15 * MIN)));
  for (const name of names) {
    const pts = [];
    let best = { alt: -90, t: win.start };
    for (let i = 0; i <= n; i++) {
      const t = win.start + (win.end - win.start) * i / n;
      const alt = altOf(name, obs, t);
      pts.push([t, alt]);
      if (alt > best.alt) best = { alt, t };
    }
    out[name] = { pts, best };
  }
  return out;
}

// Pairs (incl. Moon) closer than `deg` at the middle of the dark window
export function closeApproaches(obs, win, deg = 6) {
  const mid = (win.start + win.end) / 2;
  const names = [...BODIES, 'Moon'];
  const pos = names.map(n => {
    const p = getAltAz(n, obs, new Date(mid));
    return { n, ra: p.ra, dec: p.dec, alt: p.alt * R2D };
  });
  const out = [];
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    const a = pos[i], b = pos[j];
    if (a.alt < 3 && b.alt < 3) continue;
    const c = Math.sin(a.dec) * Math.sin(b.dec) + Math.cos(a.dec) * Math.cos(b.dec) * Math.cos(a.ra - b.ra);
    const sep = Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
    if (sep < deg) out.push({ a: a.n, b: b.n, sep, t: mid });
  }
  return out.sort((p, q) => p.sep - q.sep);
}

export function moonInfo(ms) {
  const jd = julianDate(new Date(ms));
  return { ...moonPhase(jd), next: nextMoonPhases(jd).map(p => ({ name: p.name, ms: (p.jd - 2440587.5) * 86400000 })) };
}

// Next rise / set of one body from ms, searching up to 30h
export function riseSet(body, obs, ms) {
  const f = t => altOf(body, obs, t);
  const h0 = body === 'Moon' ? 0.1 : (body === 'Sun' ? -0.83 : 0);
  return {
    rise: findCrossing(f, h0, +1, ms, 10 * MIN, 180),
    set:  findCrossing(f, h0, -1, ms, 10 * MIN, 180),
  };
}
