// ---------------------------------------------------------------------------
// main.js — Solar. Orrery + sky dome + tonight, one clock.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from './assets/OrbitControls.js';
import { PLANETS, PLANET_COLORS, PLANET_RADII, PLANET_NAMES } from './elements.js';
import { heliocentricPosition, eclipticToEquatorial } from './kepler.js';
import { julianDate, daysSinceJ2000, gmst, lst, formatRA, formatDec } from './astronomy.js';
import { getAltAz } from './horizon.js';
import { makePlanet, makeRings, makeSun, makeOrbit, makeStarfield, makeConstellations } from './planets.js';
import { SkyView } from './sky.js';
import { BODIES, nightWindow, nightTracks, closeApproaches, moonInfo, riseSet, compass } from './tonight.js';
import { moonPhase, moonVector, sunVector } from './moon.js';
import { SMALL, SMALL_ORDER, loadSmall, setEarthFn, findPeak, smallPosition, smallMagnitude, orbitSamples } from './smallbodies.js';
import { nextEclipses, localCircumstances, geometry, shadowRadii, obscuration } from './eclipse.js';
import { makeComet } from './planets.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = Math.PI * 2;
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);

// ── state ──────────────────────────────────────────────────────────────────
const saved = (() => { try { return JSON.parse(localStorage.getItem('solar.obs')) || null; } catch { return null; } })();
const state = {
  simTime: q.get('t') ? Date.parse(q.get('t')) : Date.now(),
  playing: q.get('paused') !== '1',
  speedExp: parseInt(q.get('speed') || '0', 10),
  mode: q.get('mode') === 'sky' ? 'sky' : 'system',
  selected: q.get('sel') || 'Saturn',
  obs: saved ? { lat: saved.lat * D2R, lon: saved.lon * D2R, name: saved.name } : { lat: 51.5 * D2R, lon: -0.1 * D2R, name: 'London' },
  showLines: true, showNames: true, faint: false,
};
if (q.get('lat')) state.obs = { lat: parseFloat(q.get('lat')) * D2R, lon: parseFloat(q.get('lon')) * D2R, name: '' };

const SPEED_LABELS = {
  '-7': '100 yr/s back', '-6': '10 yr/s back', '-5': '1 yr/s back', '-4': '1 month/s back', '-3': '1 week/s back',
  '-2': '1 day/s back', '-1': '1 hr/s back', '0': 'Real time', '1': '1 hr/s', '2': '1 day/s', '3': '1 week/s',
  '4': '1 month/s', '5': '1 yr/s', '6': '10 yr/s', '7': '100 yr/s',
};
const SPEED_VALUES = {
  '-7': -3153600000, '-6': -315360000, '-5': -31536000, '-4': -2592000, '-3': -604800, '-2': -86400, '-1': -3600,
  '0': 1, '1': 3600, '2': 86400, '3': 604800, '4': 2592000, '5': 31536000, '6': 315360000, '7': 3153600000,
};

// ── data ───────────────────────────────────────────────────────────────────
const skyData = await (await fetch('./assets/sky.json')).json();
const moonImg = new Image(); moonImg.src = './assets/moon_1024.jpg';
setEarthFn(t => heliocentricPosition(PLANETS.Earth, t));
await loadSmall('./assets/small.json');
for (const k of SMALL_ORDER) if (SMALL[k].kind === 'comet') SMALL[k].peak = findPeak(SMALL[k], 2461338.5);
const SMALL_COLORS = Object.fromEntries(SMALL_ORDER.map(k => [k, SMALL[k].color]));
const isSmall = n => !!SMALL[n];

// ── three.js scene ─────────────────────────────────────────────────────────
const glCanvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x08080a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 3000);
const OVERVIEW = new THREE.Vector3(0, 360, 300);
const narrow = () => innerWidth <= 880;
const sheetPx = () => narrow() ? Math.min(innerHeight * 0.36, 400) + 74 : 0;   // bottom sheet + time bar on phones
function fitView() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 68 : 45;
  const b = sheetPx();
  if (b) camera.setViewOffset(innerWidth, innerHeight, 0, b / 2, innerWidth, innerHeight); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  OVERVIEW.set(0, 360, 300).multiplyScalar(camera.aspect < 1 ? 1.35 : 1);
}
fitView();
camera.position.copy(OVERVIEW);
const controls = new OrbitControls(camera, glCanvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.4; controls.maxDistance = 1000;
controls.zoomSpeed = 0.9;

const stars = makeStarfield(skyData.stars);
const constellations = makeConstellations(skyData.lines);
scene.add(stars, constellations);

const SCALE = 6;
let spaced = localStorage.getItem('solar.scale') !== 'true';
// "Spaced" compresses distance (∝ √AU) so the inner planets aren't a smudge around the Sun.
function eclToScene(p) {
  const v = new THREE.Vector3(p.x, p.z, -p.y);
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  return v.multiplyScalar(spaced ? 27 * Math.sqrt(r) / r : SCALE);
}

const loader = new THREE.TextureLoader();
const sun = makeSun();
sun.scale.setScalar(1.7);
scene.add(sun);

const groups = {}, orbits = {};
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.28, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
// one full revolution through the same Kepler solver the planets use
function orbitPoints(name) {
  const el = PLANETS[name], pts = [];
  for (let i = 0; i <= 360; i++) pts.push(eclToScene(heliocentricPosition({ ...el, M0: (i / 360) * TWO_PI, n: 0 }, 0)));
  return pts;
}
function rebuildOrbits() {
  for (const name of PLANET_NAMES) {
    const a = orbits[name].geometry.getAttribute('position');
    orbitPoints(name).forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
    a.needsUpdate = true;
  }
  for (const k of SMALL_ORDER) {
    const o = smallObjs[k].orbit, pts = orbitSamples(SMALL[k]).map(eclToScene);
    if (SMALL[k].kind === 'dwarf') {
      const a = o.geometry.getAttribute('position');
      pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z)); a.needsUpdate = true;
    } else { o.geometry.setFromPoints(pts); }
  }
}
const SPIN_DAYS = { Mercury: 58.65, Venus: -243.0, Mars: 1.026, Jupiter: 0.4135, Saturn: 0.444, Uranus: -0.718, Neptune: 0.671 };
const DISPLAY_R = {};
for (const name of PLANET_NAMES) {
  const r = PLANET_RADII[name] * 3;
  DISPLAY_R[name] = r;
  const g = makePlanet(name, r, loader);
  scene.add(g);
  groups[name] = g;
  if (name === 'Saturn') g.userData.tilt.add(makeRings(r));
  orbits[name] = makeOrbit(orbitPoints(name), PLANET_COLORS[name]);
  scene.add(orbits[name]);
  // a small fixed-size dot so far-off planets stay findable
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: PLANET_COLORS[name], sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dot.scale.set(0.016, 0.016, 1);
  g.add(dot); g.userData.dot = dot;
}
const MOON_R = 0.3, MOON_DIST = 2.7;
const moonGroup = makePlanet('Moon', MOON_R, loader);
scene.add(moonGroup);
DISPLAY_R.Moon = MOON_R; DISPLAY_R.Sun = 1.5 * 1.7;

// dwarf planets and comets
const smallObjs = {};
for (const k of SMALL_ORDER) {
  const b = SMALL[k];
  if (b.kind === 'dwarf') {
    const r = k === 'Ceres' ? 0.5 : 0.8;
    DISPLAY_R[k] = r;
    const g = makePlanet(k, r, loader);
    scene.add(g);
    const orbit = makeOrbit(orbitSamples(b).map(eclToScene), b.color, 0.05, 0.3);
    scene.add(orbit);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: b.color, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dot.scale.set(0.014, 0.014, 1); g.add(dot); g.userData.dot = dot;
    smallObjs[k] = { group: g, orbit };
  } else {
    DISPLAY_R[k] = 0.7;
    const g = makeComet(b.color);
    scene.add(g);
    const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitSamples(b).map(eclToScene)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(b.color), transparent: true, opacity: 0.28, depthWrite: false }));
    scene.add(orbit);
    smallObjs[k] = { group: g, orbit, comet: true };
  }
}

const sightLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  new THREE.LineDashedMaterial({ color: 0xc8903f, transparent: true, opacity: 0.55, dashSize: 0.8, gapSize: 0.6 }),
);
scene.add(sightLine);

// ── labels over the 3D scene ───────────────────────────────────────────────
const tags = {};
for (const name of [...PLANET_NAMES, 'Moon', 'Sun', ...SMALL_ORDER]) {
  const el = document.createElement('div');
  el.className = 'tag'; el.textContent = SMALL[name] ? SMALL[name].label : name;
  el.addEventListener('click', () => select(name));
  $('tags').appendChild(el);
  tags[name] = el;
}

// ── selection + camera choreography ────────────────────────────────────────
const cam = { follow: null, tween: false, dist: 0, last: new THREE.Vector3(), goal: new THREE.Vector3() };
controls.addEventListener('start', () => { cam.tween = false; });

function worldPos(name) {
  if (SMALL[name]) return smallObjs[name].group.position.clone();
  if (name === 'Sun') return new THREE.Vector3();
  if (name === 'Moon') return moonGroup.position.clone();
  return groups[name].position.clone();
}
function followDistance(name) {
  const r = DISPLAY_R[name] || 0.4;
  if (name === 'Sun') return 16;
  if (name === 'Moon') return 2.2;
  if (name === 'Earth') return r * 10;
  if (SMALL[name]) return SMALL[name].kind === 'comet' ? 16 : Math.max(r * 6, 3);
  if (name === 'Saturn') return r * 9;
  return Math.max(r * 6, 3);
}
function flyTo(name) {
  cam.follow = name; cam.tween = true;
  cam.dist = followDistance(name);
  cam.last.copy(worldPos(name));
}
function overview() {
  cam.follow = null; cam.tween = true; cam.dist = 0;
}

// ── sky view ───────────────────────────────────────────────────────────────
const sky = new SkyView($('sky'), skyData, { onSelect: n => select(n), moonImg });
let skyGoal = null;

function select(name) {
  state.selected = name;
  if (state.mode === 'system') flyTo(name);
  else {
    const b = getAltAz(name, state.obs, new Date(state.simTime));
    skyGoal = { az: b.az, alt: Math.max(b.alt, 5 * D2R) };
  }
  buildDetail(true);
  for (const b of document.querySelectorAll('.bodies button')) b.setAttribute('aria-pressed', b.dataset.name === name);
  for (const [n, el] of Object.entries(tags)) el.classList.toggle('sel', n === name);
}

// ── formatting helpers ─────────────────────────────────────────────────────
const tz = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' });
const tzName = d => (tz.formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || '';
const jdMs = jd => (jd - 2440587.5) * 86400000;
const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayShort = ms => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const whenText = (ms, ref) => {
  if (sameDay(ms, ref)) return hhmm(ms);
  if (sameDay(ms, ref + 864e5)) return `${hhmm(ms)} tomorrow`;
  return `${hhmm(ms)} ${dayShort(ms)}`;
};
const fmtLat = r => `${Math.abs(r * R2D).toFixed(2)}° ${r >= 0 ? 'N' : 'S'}`;
const fmtLon = r => `${Math.abs(r * R2D).toFixed(2)}° ${r >= 0 ? 'E' : 'W'}`;

// ── tonight cache ──────────────────────────────────────────────────────────
let night = null;
function ensureNight() {
  const key = `${state.obs.lat}|${state.obs.lon}`;
  if (night && night.key === key && Math.abs(state.simTime - night.at) < 3 * 3600e3 && state.simTime <= night.win.end) return night;
  const win = nightWindow(state.obs, state.simTime);
  night = {
    key, at: state.simTime, win,
    tracks: nightTracks(state.obs, win),
    approach: closeApproaches(state.obs, win),
    moon: moonInfo(state.simTime),
    rs: {}, rsAt: {},
  };
  return night;
}
function rs(name) {
  const n = ensureNight();
  if (!n.rs[name] || Math.abs(state.simTime - n.rsAt[name]) > 20 * 60e3) {
    n.rs[name] = riseSet(name, state.obs, state.simTime);
    n.rsAt[name] = state.simTime;
  }
  return n.rs[name];
}

// ── DOM: body list ─────────────────────────────────────────────────────────
const list = $('bodies');
for (const name of BODIES) {
  const li = document.createElement('li');
  li.innerHTML = `<button data-name="${name}" aria-pressed="false"><span class="dot" style="background:${PLANET_COLORS[name]}"></span><span class="nm">${name}</span><span class="st">—</span></button>`;
  li.firstChild.addEventListener('click', () => select(name));
  list.appendChild(li);
}
const smallList = $('smallBodies');
for (const k of SMALL_ORDER) {
  const b = SMALL[k], li = document.createElement('li');
  li.innerHTML = `<button data-name="${k}" aria-pressed="false"><span class="dot" style="background:${b.color}"></span><span class="nm">${b.label}</span><span class="st">—</span></button>`;
  li.firstChild.addEventListener('click', () => select(k));
  smallList.appendChild(li);
}
$('moonBlock').addEventListener('click', e => { if (!e.target.closest('.jump')) select('Moon'); });
$('moonBlock').addEventListener('keydown', e => { if (e.key === 'Enter') select('Moon'); });

// ── DOM: tonight ───────────────────────────────────────────────────────────
function updateTonight() {
  const n = ensureNight(), w = n.win, now = state.simTime;
  let s;
  if (w.polar) s = 'The Sun does not set from here at this time of year.';
  else {
    s = `Sun ${w.sunset <= now ? 'set' : 'sets'} at <em>${hhmm(w.sunset)}</em>. `;
    s += w.darkStart != null
      ? `Fully dark from <em>${hhmm(w.darkStart)}</em> until <em>${hhmm(w.darkEnd)}</em>; sunrise at <em>${hhmm(w.sunrise)}</em>.`
      : `The sky never gets fully dark tonight; sunrise at <em>${hhmm(w.sunrise)}</em>.`;
  }
  // highest placed during the dark hours
  const lo = w.darkStart != null ? w.darkStart : w.start, hi = w.darkEnd != null ? w.darkEnd : w.end;
  const best = BODIES.map(name => {
    let b = { alt: -90, t: 0 };
    for (const [t, alt] of n.tracks[name].pts) if (t >= lo && t <= hi && alt > b.alt) b = { alt, t };
    return { name, ...b };
  }).filter(b => b.alt > 15).sort((a, b) => b.alt - a.alt).slice(0, 3);
  if (best.length) s += ` Best placed: ${best.map(b => `${b.name} <em>${Math.round(b.alt)}°</em> at ${hhmm(b.t)}`).join(', ')}.`;
  else s += ' No planet climbs high in the dark tonight.';
  $('nightLede').innerHTML = s;

  // moon
  const mp = moonPhase(julianDate(new Date(now)));
  $('moonName').textContent = mp.name;
  const mrs = rs('Moon');
  const evs = [];
  if (mrs.rise) evs.push(['rises', mrs.rise]);
  if (mrs.set) evs.push(['sets', mrs.set]);
  evs.sort((a, b) => a[1] - b[1]);
  $('moonLine').textContent = `${Math.round(mp.k * 100)}% lit` + (evs.length ? ' · ' + evs.map(([v, t]) => `${v} ${whenText(t, now)}`).join(' · ') : '');
  const short = { 'New moon': 'New', 'First quarter': 'First quarter', 'Full moon': 'Full', 'Last quarter': 'Last quarter' };
  $('moonNext').innerHTML = n.moon.next.slice(0, 2).map(p => `<span class="jump" data-ms="${p.ms}">${short[p.name]} ${new Date(p.ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>`).join(' · ');
  for (const el of $('moonNext').querySelectorAll('.jump')) el.onclick = e => { e.stopPropagation(); jumpTo(+el.dataset.ms); };
  drawGlyph(mp);

  // planets list
  for (const name of BODIES) {
    const a = getAltAz(name, state.obs, new Date(now));
    const st = list.querySelector(`[data-name="${name}"] .st`);
    if (a.alt > 0) { st.textContent = `${Math.round(a.alt * R2D)}° ${compass(a.az)}`; st.className = 'st up'; }
    else {
      const r = rs(name).rise;
      st.textContent = r ? `rises ${whenText(r, now)}` : 'below horizon';
      st.className = 'st';
    }
  }

  // dwarf planets and comets
  for (const k of SMALL_ORDER) {
    const b = SMALL[k], st = smallList.querySelector(`[data-name="${k}"] .st`);
    const jd = julianDate(new Date(now)), m = smallMagnitude(b, jd - 2451545.0);
    const a = getAltAz(k, state.obs, new Date(now));
    if (b.kind === 'comet' && m > 15) {
      st.textContent = b.peak && b.peak.m < 14 ? `peaks mag ${b.peak.m.toFixed(1)} · ${new Date(jdMs(b.peak.jd)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : 'too faint';
      st.className = 'st';
    } else {
      st.textContent = `mag ${m.toFixed(1)}` + (a.alt > 0 ? ` · ${Math.round(a.alt * R2D)}° ${compass(a.az)}` : '');
      st.className = 'st' + (a.alt > 0 && m < 10 ? ' up' : '');
    }
  }
  updateEclipses();

  // close approaches
  $('approach').textContent = n.approach.length
    ? n.approach.slice(0, 2).map(c => `${c.a} and ${c.b} are ${c.sep.toFixed(1)}° apart tonight.`).join(' ')
    : '';
  drawChart();
}

let ecl = null, eclRendered = null;
function ensureEclipses() {
  const key = `${state.obs.lat}|${state.obs.lon}`;
  const fast = state.playing && Math.abs(SPEED_VALUES[state.speedExp]) > 86400 * 20;
  if (ecl && ecl.key === key && (fast || Math.abs(state.simTime - ecl.at) < 10 * 86400e3)) return ecl;
  const evs = nextEclipses(state.simTime, 4).map(e => ({ ...e, local: localCircumstances(e, state.obs) }));
  ecl = { key, at: state.simTime, evs };
  return ecl;
}
function eclipseNote(e) {
  const l = e.local;
  if (e.kind === 'solar') {
    if (!l.visible) return 'Not visible from here';
    return l.total ? `Total here, at ${hhmm(l.ms)}` : `${Math.round(l.obsc * 100)}% covered here at ${hhmm(l.ms)}`;
  }
  return l.visible ? `Moon is up, ${Math.round(l.alt * R2D)}° at ${hhmm(e.ms)}` : 'Moon is below the horizon here';
}
function updateEclipses() {
  const E = ensureEclipses();
  if (eclRendered !== E) {
    eclRendered = E;
    const ul = $('eclipses'); ul.innerHTML = '';
    E.evs.forEach(e => {
      const li = document.createElement('li');
      const day = new Date(e.ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      li.innerHTML = `<button class="ecl"><span class="nm">${e.type} ${e.kind}</span><span class="st">${day}</span><span class="note${(e.local.visible ? ' up' : '')}">${eclipseNote(e)}</span></button>`;
      li.firstChild.onclick = () => jumpEclipse(e);
      ul.appendChild(li);
    });
  }
}
function jumpEclipse(e) {
  jumpTo(e.kind === 'solar' && e.local.visible ? e.local.ms : e.ms);
  setMode('sky');
  select(e.kind === 'solar' ? 'Sun' : 'Moon');
  sky.fov = e.kind === 'solar' ? 7 : 6;
}

function jumpTo(ms) {
  state.simTime = ms; night = null;
  state.speedExp = 0; $('speed').value = '0'; $('speedText').textContent = 'Real time';
  state.playing = false; $('btnPlay').textContent = 'Play';
  syncLive();
}

// moon phase glyph
function drawGlyph(mp) {
  const c = $('moonGlyph'), g = c.getContext('2d'), W = c.width, r = W / 2 - 4, cx = W / 2, cy = W / 2;
  g.clearRect(0, 0, W, W);
  g.fillStyle = '#1a1813'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.strokeStyle = 'rgba(232,225,210,.18)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  const ang = mp.waxing ? 0 : Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), t = 1 - 2 * mp.k;
  const rot = (x, y) => [cx + x * ca - y * sa, cy + x * sa + y * ca];
  g.save(); g.beginPath();
  const N = 48;
  for (let i = 0; i <= N; i++) { const p = -Math.PI / 2 + Math.PI * i / N, v = rot(r * Math.cos(p), r * Math.sin(p)); i ? g.lineTo(...v) : g.moveTo(...v); }
  for (let i = N; i >= 0; i--) { const p = -Math.PI / 2 + Math.PI * i / N, v = rot(r * t * Math.cos(p), r * Math.sin(p)); g.lineTo(...v); }
  g.closePath(); g.clip();
  g.fillStyle = '#e8e1d2'; g.fillRect(0, 0, W, W);
  if (moonImg.complete && moonImg.naturalWidth) {
    g.globalCompositeOperation = 'multiply';
    const sh = moonImg.naturalHeight;
    g.drawImage(moonImg, (moonImg.naturalWidth - sh) / 2, 0, sh, sh, cx - r, cy - r, 2 * r, 2 * r);
  }
  g.restore();
}
moonImg.addEventListener('load', () => drawGlyph(moonPhase(julianDate(new Date(state.simTime)))));

// the night chart: altitude against time, sunset → sunrise
function drawChart() {
  const n = ensureNight(), w = n.win, cv = $('nightChart'), g = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2), W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = 0, R = W, T = 8, B = H - 20, span = w.end - w.start || 1;
  const X = t => L + (R - L) * (t - w.start) / span, Y = a => B - (B - T) * Math.max(a, 0) / 90;
  if (w.darkStart != null) {
    g.fillStyle = 'rgba(232,225,210,0.05)';
    g.fillRect(X(w.darkStart), T, X(w.darkEnd) - X(w.darkStart), B - T);
  }
  g.strokeStyle = 'rgba(232,225,210,0.16)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, B + .5); g.lineTo(R, B + .5); g.stroke();
  g.strokeStyle = 'rgba(232,225,210,0.07)';
  g.beginPath(); g.moveTo(L, Y(45) + .5); g.lineTo(R, Y(45) + .5); g.stroke();
  g.font = '300 10.5px Outfit, sans-serif'; g.fillStyle = 'rgba(232,225,210,0.4)'; g.textBaseline = 'alphabetic';
  g.textAlign = 'left'; g.fillText('45°', L + 2, Y(45) - 4);
  g.textAlign = 'center';
  for (let t = Math.ceil(w.start / 3600e3) * 3600e3; t <= w.end; t += 3600e3) {
    const h = new Date(t).getHours();
    if (h % 3) continue;
    g.fillText(String(h).padStart(2, '0'), X(t), H - 5);
    g.fillRect(X(t), B, 1, 3);
  }
  // curves (selected drawn last, on top)
  const names = [...BODIES, 'Moon'].filter(n => n3(n) > 0).sort((a, b) => (a === state.selected) - (b === state.selected));
  function n3(n) { return night.tracks[n].best.alt; }
  const placed = [];
  const labelRect = (txt, x, y) => ({ x0: x - g.measureText(txt).width / 2 - 2, x1: x + g.measureText(txt).width / 2 + 2, y0: y - 11, y1: y + 2 });
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  for (const name of names) {
    const tr = n.tracks[name];
    const sel = state.selected === name;
    g.strokeStyle = PLANET_COLORS[name]; g.globalAlpha = sel ? 1 : 0.62; g.lineWidth = sel ? 2 : 1.2;
    g.beginPath(); let pen = false;
    for (const [t, a] of tr.pts) {
      if (a < 0) { pen = false; continue; }
      if (pen) g.lineTo(X(t), Y(a)); else { g.moveTo(X(t), Y(a)); pen = true; }
    }
    g.stroke(); g.globalAlpha = 1;
  }
  // labels: highest peaks first, skip any that would sit on another label
  g.textAlign = 'center';
  const byPeak = names.slice().sort((a, b) => (b === state.selected) - (a === state.selected) || n.tracks[b].best.alt - n.tracks[a].best.alt);
  for (const name of byPeak) {
    const tr = n.tracks[name], sel = state.selected === name;
    if (tr.best.alt < 10 && !sel) continue;
    g.font = `${sel ? '500 ' : '400 '}italic 12px Newsreader, serif`;
    const lx = Math.min(Math.max(X(tr.best.t), 26), W - 26), ly = Math.max(Y(tr.best.alt) - 6, 12);
    const r = labelRect(name, lx, ly);
    if (!sel && placed.some(p => hit(p, r))) continue;
    placed.push(r);
    g.fillStyle = sel ? '#f4eee0' : PLANET_COLORS[name];
    g.fillText(name, lx, ly);
  }
  // now
  if (state.simTime >= w.start && state.simTime <= w.end) {
    g.strokeStyle = '#c8903f'; g.lineWidth = 1;
    const x = Math.round(X(state.simTime)) + .5;
    g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke();
  }
}

// instantaneous eclipse state for the observer
const sepRaDec = (m, s) => Math.acos(Math.max(-1, Math.min(1, Math.sin(m.dec) * Math.sin(s.dec) + Math.cos(m.dec) * Math.cos(s.dec) * Math.cos(m.ra - s.ra))));
function eclipseNow(moonB, sunB) {
  const date = new Date(state.simTime), jd = julianDate(date);
  const g = geometry(jd);
  const out = { obsc: 0, lunar: null, g };
  if (g.sepSun < 0.06 || g.sepAnti < 0.06) {
    const m = moonB || getAltAz('Moon', state.obs, date), sn = sunB || getAltAz('Sun', state.obs, date);
    if (g.sepSun < 0.06) out.obsc = obscuration(sepRaDec(m, sn), g.sunSD, g.moonSD).obsc;
    if (g.sepAnti < 0.06) {
      const { umbra, penumbra } = shadowRadii(g);
      out.lunar = { umbra, penumbra, mag: (umbra + g.moonSD - g.sepAnti) / (2 * g.moonSD), pen: (penumbra + g.moonSD - g.sepAnti) / (2 * g.moonSD) };
    }
  }
  return out;
}

// ── DOM: selected body detail ──────────────────────────────────────────────
function bodyInfo(name) {
  const date = new Date(state.simTime);
  const a = getAltAz(name, state.obs, date);
  const sunA = getAltAz('Sun', state.obs, date);
  const sep = Math.acos(Math.max(-1, Math.min(1, Math.sin(a.dec) * Math.sin(sunA.dec) + Math.cos(a.dec) * Math.cos(sunA.dec) * Math.cos(a.ra - sunA.ra))));
  return { a, sep };
}
const dd = (k, v, cls = '') => `<div class="r"><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`;
function lightTime(au) {
  const min = au * 8.3167;
  return min < 90 ? `${min.toFixed(min < 10 ? 1 : 0)} light-min` : `${(min / 60).toFixed(1)} light-hr`;
}
function hms(rad) {
  const h = ((rad * 12 / Math.PI) % 24 + 24) % 24, hh = Math.floor(h), m = Math.floor((h - hh) * 60), sc = Math.floor(((h - hh) * 60 - m) * 60);
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
}
function buildEarth() {
  const now = state.simTime, date = new Date(now), jd = julianDate(date), o = state.obs;
  $('dName').textContent = 'Earth';
  $('dKind').textContent = 'Planet';
  $('dSentence').textContent = `You are here${o.name ? ': ' + o.name : ''}, ${fmtLat(o.lat)}, ${fmtLon(o.lon)}.`;
  const h = heliocentricPosition(PLANETS.Earth, daysSinceJ2000(jd));
  const sunA = getAltAz('Sun', o, date);
  const moonA = getAltAz('Moon', o, date);
  $('dRows').innerHTML = [
    dd('From the Sun', `${Math.hypot(h.x, h.y, h.z).toFixed(4)} AU`),
    dd('Sun altitude', `${(sunA.alt * R2D).toFixed(1)}°`, sunA.alt > 0 ? 'up' : ''),
    dd('Local sidereal time', hms(lst(jd, o.lon))),
    dd('Greenwich sidereal', hms(gmst(jd))),
    dd('Axial tilt', '23.44°'),
    dd('Moon', `${Math.round(moonA.r * 149597870.7).toLocaleString('en-GB')} km`),
    dd('Orbital period', '365.26 days'),
  ].join('');
}
function buildDetail(force) {
  const name = state.selected, now = state.simTime;
  if (name === 'Earth') return buildEarth();
  const { a, sep } = bodyInfo(name);
  const up = a.alt > 0, altD = a.alt * R2D;
  const sb = SMALL[name];
  $('dName').textContent = sb ? sb.label : name;
  $('dName').classList.toggle('long', (sb ? sb.label : name).length > 11);
  $('dKind').textContent = name === 'Sun' ? 'The Sun' : name === 'Moon' ? 'The Moon' : sb ? (sb.kind === 'comet' ? 'Comet' : 'Dwarf planet') : 'Planet';
  $('btnPeak').hidden = !(sb && sb.kind === 'comet');
  const r = rs(name);
  let sentence;
  if (up) sentence = `Above the horizon, ${Math.round(altD)}° up in the ${compass(a.az)}.`;
  else if (r.rise) {
    const az = getAltAz(name, state.obs, new Date(r.rise)).az;
    sentence = `Below the horizon. Rises at ${whenText(r.rise, now)} in the ${compass(az)}.`;
  } else sentence = 'Below the horizon.';
  const ec = eclipseNow();
  if (name === 'Sun' && ec.obsc > 0.001) sentence = ec.obsc > 0.999 ? 'In total eclipse. The Moon covers the whole disc.' : `Partly eclipsed: the Moon covers ${Math.round(ec.obsc * 100)}% of the disc.`;
  if (name === 'Moon' && ec.lunar && ec.lunar.mag > 0) sentence = ec.lunar.mag >= 1 ? 'In total eclipse, inside the Earth\'s shadow.' : `Partly in the Earth\'s shadow (${Math.round(ec.lunar.mag * 100)}% of the disc).`;
  let m = null;
  if (sb) {
    m = smallMagnitude(sb, daysSinceJ2000(julianDate(new Date(now))));
    sentence += m < 6 ? ' Visible to the naked eye.' : m < 10 ? ' Needs binoculars.' : ' Needs a telescope.';
  }
  $('dSentence').textContent = sentence;
  const rows = [
    ...(sb ? [dd('Magnitude', `${m.toFixed(1)} (predicted)`)] : []),
    dd('Altitude', `${altD.toFixed(1)}°`, up ? 'up' : ''),
    dd('Azimuth', `${((a.az * R2D) % 360).toFixed(1)}° ${compass(a.az)}`),
    dd('Right ascension', formatRA(a.ra)),
    dd('Declination', formatDec(a.dec)),
  ];
  if (name === 'Moon') rows.push(dd('Distance', `${Math.round(a.r * 149597870.7).toLocaleString('en-GB')} km`));
  else rows.push(dd('From Earth', `${a.r.toFixed(3)} AU · ${lightTime(a.r)}`));
  if (name !== 'Sun' && name !== 'Moon') {
    const tt = daysSinceJ2000(julianDate(new Date(now)));
    const h = sb ? smallPosition(sb, tt) : heliocentricPosition(PLANETS[name], tt);
    rows.push(dd('From the Sun', `${Math.hypot(h.x, h.y, h.z).toFixed(3)} AU`));
  }
  if (name !== 'Sun') rows.push(dd('Elongation', `${(sep * R2D).toFixed(1)}° from the Sun`));
  if (sb && sb.kind === 'comet') {
    rows.push(dd('Perihelion', `${new Date(jdMs(sb.orb.tp)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${sb.orb.q.toFixed(2)} AU`));
    if (sb.peak && sb.peak.m < 20) rows.push(dd('Brightest', `mag ${sb.peak.m.toFixed(1)} · ${new Date(jdMs(sb.peak.jd)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`));
  }
  if (name === 'Sun' && ec.obsc > 0.001) rows.push(dd('Covered', `${(ec.obsc * 100).toFixed(1)}%`));
  rows.push(dd('Rises', r.rise ? whenText(r.rise, now) : '—'), dd('Sets', r.set ? whenText(r.set, now) : '—'));
  $('dRows').innerHTML = rows.join('');
}

// ── DOM: wiring ────────────────────────────────────────────────────────────
function setMode(m) {
  state.mode = m;
  $('gl').hidden = m !== 'system'; $('sky').hidden = m !== 'sky'; $('tags').hidden = m !== 'system';
  $('skyToggles').hidden = m !== 'sky'; $('btnScale').hidden = m !== 'system'; constellations.visible = false;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', b.dataset.mode === m);
  $('btnFocus').textContent = m === 'system' ? 'Follow' : 'Centre';
  $('btnOverview').textContent = m === 'system' ? 'Overview' : 'Reset view';
  history.replaceState(null, '', (m === 'sky' ? '?mode=sky' : location.pathname) + location.hash);
  if (m === 'sky') select(state.selected);
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
$('btnFocus').onclick = () => select(state.selected);
$('btnPeak').onclick = () => { const b = SMALL[state.selected]; if (b && b.peak) jumpTo(jdMs(b.peak.jd)); };
$('btnOverview').onclick = () => { if (state.mode === 'system') overview(); else { sky.reset(); skyGoal = null; } };
$('tgLines').onchange = e => { state.showLines = e.target.checked; };
$('tgNames').onchange = e => { state.showNames = e.target.checked; };
$('tgFaint').onchange = e => { state.faint = e.target.checked; };

$('speed').value = String(state.speedExp);
$('speedText').textContent = SPEED_LABELS[state.speedExp];
$('speed').oninput = e => {
  state.speedExp = parseInt(e.target.value, 10);
  $('speedText').textContent = SPEED_LABELS[state.speedExp];
  night = null; syncLive();
};
$('btnPlay').textContent = state.playing ? 'Pause' : 'Play';
$('btnPlay').onclick = () => { state.playing = !state.playing; $('btnPlay').textContent = state.playing ? 'Pause' : 'Play'; syncLive(); };
$('btnNow').onclick = () => {
  state.simTime = Date.now(); state.speedExp = 0; state.playing = true; night = null;
  $('speed').value = '0'; $('speedText').textContent = 'Real time'; $('btnPlay').textContent = 'Pause'; syncLive();
};
$('when').onclick = () => { const j = $('jump'); const d = new Date(state.simTime - new Date().getTimezoneOffset() * 60000); j.value = d.toISOString().slice(0, 16); j.showPicker ? j.showPicker() : j.focus(); };
$('jump').onchange = e => { if (e.target.value) jumpTo(new Date(e.target.value).getTime()); };
function syncLive() {
  const live = state.playing && state.speedExp === 0 && Math.abs(state.simTime - Date.now()) < 5000;
  const el = $('liveState');
  el.textContent = live ? 'Live' : state.playing ? 'Not now' : 'Paused';
  el.classList.toggle('off', !live);
}

$('btnScale').textContent = spaced ? 'Spaced scale' : 'True scale';
$('btnScale').onclick = () => {
  spaced = !spaced; localStorage.setItem('solar.scale', String(!spaced));
  $('btnScale').textContent = spaced ? 'Spaced scale' : 'True scale';
  rebuildOrbits();
  if (cam.follow === null) cam.tween = true;
};

// place
function updatePlace() {
  const o = state.obs;
  $('placeText').textContent = `${o.name ? o.name + ' · ' : ''}${fmtLat(o.lat)}, ${fmtLon(o.lon)}`;
}
$('place').onclick = () => {
  const f = $('placeEdit'); f.hidden = !f.hidden; $('place').setAttribute('aria-expanded', !f.hidden);
  $('inLat').value = (state.obs.lat * R2D).toFixed(2); $('inLon').value = (state.obs.lon * R2D).toFixed(2);
};
$('placeEdit').onsubmit = e => {
  e.preventDefault();
  const lat = parseFloat($('inLat').value), lon = parseFloat($('inLon').value);
  if (isNaN(lat) || isNaN(lon)) return;
  state.obs = { lat: lat * D2R, lon: lon * D2R, name: Math.abs(lat - 51.5) < .01 && Math.abs(lon + .1) < .01 ? 'London' : '' };
  localStorage.setItem('solar.obs', JSON.stringify({ lat, lon, name: state.obs.name }));
  night = null; updatePlace(); $('placeEdit').hidden = true; $('place').setAttribute('aria-expanded', false);
  updateText();
};

// ── 3D update ──────────────────────────────────────────────────────────────
const ez = new THREE.Vector3();
function updateScene(jd, t, dt) {
  const gm = gmst(jd);
  for (const name of PLANET_NAMES) {
    const el = PLANETS[name];
    const p = eclToScene(heliocentricPosition(el, t));
    const g = groups[name];
    g.position.copy(p);
    const dist = camera.position.distanceTo(p);
    g.userData.dot.material.opacity = Math.min(Math.max((dist / DISPLAY_R[name] - 60) / 130, 0), 1);
    g.userData.mesh.rotation.y = name === 'Earth' ? gm : (jd * TWO_PI / SPIN_DAYS[name]) % TWO_PI;
    const M = (((el.M0 + el.n * t) % TWO_PI) + TWO_PI) % TWO_PI;
    orbits[name].material.uniforms.uHead.value = M / TWO_PI;
    orbits[name].material.uniforms.uBoost.value = name === state.selected ? 1 : 0;
  }
  // dwarf planets & comets
  const px = renderer.domElement.height / (2 * Math.tan(camera.fov * D2R / 2));
  for (const k of SMALL_ORDER) {
    const b = SMALL[k], o = smallObjs[k], p = smallPosition(b, t);
    const pos = eclToScene(p), r = Math.hypot(p.x, p.y, p.z), mag = smallMagnitude(b, t);
    o.mag = mag; o.r = r;
    o.group.position.copy(pos);
    if (!o.comet) {
      const d = camera.position.distanceTo(pos);
      o.group.userData.dot.material.opacity = Math.min(Math.max((d / DISPLAY_R[k] - 60) / 130, 0), 1);
      o.group.userData.mesh.rotation.y = (jd * TWO_PI / 0.9) % TWO_PI;
      o.orbit.material.uniforms.uHead.value = (((b.el.M0 + b.el.n * t) % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI;
      o.orbit.material.uniforms.uBoost.value = k === state.selected ? 1 : 0;
      o.shown = true;
    } else {
      const show = mag < 16 || k === state.selected;
      o.shown = show;
      o.group.visible = show; o.orbit.visible = show;
      const away = pos.clone().normalize();      // away from the Sun (at the origin)
      const len = 45 * Math.min(Math.max((3.2 - r) / 2.6, 0), 1) + 2;
      const bright = Math.min(Math.max((3.4 - r) / 2.2, 0.05), 1);
      o.group.userData.update(away, len, bright, px);
      o.group.userData.head.scale.setScalar(0.6 + 1.2 * bright);
    }
  }
  // Moon: real direction from Earth, pulled in close and enlarged for the picture
  const mv = moonDirection(jd);
  moonGroup.position.copy(groups.Earth.position).addScaledVector(mv, MOON_DIST);
  moonGroup.lookAt(groups.Earth.position); moonGroup.rotateY(-Math.PI / 2);
  sun.userData.body.material.uniforms.uTime.value = performance.now() / 1000;
  // sight line Earth → selected
  const sel = state.selected;
  if (sel !== 'Earth') {
    const a = groups.Earth.position, b = worldPos(sel);
    sightLine.geometry.setFromPoints([a, b]); sightLine.computeLineDistances();
    sightLine.visible = true;
  } else sightLine.visible = false;
  stars.position.copy(camera.position); constellations.position.copy(camera.position);
}

function moonDirection(jd) {
  const v = moonVector(jd);
  return new THREE.Vector3(v.x, v.z, -v.y).normalize();
}

function updateCamera(dt) {
  if (cam.follow) {
    const p = worldPos(cam.follow);
    const delta = p.clone().sub(cam.last);
    cam.last.copy(p);
    controls.target.add(delta); camera.position.add(delta);
    if (cam.tween) {
      const k = 1 - Math.exp(-dt * 3.2);
      const toT = p.clone().sub(controls.target).multiplyScalar(k);
      controls.target.add(toT); camera.position.add(toT);
      const off = camera.position.clone().sub(controls.target);
      const len = off.length(), nl = len + (cam.dist - len) * k;
      off.setLength(nl); camera.position.copy(controls.target).add(off);
      if (Math.abs(nl - cam.dist) < 0.02 * cam.dist && toT.length() < 0.01) cam.tween = false;
    }
  } else if (cam.tween) {
    const k = 1 - Math.exp(-dt * 2.6);
    const toT = controls.target.clone().multiplyScalar(-k);
    controls.target.add(toT); camera.position.add(toT);
    const off = camera.position.clone().sub(controls.target);
    const goal = OVERVIEW.clone();
    off.lerp(goal, k);
    camera.position.copy(controls.target).add(off);
    if (off.distanceTo(goal) < 1 && controls.target.length() < 0.05) cam.tween = false;
  }
  controls.update();
}

const proj = new THREE.Vector3();
const colorOf = n => PLANET_COLORS[n] || SMALL_COLORS[n] || '#e8e1d2';
const TAG_PRIORITY = ['Sun', 'Earth', 'Jupiter', 'Saturn', 'Moon', 'Mars', 'Venus', 'Mercury', 'Uranus', 'Neptune', ...SMALL_ORDER];
function updateTags() {
  const W = innerWidth, H = innerHeight;
  const earthDist = camera.position.distanceTo(groups.Earth.position);
  const order = [state.selected, ...TAG_PRIORITY.filter(n => n !== state.selected)];
  const placed = [];
  for (const name of order) {
    const el = tags[name];
    const p = worldPos(name);
    proj.copy(p).project(camera);
    let show = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
    if (smallObjs[name] && !smallObjs[name].shown) show = false;
    if (name === 'Moon' && earthDist > 30) show = false;
    const sx = (proj.x + 1) / 2 * W;
    if (show && W > 880 && (sx < 36 + 316 + 6 || sx > W - 36 - 296 - 60)) show = false;
    let x = 0, y = 0;
    if (show) {
      // nudge label right of the disc
      const r = DISPLAY_R[name] || 0.4;
      const edge = p.clone().add(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(r)).project(camera);
      const rpx = (edge.x - proj.x) * W / 2;
      if (name === state.selected && rpx > 70) { el.style.display = 'none'; continue; }   // close up: the panel names it
      x = sx + Math.max(rpx, 5); y = (1 - proj.y) / 2 * H - 8;
      const rect = { x0: x - 4, x1: x + name.length * 8 + 14, y0: y - 2, y1: y + 18 };
      if (placed.some(q => rect.x0 < q.x1 && rect.x1 > q.x0 && rect.y0 < q.y1 && rect.y1 > q.y0)) show = false;
      else placed.push(rect);
    }
    el.style.display = show ? '' : 'none';
    if (show) el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

// click-to-select spheres
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
glCanvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
glCanvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = [];
  for (const [n, g] of Object.entries(groups)) objs.push(g.userData.mesh);
  objs.push(moonGroup.userData.mesh, sun.userData.body);
  // generous hit radius for small distant planets: choose nearest by screen distance
  let best = null, bd = 28;
  for (const name of [...PLANET_NAMES, 'Moon', 'Sun', ...SMALL_ORDER]) {
    if (smallObjs[name] && !smallObjs[name].shown) continue;
    const v = worldPos(name).project(camera);
    if (v.z > 1) continue;
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    const d = Math.hypot(sx - e.clientX, sy - e.clientY);
    if (d < bd) { bd = d; best = name; }
  }
  if (best) select(best);
});

// ── text UI refresh ────────────────────────────────────────────────────────
function updateText() {
  const d = new Date(state.simTime);
  $('dateLine').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('clock').textContent = `${d.toLocaleTimeString('en-GB')} ${tzName(d)}`;
  updateTonight();
  buildDetail();
  syncLive();
}

// ── resize ─────────────────────────────────────────────────────────────────
addEventListener('resize', () => {
  fitView();
  renderer.setSize(innerWidth, innerHeight, false);
});

// ── loop ───────────────────────────────────────────────────────────────────
let last = performance.now(), textT = 1;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (state.playing) state.simTime += SPEED_VALUES[state.speedExp] * dt * 1000;
  const date = new Date(state.simTime), jd = julianDate(date), t = daysSinceJ2000(jd);

  if (state.mode === 'system') {
    updateScene(jd, t, dt);
    updateCamera(dt);
    updateTags();
    renderer.render(scene, camera);
  } else {
    if (skyGoal) {
      let da = skyGoal.az - sky.az0; da = ((da + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
      const k = 1 - Math.exp(-dt * 6);
      sky.az0 += da * k; sky.alt0 += (skyGoal.alt - sky.alt0) * k;
      if (Math.abs(da) < 0.002 && Math.abs(skyGoal.alt - sky.alt0) < 0.002) skyGoal = null;
    }
    const bodies = {};
    for (const n of ['Sun', 'Moon', ...BODIES]) bodies[n] = getAltAz(n, state.obs, date);
    const small = [];
    for (const k of SMALL_ORDER) {
      const a = getAltAz(k, state.obs, date), m = smallMagnitude(SMALL[k], t);
      if (m <= (state.faint ? 19 : 10.5) || k === state.selected) small.push({ name: k, label: SMALL[k].label, kind: SMALL[k].kind, mag: m, alt: a.alt, az: a.az, color: SMALL[k].color });
    }
    const ec = eclipseNow(bodies.Moon, bodies.Sun);
    let lunar = null;
    if (ec.lunar) {
      // shadow centre = Moon position shifted by (anti-Sun − geocentric Moon), so parallax cancels
      const mv = moonVector(jd), sv = sunVector(jd), ml = Math.hypot(mv.x, mv.y, mv.z), sl = Math.hypot(sv.x, sv.y, sv.z);
      const d = eclipticToEquatorial({ x: -sv.x / sl - mv.x / ml, y: -sv.y / sl - mv.y / ml, z: -sv.z / sl - mv.z / ml });
      lunar = { ...ec.lunar, dEq: [d.x, d.y, d.z] };
    }
    sky.draw({
      jd, obs: state.obs, bodies, moon: moonPhase(jd), colors: PLANET_COLORS, small, lunar, solarObsc: ec.obsc,
      sizes: { sun: ec.g.sunSD, moon: ec.g.moonSD },
      selected: state.selected, showLines: state.showLines, showNames: state.showNames,
      insets: innerWidth > 880 ? { l: 36 + 316 + 8, r: 36 + 296 + 8, b: 0 } : { l: 0, r: 0, b: sheetPx() },
    });
  }

  textT += dt;
  if (textT > 0.25) { textT = 0; updateText(); }
}

updatePlace();
setMode(state.mode);
select(state.selected);
if (state.mode === 'system' && !q.get('sel')) overview();
// reflect the selection immediately in the camera when deep-linked
if (q.get('sel') && state.mode === 'system') {
  updateScene(julianDate(new Date(state.simTime)), daysSinceJ2000(julianDate(new Date(state.simTime))), 0);
  const p = worldPos(state.selected);
  controls.target.copy(p); camera.position.copy(p).add(new THREE.Vector3(0, 0.45, 1).normalize().multiplyScalar(cam.dist));
  cam.tween = false; cam.last.copy(p);
}
requestAnimationFrame(frame);
if (q.get('fov')) sky.fov = parseFloat(q.get('fov'));
window.__solar = { state, sky, camera, controls, select, setMode };
