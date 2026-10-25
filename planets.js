// ---------------------------------------------------------------------------
// planets.js — procedural planet surfaces, Saturn's rings, the Sun, orbit
// trails and the star backdrop. Everything is a small shader so there are no
// texture downloads beyond Earth and the Moon.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export const OBLIQUITY = 23.43929111 * Math.PI / 180;

// J2000 pole direction (RA, Dec in degrees) → scene-frame unit vector
const POLES = {
  Mercury: [281.01, 61.45], Venus: [272.76, 67.16], Earth: [0, 90],
  Mars: [317.68, 52.89], Jupiter: [268.06, 64.50], Saturn: [40.59, 83.54],
  Uranus: [257.31, -15.18], Neptune: [299.36, 43.46],
};

// equatorial unit vector → scene (ecliptic: x, z up, -y)
export function eqToScene(x, y, z) {
  const ey = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const ez = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return new THREE.Vector3(x, ez, -ey);
}

export function poleQuaternion(name) {
  const [ra, dec] = POLES[name].map(d => d * Math.PI / 180);
  const v = eqToScene(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
}

const NOISE = /* glsl */`
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
`;

const VERT = /* glsl */`
varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main(){
  vObj = normalize(position);
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// surface kinds: 0 rock, 1 banded gas, 2 cloud (venus), 3 mars, 4 earth, 5 ice
const FRAG = /* glsl */`
uniform int uKind; uniform vec3 uC1, uC2, uC3, uAtm; uniform float uFreq, uSeed, uTime;
uniform sampler2D uDay, uNight;
varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
${NOISE}
void main(){
  vec3 p = vObj + uSeed;
  vec3 col;
  if (uKind == 4) {
    col = texture2D(uDay, vUv).rgb;
  } else if (uKind == 0) {
    float n = fbm(p*5.0), c = fbm(p*17.0), r = fbm(p*40.0);
    col = mix(uC1, uC2, n);
    col *= 0.78 + 0.45*c;
    col *= 0.9 + 0.2*r;
  } else if (uKind == 3) {
    float n = fbm(p*3.5), d = fbm(p*9.0+4.0);
    col = mix(uC1, uC2, smoothstep(.35,.65,n));
    col = mix(col, uC3, smoothstep(.5,.8,d)*0.35);
    float cap = smoothstep(.86,.93,abs(vObj.y) + (fbm(p*8.0)-.5)*.06);
    col = mix(col, vec3(.93,.92,.9), cap);
  } else if (uKind == 2) {
    vec3 q = p*2.2; q.y *= 2.6;
    float w = fbm(q + vec3(fbm(q*2.0+uTime*.01)*1.6));
    col = mix(uC1, uC2, w);
    col = mix(col, uC3, smoothstep(.6,.85,fbm(p*5.0))*.4);
  } else {
    float lat = vObj.y;
    float warp = fbm(vec3(p.x*2.2, lat*5.0, p.z*2.2))*.16;
    float band = sin((lat+warp)*uFreq)*.5+.5;
    float fine = fbm(vec3(p.x*5.0, lat*uFreq*1.7, p.z*5.0));
    float t = clamp(band*.62 + fine*.5, 0., 1.);
    col = mix(uC1, uC2, t);
    col = mix(col, uC3, smoothstep(.62,.9,fbm(vec3(p.x*3.0, lat*uFreq*.6, p.z*3.0)+7.0))*.55);
    if (uKind == 1 && uSeed > 4.5 && uSeed < 5.5) { // Jupiter's red spot
      float lon = atan(vObj.z, vObj.x);
      vec2 d = vec2((lon-1.1)*cos(lat*1.3)*1.0, (lat+.27)*1.9);
      float s = smoothstep(.2,.05,length(d*vec2(1.0,1.9)));
      col = mix(col, vec3(.66,.33,.22), s*.85);
    }
  }
  vec3 L = normalize(-vW);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float lam = dot(N, L);
  float lit = smoothstep(-0.06, 0.45, lam);
  if (uKind == 4) {
    vec3 city = texture2D(uNight, vUv).rgb;
    col = col*(0.05 + 0.95*lit) + city * smoothstep(.1,-.25,lam) * vec3(1.0,.72,.38) * 1.1;
  } else {
    col *= 0.06 + 0.94*lit;
  }
  // warm band right at the terminator
  float tw = smoothstep(-.02,.12,lam)*(1.-smoothstep(.12,.4,lam));
  col += vec3(.9,.45,.2)*tw*.05;
  float fres = pow(1.0 - max(dot(N,V),0.), 3.2);
  col += uAtm * fres * (0.12 + 0.88*smoothstep(-.25,.5,lam)) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;

function tex(url, loader) {
  const t = loader.load(url);
  t.anisotropy = 4;
  return t;
}

const STYLE = {
  Mercury: { kind: 0, c1: '#6e6a66', c2: '#b3aa9c', c3: '#000', atm: '#1a1816', seed: 1.3 },
  Venus:   { kind: 2, c1: '#d9b980', c2: '#f1e3bd', c3: '#b98d55', atm: '#6b5532', seed: 2.1 },
  Mars:    { kind: 3, c1: '#a5513a', c2: '#d39064', c3: '#5a2f26', atm: '#4a2a1c', seed: 3.4 },
  Jupiter: { kind: 1, c1: '#9b6a48', c2: '#e6cfa8', c3: '#c88a5e', atm: '#40301e', seed: 5.0, freq: 30 },
  Saturn:  { kind: 1, c1: '#c9ad78', c2: '#ecdcae', c3: '#b39560', atm: '#4a3f26', seed: 6.2, freq: 22 },
  Uranus:  { kind: 5, c1: '#8cc7c9', c2: '#b4e0de', c3: '#7fb5bd', atm: '#2b5558', seed: 7.7, freq: 8 },
  Neptune: { kind: 1, c1: '#2f4fa8', c2: '#5c80d6', c3: '#8aa8e8', atm: '#1d2f68', seed: 8.8, freq: 12 },
  Moon:    { kind: 4, c1: '#000', c2: '#000', c3: '#000', atm: '#0c0c0c', seed: 0 },
  Earth:   { kind: 4, c1: '#000', c2: '#000', c3: '#000', atm: '#2c5f98', seed: 0 },
};

export function makePlanet(name, radius, loader) {
  const s = STYLE[name];
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uKind: { value: s.kind },
      uC1: { value: new THREE.Color(s.c1) }, uC2: { value: new THREE.Color(s.c2) },
      uC3: { value: new THREE.Color(s.c3) }, uAtm: { value: new THREE.Color(s.atm) },
      uFreq: { value: s.freq || 10 }, uSeed: { value: s.seed }, uTime: { value: 0 },
      uDay: { value: name === 'Earth' ? tex('./assets/earth_atmos_2048.jpg', loader) : name === 'Moon' ? tex('./assets/moon_1024.jpg', loader) : BLANK },
      uNight: { value: name === 'Earth' ? tex('./assets/earth_lights_2048.png', loader) : BLANK },
    },
  });
  // Colour values here are authored in display (sRGB) space; THREE.Color
  // converts hex to linear, so convert back to keep what we typed.
  for (const k of ['uC1', 'uC2', 'uC3', 'uAtm']) mat.uniforms[k].value.convertLinearToSRGB();

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), mat);
  // tilt group carries the real pole direction; mesh spins inside it
  const tilt = new THREE.Group();
  if (POLES[name]) tilt.quaternion.copy(poleQuaternion(name));
  tilt.add(mesh);
  const group = new THREE.Group();
  group.add(tilt);
  group.userData = { mesh, tilt, radius };
  return group;
}

export function makeRings(radius) {
  const inner = radius * 1.24, outer = radius * 2.27;
  const geo = new THREE.RingGeometry(inner, outer, 160, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: { uIn: { value: inner }, uOut: { value: outer }, uR: { value: radius } },
    vertexShader: /* glsl */`
      varying vec3 vLocal; varying vec3 vW; varying vec3 vC;
      void main(){ vLocal = position; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
        vC = (modelMatrix*vec4(0.,0.,0.,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform float uIn, uOut, uR; varying vec3 vLocal; varying vec3 vW; varying vec3 vC;
      ${NOISE}
      void main(){
        float r = length(vLocal.xz);
        float u = (r - uIn)/(uOut - uIn);           // 0 inner → 1 outer
        float rr = r / uR;                           // in planet radii
        float a;
        if (rr < 1.53)      a = 0.28;                // C ring
        else if (rr < 1.95) a = 0.9;                 // B ring
        else if (rr < 2.03) a = 0.04;                // Cassini division
        else                a = 0.62;                // A ring
        a *= 0.72 + 0.28*noise(vec3(r*38.0, 0., 3.));
        a *= 0.8 + 0.2*noise(vec3(r*150.0, 1., 0.));
        a *= smoothstep(0.,.03,u)*smoothstep(1.,.97,u);
        vec3 col = mix(vec3(.62,.55,.42), vec3(.9,.82,.64), smoothstep(0.,1.,noise(vec3(r*22.,2.,5.))));
        // planet's shadow on the rings
        vec3 L = normalize(-vC);                      // sun direction from the planet
        vec3 toP = vC - vW;
        float along = dot(toP, L);
        float perp = length(toP - L*along);
        // fragment is shadowed if the planet lies sunward of it and the ray passes inside the disc
        float sh = (along > 0.) ? smoothstep(uR*1.0, uR*.93, perp) : 0.;
        col *= 1. - sh*.88;
        a *= 1. - sh*.5;
        gl_FragColor = vec4(col, a);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function makeSun() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 64, 40), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vObj; varying vec3 vN; varying vec3 vW;
      ${NOISE}
      void main(){
        vec3 p = vObj*3.2 + vec3(0., uTime*.03, 0.);
        float g = fbm(p*2.0 + fbm(p*1.3 + uTime*.02)*1.4);
        float sp = smoothstep(.62,.8,fbm(vObj*4.5+11.));        // faint cooler patches
        vec3 hot = vec3(1.0,.93,.74), mid = vec3(1.0,.72,.34), cool = vec3(.86,.45,.18);
        vec3 col = mix(mid, hot, g);
        col = mix(col, cool, sp*.55);
        vec3 V = normalize(cameraPosition - vW);
        float mu = max(dot(normalize(vN), V), 0.);
        col *= 0.55 + 0.45*pow(mu, .55);                          // limb darkening
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  group.add(body);
  const add = (size, stops, op) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(stops), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: op,
    }));
    s.scale.set(size, size, 1); group.add(s); return s;
  };
  add(7.5, [[0, 'rgba(255,236,190,1)'], [0.22, 'rgba(255,196,110,.55)'], [0.5, 'rgba(230,140,60,.14)'], [1, 'rgba(200,100,40,0)']], 0.95);
  add(26,  [[0, 'rgba(255,200,120,.30)'], [0.35, 'rgba(230,150,70,.07)'], [1, 'rgba(200,100,40,0)']], 1);
  group.userData.body = body;
  return group;
}

// Orbit with a comet-like trail: brightest right behind the planet
export function makeOrbit(points, color) {
  const n = points.length;
  const pos = new Float32Array(n * 3), s = new Float32Array(n);
  points.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); s[i] = i / (n - 1); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('s', new THREE.BufferAttribute(s, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uHead: { value: 0 }, uColor: { value: new THREE.Color(color).convertLinearToSRGB() }, uBoost: { value: 0 } },
    vertexShader: `attribute float s; varying float vS; void main(){ vS = s; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uHead, uBoost; uniform vec3 uColor; varying float vS;
      void main(){ float behind = fract(uHead - vS); float a = 0.13 + 0.55*pow(1.-behind, 3.) + uBoost*.25;
        gl_FragColor = vec4(uColor, a); }`,
  });
  return new THREE.Line(geo, mat);
}

// Real stars as screen-space discs, parked on a far sphere around the camera
export function makeStarfield(stars) {
  const n = stars.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3);
  stars.forEach(([ra, dec, mag, bv], i) => {
    const r = ra * Math.PI / 180, d = dec * Math.PI / 180;
    const v = eqToScene(Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)).multiplyScalar(900);
    pos.set([v.x, v.y, v.z], i * 3);
    size[i] = Math.max(0.9, 3.6 - mag * 0.55);
    // B–V → warm/cool tint, kept soft
    const t = Math.max(-0.3, Math.min(1.6, bv));
    const c = t < 0.6
      ? [0.72 + t * 0.35, 0.8 + t * 0.2, 1.0 - t * 0.2]
      : [1.0, 0.93 - (t - 0.6) * 0.3, 0.8 - (t - 0.6) * 0.55];
    col.set(c, i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uPx: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uPx;
      void main(){ vC = color; vA = clamp(size/2.4, .35, 1.); gl_PointSize = size*uPx;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ vec2 d = gl_PointCoord-.5; float r = length(d)*2.; float a = smoothstep(1.,.2,r)*vA;
        gl_FragColor = vec4(vC, a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = -2;
  return pts;
}

export function makeConstellations(lines) {
  const verts = [];
  for (const seg of lines) {
    for (let i = 0; i < seg.length - 1; i++) {
      for (const [ra, dec] of [seg[i], seg[i + 1]]) {
        const r = ra * Math.PI / 180, d = dec * Math.PI / 180;
        const v = eqToScene(Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)).multiplyScalar(899);
        verts.push(v.x, v.y, v.z);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8903f, transparent: true, opacity: 0.16, depthWrite: false }));
  l.frustumCulled = false; l.renderOrder = -3;
  return l;
}
