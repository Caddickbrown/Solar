// ---------------------------------------------------------------------------
// astronomy.js — Time, sidereal time, and coordinate transforms
// ---------------------------------------------------------------------------

const TWO_PI  = 2 * Math.PI;
const D2R     = Math.PI / 180;
const R2D     = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

// JS Date → Julian Date (UT)
export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Julian Date → JS Date
export function fromJulianDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

// Julian Date → days since J2000.0
export function daysSinceJ2000(jd) {
  return jd - 2451545.0;
}

// ---------------------------------------------------------------------------
// Greenwich Mean Sidereal Time
// Returns GMST in radians (full precision formula)
// ---------------------------------------------------------------------------
export function gmst(jd) {
  const T = (jd - 2451545.0) / 36525; // Julian centuries from J2000.0
  // GMST in degrees at 0h UT (IAU 1982)
  let gmst_deg = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000;
  return ((gmst_deg * D2R) % TWO_PI + TWO_PI) % TWO_PI;
}

// Local Sidereal Time (radians)
export function lst(jd, lon_rad) {
  return ((gmst(jd) + lon_rad) % TWO_PI + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Hour Angle
// ---------------------------------------------------------------------------
export function hourAngle(lst_rad, ra_rad) {
  return ((lst_rad - ra_rad) % TWO_PI + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Altitude & Azimuth from RA/Dec + observer
//
// observer: { lat, lon } in radians
// Returns: { alt, az } in radians
//   alt: altitude above horizon  [-π/2, π/2]
//   az:  azimuth from North through East  [0, 2π)
// ---------------------------------------------------------------------------
export function altAz(ra_rad, dec_rad, jd, observer) {
  const L = lst(jd, observer.lon);
  const H = hourAngle(L, ra_rad);

  const sin_alt = Math.sin(observer.lat) * Math.sin(dec_rad)
                + Math.cos(observer.lat) * Math.cos(dec_rad) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sin_alt)));

  const cos_az = (Math.sin(dec_rad) - Math.sin(alt) * Math.sin(observer.lat))
               / (Math.cos(alt) * Math.cos(observer.lat));
  let az = Math.acos(Math.max(-1, Math.min(1, cos_az)));
  if (Math.sin(H) > 0) az = TWO_PI - az; // east/west disambiguation

  return { alt, az };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function formatDeg(rad) {
  const d = rad * R2D;
  return d.toFixed(2) + '°';
}

export function formatAz(rad) {
  const d = ((rad * R2D) % 360 + 360) % 360;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(d / 22.5) % 16;
  return `${d.toFixed(1)}° ${dirs[idx]}`;
}

export function formatRA(rad) {
  const h = (rad * 12 / Math.PI + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = Math.floor(((h - hh) * 60 - mm) * 60);
  return `${hh}h ${mm.toString().padStart(2,'0')}m ${ss.toString().padStart(2,'0')}s`;
}

export function formatDec(rad) {
  const d = rad * R2D;
  const sign = d < 0 ? '−' : '+';
  const abs = Math.abs(d);
  const dd = Math.floor(abs);
  const mm = Math.floor((abs - dd) * 60);
  const ss = Math.floor(((abs - dd) * 60 - mm) * 60);
  return `${sign}${dd}° ${mm.toString().padStart(2,'0')}' ${ss.toString().padStart(2,'0')}"`;
}

// Format seconds duration → human readable
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const R2D_EXPORT = R2D;
export const D2R_EXPORT = D2R;
