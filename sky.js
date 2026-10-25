// ---------------------------------------------------------------------------
// sky.js — the view from the ground. A stereographic dome you can drag and
// zoom: real stars, constellation lines, the ecliptic, the horizon with
// compass marks, and the Sun, Moon (with phase) and planets in place.
// ---------------------------------------------------------------------------

import { lst } from './astronomy.js';
import { eclipticToEquatorial } from './kepler.js';

const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// sky colour by sun altitude (deg)
const SKY = [
  [-18, hex('#06070b')], [-12, hex('#0b0e19')], [-6, hex('#171d33')],
  [-1, hex('#2d3150')], [3, hex('#3c4a63')], [12, hex('#4c617c')],
];
function skyColor(sunAlt) {
  if (sunAlt <= SKY[0][0]) return SKY[0][1];
  for (let i = 1; i < SKY.length; i++) {
    if (sunAlt <= SKY[i][0]) {
      const [a0, c0] = SKY[i - 1], [a1, c1] = SKY[i];
      return mix(c0, c1, (sunAlt - a0) / (a1 - a0));
    }
  }
  return SKY[SKY.length - 1][1];
}
// faintest star magnitude visible for the sun's altitude
function limitingMag(sunAlt) {
  const T = [[-18, 5.4], [-12, 3.8], [-6, 1.2], [-2, -1.2], [2, -3]];
  if (sunAlt <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (sunAlt <= T[i][0]) {
    const [a0, m0] = T[i - 1], [a1, m1] = T[i];
    return lerp(m0, m1, (sunAlt - a0) / (a1 - a0));
  }
  return T[T.length - 1][1];
}

export class SkyView {
  constructor(canvas, data, { onSelect, moonImg } = {}) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.moonImg = moonImg;
    this.az0 = 180 * D2R; this.alt0 = 32 * D2R; this.fov = 100;
    this.hits = [];

    // precompute unit vectors for stars and lines in the equatorial frame
    this.stars = data.stars.map(([ra, dec, mag, bv]) => {
      const r = ra * D2R, d = dec * D2R;
      return { x: Math.cos(d) * Math.cos(r), y: Math.cos(d) * Math.sin(r), z: Math.sin(d), mag, bv };
    });
    this.names = data.names.map(([ra, dec, name, mag]) => {
      const r = ra * D2R, d = dec * D2R;
      return { x: Math.cos(d) * Math.cos(r), y: Math.cos(d) * Math.sin(r), z: Math.sin(d), name, mag };
    });
    this.lines = data.lines.map(seg => seg.map(([ra, dec]) => {
      const r = ra * D2R, d = dec * D2R;
      return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
    }));
    // ecliptic great circle
    this.ecl = [];
    for (let i = 0; i <= 180; i++) {
      const l = i / 180 * 2 * Math.PI;
      const q = eclipticToEquatorial({ x: Math.cos(l), y: Math.sin(l), z: 0 });
      this.ecl.push([q.x, q.y, q.z]);
    }
    this.bindInput();
  }

  bindInput() {
    const cv = this.cv;
    const ptrs = new Map();
    let moved = 0, pinch = 0;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; pinch = 0;
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.fov = clamp(this.fov * pinch / d, 2, 150);
        pinch = d; moved = 99;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      const degPerPx = this.fov / this.cv.clientHeight;
      // dragging the sky: content follows the pointer
      this.az0 -= dx * degPerPx * D2R * 1.0;
      this.alt0 = clamp(this.alt0 + dy * degPerPx * D2R, 2 * D2R, 90 * D2R);
    });
    const up = e => {
      const wasClick = moved < 5 && ptrs.size === 1;
      ptrs.delete(e.pointerId);
      if (wasClick) this.click(e);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.fov = clamp(this.fov * Math.exp(e.deltaY * 0.0012), 2, 150);
    }, { passive: false });
    cv.addEventListener('dblclick', () => this.reset());
  }

  reset() { this.az0 = 180 * D2R; this.alt0 = 32 * D2R; this.fov = 100; }

  lookAt(az, alt) { this.az0 = az; this.alt0 = clamp(alt, 2 * D2R, 90 * D2R); }

  click(e) {
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 22;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) this.onSelect(best.name);
  }

  // ── projection ────────────────────────────────────────────────────────
  setup(w, h, lstRad, lat) {
    this.w = w; this.h = h;
    const ins = this.insets || { l: 0, r: 0, b: 0 };
    this.cx = (ins.l + (w - ins.r)) / 2; this.cy = (h - (ins.b || 0)) / 2 - 8;
    this.S = (h / 2) / (2 * Math.tan(this.fov * D2R / 4));
    this.sL = Math.sin(lstRad); this.cL = Math.cos(lstRad);
    this.sp = Math.sin(lat); this.cp = Math.cos(lat);
    const a = this.az0, e = this.alt0;
    // centre of view and screen axes, in the (north, east, up) frame
    this.c = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
    this.rx = [-Math.sin(a), Math.cos(a), 0];
    this.uy = [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)];
  }

  // equatorial unit vector → local (north, east, up)
  hor(x, y, z) {
    const xr = x * this.cL + y * this.sL;
    const yr = x * this.sL - y * this.cL;      // west
    return [-this.sp * xr + this.cp * z, -yr, this.cp * xr + this.sp * z];
  }
  horAltAz(alt, az) {
    return [Math.cos(alt) * Math.cos(az), Math.cos(alt) * Math.sin(az), Math.sin(alt)];
  }
  proj(v) {
    const dot = v[0] * this.c[0] + v[1] * this.c[1] + v[2] * this.c[2];
    const den = 1 + dot;
    if (den < 0.02) return null;
    const k = 2 / den;
    return [
      this.cx + this.S * k * (v[0] * this.rx[0] + v[1] * this.rx[1] + v[2] * this.rx[2]),
      this.cy - this.S * k * (v[0] * this.uy[0] + v[1] * this.uy[1] + v[2] * this.uy[2]),
    ];
  }

  // ── drawing ───────────────────────────────────────────────────────────
  draw(st) {
    const cv = this.cv, g = this.g;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lstRad = lst(st.jd, st.obs.lon);
    this.insets = st.insets;
    this.setup(w, h, lstRad, st.obs.lat);
    this.hits = [];

    const sunAlt = st.bodies.Sun.alt / D2R - 22 * Math.pow(st.solarObsc || 0, 6);   // totality darkens the sky
    const sky = skyColor(sunAlt);

    // ground
    g.fillStyle = '#0a0908';
    g.fillRect(0, 0, w, h);

    // sky disc = inside the horizon circle (stereographic keeps circles round)
    const a0 = this.alt0, S = this.S;
    let hor = null;
    if (a0 > 0.001) {
      const yNear = -2 * Math.tan(a0 / 2), yFar = 2 / Math.tan(a0 / 2);
      hor = { cy: this.cy - S * (yNear + yFar) / 2, r: S * (yFar - yNear) / 2 };
    }
    g.save();
    g.beginPath();
    if (hor) g.arc(this.cx, hor.cy, hor.r, 0, 7);
    else g.rect(0, 0, w, h);          // looking at or below the horizon: whole view is sky above/below — handled by clipping below
    g.fillStyle = css(sky);
    if (hor) { g.fill(); g.clip(); }
    else this.drawSkyHalfPlane(g, sky);

    const fadeStars = limitingMag(sunAlt);

    // altitude rings
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(232,225,210,0.07)';
    for (const alt of [30, 60]) this.polyline(g, i => this.horAltAz(alt * D2R, i / 120 * 2 * Math.PI), 121);
    // ecliptic
    g.setLineDash([2, 7]);
    g.strokeStyle = 'rgba(200,144,63,0.38)';
    this.polyline(g, i => { const e = this.ecl[i]; return this.hor(e[0], e[1], e[2]); }, this.ecl.length);
    g.setLineDash([]);

    // constellation lines
    if (st.showLines) {
      g.strokeStyle = `rgba(200,144,63,${0.2 * clamp((fadeStars + 1) / 4, 0, 1)})`;
      g.beginPath();
      for (const seg of this.lines) {
        let prev = null;
        for (const p of seg) {
          const q = this.hor(p[0], p[1], p[2]);
          const pp = this.proj(q);
          if (prev && pp && prev[2] && Math.abs(pp[0] - prev[0]) < w && Math.abs(pp[1] - prev[1]) < h) {
            g.moveTo(prev[0], prev[1]); g.lineTo(pp[0], pp[1]);
          }
          prev = pp ? [pp[0], pp[1], true] : null;
        }
      }
      g.stroke();
    }

    // stars
    for (const s of this.stars) {
      if (s.mag > fadeStars) continue;
      const v = this.hor(s.x, s.y, s.z);
      if (v[2] < -0.01) continue;
      const p = this.proj(v);
      if (!p || p[0] < -8 || p[0] > w + 8 || p[1] < -8 || p[1] > h + 8) continue;
      const ext = clamp(v[2] * 7, 0.15, 1);                // atmospheric dimming near the horizon
      const a = clamp((fadeStars - s.mag) / 1.4, 0, 1) * ext;
      const r = clamp(0.55 + (5.6 - s.mag) * 0.5, 0.5, 3.2) * (this.fov < 60 ? 1.25 : 1);
      g.globalAlpha = a;
      g.fillStyle = starColor(s.bv);
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;

    // star names
    if (st.showNames && fadeStars > 3) {
      g.font = 'italic 12px Newsreader, serif';
      g.fillStyle = 'rgba(232,225,210,0.5)';
      g.textBaseline = 'middle';
      for (const s of this.names) {
        const v = this.hor(s.x, s.y, s.z);
        if (v[2] < 0.03) continue;
        const p = this.proj(v);
        if (!p || p[0] < 10 || p[0] > w - 60 || p[1] < 10 || p[1] > h - 10) continue;
        g.fillText(s.name, p[0] + 7, p[1] - 1);
      }
    }

    // cardinal ticks along the horizon
    g.strokeStyle = 'rgba(232,225,210,0.28)';
    g.beginPath();
    for (let az = 0; az < 360; az += 5) {
      const p0 = this.proj(this.horAltAz(0, az * D2R)), p1 = this.proj(this.horAltAz((az % 45 === 0 ? 2.4 : az % 15 === 0 ? 1.4 : 0.8) * D2R, az * D2R));
      if (p0 && p1) { g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); }
    }
    g.stroke();
    g.restore();

    // horizon line itself
    if (hor) {
      g.strokeStyle = 'rgba(200,144,63,0.55)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(this.cx, hor.cy, hor.r, 0, 7); g.stroke();
    }

    // compass names sit just below the horizon line, on the ground
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    dirs.forEach((d, i) => {
      const p = this.proj(this.horAltAz(-3.2 * D2R * (180 / Math.max(this.fov, 60)) ** 0.5, i * 45 * D2R));
      if (!p || p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) return;
      const major = i % 2 === 0;
      g.font = major ? '500 italic 19px Newsreader, serif' : 'italic 13px Newsreader, serif';
      g.fillStyle = major ? '#c8903f' : 'rgba(232,225,210,0.5)';
      g.fillText(d, p[0], p[1]);
    });
    g.textAlign = 'left';

    // dwarf planets and comets, under the planets
    for (const sm of (st.small || [])) {
      if (sm.alt < -0.5 * D2R && sm.name !== st.selected) continue;
      const v = this.horAltAz(sm.alt, sm.az), p = this.proj(v);
      if (!p || p[0] < -40 || p[0] > w + 40 || p[1] < -40 || p[1] > h + 40) continue;
      this.drawSmall(g, sm, p, st);
    }

    // bodies (Sun then Moon last, so the Moon can pass in front of the Sun)
    const order = ['Neptune', 'Uranus', 'Saturn', 'Jupiter', 'Mars', 'Mercury', 'Venus', 'Sun', 'Moon'];
    let sunP = null;
    for (const name of order) {
      const b = st.bodies[name];
      if (!b) continue;
      const v = this.horAltAz(b.alt, b.az);
      const p = this.proj(v);
      if (!p) continue;
      if (name === 'Sun') sunP = p;
      if (b.alt < -0.5 * D2R && name !== 'Sun' && name !== 'Moon') continue;
      if (p[0] < -40 || p[0] > w + 40 || p[1] < -40 || p[1] > h + 40) continue;
      const kk = 2 / (1 + v[0] * this.c[0] + v[1] * this.c[1] + v[2] * this.c[2]);
      this.drawBody(g, name, b, p, st, sky, kk, v);
    }
    // corona at totality
    if ((st.solarObsc || 0) > 0.995 && sunP) this.drawCorona(g, sunP, st, sunP);

    // soften the sky behind the text columns so the type stays readable (one smooth fall-off, no hard edge)
    const ins = st.insets;
    if (ins && (ins.l || ins.r)) {
      const bg = '8,8,10';
      for (const dir of [1, -1]) {
        const reach = (dir > 0 ? ins.l : ins.r) + 150;
        const x0 = dir > 0 ? 0 : w, x1 = dir > 0 ? reach : w - reach;
        const gr = g.createLinearGradient(x0, 0, x1, 0);
        gr.addColorStop(0, `rgba(${bg},0.82)`); gr.addColorStop(0.6, `rgba(${bg},0.55)`); gr.addColorStop(1, `rgba(${bg},0)`);
        g.fillStyle = gr;
        g.fillRect(dir > 0 ? 0 : w - reach, 0, reach, h);
      }
    }
  }

  drawSkyHalfPlane(g, sky) {
    // looking along/below the horizon: the sky is the half-plane above the horizon line
    g.fillStyle = css(sky);
    g.beginPath();
    const pts = [];
    for (let i = 0; i <= 360; i += 3) {
      const p = this.proj(this.horAltAz(0, i * D2R));
      if (p) pts.push(p);
    }
    g.rect(0, 0, this.w, this.h);
    g.fill();
    g.beginPath(); g.rect(0, 0, this.w, this.h); g.clip();
  }

  polyline(g, fn, n) {
    g.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      const p = this.proj(fn(i));
      if (!p || Math.abs(p[0] - this.cx) > 4000 || Math.abs(p[1] - this.cy) > 4000) { pen = false; continue; }
      if (pen) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); pen = true; }
    }
    g.stroke();
  }

  drawBody(g, name, b, p, st, sky, kk, v) {
    const sel = st.selected === name;
    const color = st.colors[name];
    const isSun = name === 'Sun', isMoon = name === 'Moon';
    let r = isMoon || isSun ? 10 : ({ Venus: 4.6, Jupiter: 4.2, Mars: 3.2, Saturn: 3.2, Mercury: 2.6, Uranus: 2.1, Neptune: 1.9 }[name] || 2.5);
    if (isSun || isMoon) r = Math.max(10, this.S * kk * (isSun ? st.sizes.sun : st.sizes.moon));
    const eclipsing = (st.solarObsc || 0) > 0.001;

    // glow
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * (isSun ? 7 : isMoon ? 3.4 : 4));
    const [cr, cg, cb] = hex(color);
    gr.addColorStop(0, `rgba(${cr},${cg},${cb},${isSun ? 0.55 * (1 - Math.min(1, (st.solarObsc || 0) * 1.05)) : 0.32})`);
    gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = gr;
    if (!(isMoon && eclipsing)) { g.beginPath(); g.arc(p[0], p[1], r * (isSun ? 7 : isMoon ? 3.4 : 4), 0, 7); g.fill(); }

    if (isMoon) this.drawMoon(g, p, r, st, kk, v);
    else {
      g.fillStyle = color;
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
    }

    if (sel) {
      g.strokeStyle = '#e8e1d2'; g.lineWidth = 1;
      g.beginPath(); g.arc(p[0], p[1], r + 7, 0, 7); g.stroke();
    }

    g.font = (sel ? '500 italic 16px' : 'italic 14px') + ' Newsreader, serif';
    g.fillStyle = sel ? '#f4eee0' : 'rgba(232,225,210,0.78)';
    g.textBaseline = 'middle';
    if (!(isMoon && eclipsing && !sel)) g.fillText(name, p[0] + r + 10, p[1] + 1);
    this.hits.push({ name, x: p[0], y: p[1] });
  }

  drawMoon(g, p, r, st, kk, v) {
    const m = st.moon;
    // direction on screen from the Moon toward the Sun → bright limb
    const sv = this.horAltAz(st.bodies.Sun.alt, st.bodies.Sun.az);
    const sp = this.proj(sv);
    let ang = 0;
    if (sp) ang = Math.atan2(sp[1] - p[1], sp[0] - p[0]);
    const k = m.k;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rot = (x, y) => [p[0] + x * ca - y * sa, p[1] + x * sa + y * ca];

    // dark disc (earthshine)
    g.fillStyle = '#16140f';
    g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
    if (this.moonImg && this.moonImg.complete) {
      g.save();
      g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.clip();
      g.globalAlpha = 0.1;
      this.drawMoonTexture(g, p, r);
      g.restore();
    }
    // lit part: right limb (towards the Sun) + terminator ellipse
    g.save();
    g.beginPath();
    const N = 48, t = 1 - 2 * k;
    for (let i = 0; i <= N; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / N;
      const q = rot(r * Math.cos(phi), r * Math.sin(phi));
      if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
    }
    for (let i = N; i >= 0; i--) {
      const phi = -Math.PI / 2 + Math.PI * i / N;
      const q = rot(r * t * Math.cos(phi), r * Math.sin(phi));
      g.lineTo(q[0], q[1]);
    }
    g.closePath();
    g.clip();
    g.fillStyle = '#e8e1d2';
    g.fillRect(p[0] - r - 2, p[1] - r - 2, 2 * r + 4, 2 * r + 4);
    if (this.moonImg && this.moonImg.complete) {
      g.globalCompositeOperation = 'multiply';
      this.drawMoonTexture(g, p, r);
    }
    g.restore();

    // the Earth's shadow, in true angular size, centred where the geocentric line lands
    if (st.lunar && v) {
      const d = this.hor(st.lunar.dEq[0], st.lunar.dEq[1], st.lunar.dEq[2]);
      let c = [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
      const l = Math.hypot(c[0], c[1], c[2]); c = c.map(x => x / l);
      const cp = this.proj(c);
      if (cp) {
        const Ru = this.S * kk * st.lunar.umbra, Rp = this.S * kk * st.lunar.penumbra;
        g.save();
        g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.clip();
        let gr = g.createRadialGradient(cp[0], cp[1], Rp * 0.5, cp[0], cp[1], Rp);
        gr.addColorStop(0, 'rgba(40,14,8,0.34)'); gr.addColorStop(1, 'rgba(40,14,8,0)');
        g.fillStyle = gr; g.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
        gr = g.createRadialGradient(cp[0], cp[1], Ru * 0.9, cp[0], cp[1], Ru * 1.04);
        gr.addColorStop(0, 'rgba(78,26,12,0.9)'); gr.addColorStop(1, 'rgba(78,26,12,0)');
        g.fillStyle = gr; g.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
        g.restore();
      }
    }
  }

  drawCorona(g, p, st) {
    const r = Math.max(10, this.S * 1.0 * st.sizes.sun);
    g.save();
    g.globalCompositeOperation = 'lighter';
    let gr = g.createRadialGradient(p[0], p[1], r * 0.98, p[0], p[1], r * 3.6);
    gr.addColorStop(0, 'rgba(255,248,235,0.85)'); gr.addColorStop(0.25, 'rgba(235,225,255,0.30)'); gr.addColorStop(1, 'rgba(200,200,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(p[0], p[1], r * 3.6, 0, 7); g.arc(p[0], p[1], r * 0.97, 0, 7, true); g.fill('evenodd');   // leave the Moon's disc dark
    g.strokeStyle = 'rgba(240,235,255,0.16)'; g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * 2 * Math.PI + 0.3, len = r * (1.8 + 1.6 * Math.abs(Math.sin(i * 2.7)));
      g.beginPath(); g.moveTo(p[0] + r * 1.05 * Math.cos(a), p[1] + r * 1.05 * Math.sin(a)); g.lineTo(p[0] + len * Math.cos(a), p[1] + len * Math.sin(a)); g.stroke();
    }
    g.restore();
  }

  drawSmall(g, sm, p, st) {
    const sel = st.selected === sm.name;
    const [cr, cg, cb] = hex(sm.color);
    if (sm.kind === 'comet') {
      // tail points away from the Sun on the sky
      const sv = this.horAltAz(st.bodies.Sun.alt, st.bodies.Sun.az), sp = this.proj(sv);
      let dx = 0, dy = 0;
      if (sp) { dx = p[0] - sp[0]; dy = p[1] - sp[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
      const len = 20 + 90 * clamp((10.5 - sm.mag) / 7, 0, 1);
      const gr = g.createLinearGradient(p[0], p[1], p[0] + dx * len, p[1] + dy * len);
      gr.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.strokeStyle = gr; g.lineWidth = 3.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + dx * len, p[1] + dy * len); g.stroke();
      const gl = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 14);
      gl.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`); gl.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = gl; g.beginPath(); g.arc(p[0], p[1], 14, 0, 7); g.fill();
    }
    g.fillStyle = sm.color;
    g.beginPath(); g.arc(p[0], p[1], clamp(3.2 - (sm.mag - 6) * 0.25, 1.5, 3.4), 0, 7); g.fill();
    if (sel) { g.strokeStyle = '#e8e1d2'; g.lineWidth = 1; g.beginPath(); g.arc(p[0], p[1], 10, 0, 7); g.stroke(); }
    g.font = (sel ? '500 italic 15px' : 'italic 13px') + ' Newsreader, serif';
    g.fillStyle = sel ? '#f4eee0' : 'rgba(232,225,210,0.7)';
    g.textBaseline = 'middle';
    g.fillText(`${sm.label}`, p[0] + 12, p[1] + 1);
    g.font = '300 10.5px Outfit, sans-serif'; g.fillStyle = 'rgba(232,225,210,0.4)';
    g.fillText(`mag ${sm.mag.toFixed(1)}`, p[0] + 12, p[1] + 14);
    this.hits.push({ name: sm.name, x: p[0], y: p[1] });
  }

  drawMoonTexture(g, p, r) {
    const im = this.moonImg;
    const sh = im.naturalHeight, sw = sh;                       // central square of the equirectangular map
    g.drawImage(im, (im.naturalWidth - sw) / 2, 0, sw, sh, p[0] - r, p[1] - r, 2 * r, 2 * r);
  }
}

function starColor(bv) {
  const t = clamp(bv, -0.3, 1.6);
  if (t < 0.3) return '#cfdcff';
  if (t < 0.6) return '#f3f1ea';
  if (t < 1.0) return '#fbe7b8';
  return '#f6c58c';
}
