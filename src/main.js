import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  DEG, SUN, PLANETS, HALLEY, scaleDist, EARTH_YEAR_SECONDS, EARTH_DAY_SECONDS, J2000_MS, YEAR_MS,
} from './data.js';
import { TAU, mod, solveKepler, positionFromE, meanAnomalyForLongitude } from './orbit.js';
import * as TX from './textures.js';

// ------------------------------------------------------------------ setup
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05060f');

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 30000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 1.2;
controls.screenSpacePanning = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sunLight = new THREE.PointLight(0xfff4e0, 3.2, 0, 0);
scene.add(sunLight);

// 3-step toon ramp
const gradientMap = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

const toon = (map, extra = {}) => new THREE.MeshToonMaterial({ map, gradientMap, ...extra });
const outlineMat = new THREE.MeshBasicMaterial({ color: '#0b0b1a', side: THREE.BackSide });
function outline(radius, scale = 1.045, mat = outlineMat) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius * scale, 48, 24), mat);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

// ------------------------------------------------------------------ state
const state = {
  simYears: (Date.now() - J2000_MS) / YEAR_MS, // years since J2000 in the simulation
  mult: 1,
  paused: false,
  spinMult: 1,
  spinT: 0,
  imaginary: false, // positions no longer match the calendar (after aligning)
  labels: true,
  orbits: true,
};
let mode = 'overview';
let focused = null;
let flight = null;
let anomalyTween = null;
const lastFocusPos = new THREE.Vector3();

const bodies = []; // everything selectable
const orbiters = []; // everything with a Keplerian orbit

// ------------------------------------------------------------------ helpers
function makeLabel(text, color, onClick) {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.className = onClick ? 'label' : 'label region';
  el.textContent = text;
  el.style.setProperty('--c', color);
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1);
  return obj;
}

function addMoons(body, def) {
  for (const m of def.moons || []) {
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.random() * TAU;
    const size = def.radius * m.size;
    let geo = new THREE.SphereGeometry(size, 24, 16);
    if (m.lumpy) {
      geo = new THREE.IcosahedronGeometry(size, 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        tmpV.fromBufferAttribute(p, i);
        tmpV.multiplyScalar(1 + 0.18 * Math.sin(tmpV.x * 9 / size) * Math.cos(tmpV.y * 7 / size));
        tmpV.x *= 1.35;
        p.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
      }
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, toon(TX[m.tex]()));
    mesh.position.set(def.radius * m.dist, 0, 0);
    if (!m.lumpy) mesh.add(outline(size, 1.06));
    pivot.add(mesh);
    body.tilt.add(pivot);
    body.moons.push({ pivot, period: m.period });
  }
}

function orbitLine(el, color, dashed = false) {
  const pts = [];
  for (let k = 0; k <= 512; k++) pts.push(positionFromE(el, (k / 512) * TAU, new THREE.Vector3()));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.5, dashSize: 4, gapSize: 3 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  scene.add(line);
  return line;
}

function realMeanAnomaly(b, years) {
  return b.M0 + (TAU * years) / b.period;
}

// ------------------------------------------------------------------ the Sun
function createSun() {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = -SUN.tilt * DEG;
  root.add(tilt);
  scene.add(root);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUN.radius, 64, 32), new THREE.MeshBasicMaterial({ map: TX.sun() }));
  mesh.add(outline(SUN.radius, 1.03, new THREE.MeshBasicMaterial({ color: '#b34a00', side: THREE.BackSide })));
  tilt.add(mesh);

  const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.sunburst(), transparent: true, depthWrite: false }));
  burst.scale.setScalar(SUN.radius * 4.2);
  burst.renderOrder = -1;
  root.add(burst);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(SUN.radius * 5.5);
  root.add(halo);

  const body = { def: SUN, root, tilt, mesh, moons: [], isSun: true, burst };
  body.label = makeLabel(SUN.name, SUN.color, () => focusOn(body));
  body.label.position.set(0, SUN.radius * 1.5, 0);
  root.add(body.label);
  bodies.push(body);
  return body;
}

// ------------------------------------------------------------------ planets
function createPlanet(def) {
  const el = { a: scaleDist(def.a), e: def.e, i: def.i * DEG, node: def.node * DEG, argp: (def.peri - def.node) * DEG };
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = -def.tilt * DEG;
  root.add(tilt);
  scene.add(root);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 64, 32), toon(TX[def.id]()));
  mesh.add(outline(def.radius, def.clouds ? 1.06 : 1.045));
  tilt.add(mesh);

  const body = {
    def, el, root, tilt, mesh, moons: [],
    period: Math.pow(def.a, 1.5),
    M0: (def.L - def.peri) * DEG,
  };
  body.M = realMeanAnomaly(body, state.simYears);

  if (def.clouds) {
    body.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius * 1.02, 64, 32),
      toon(TX.earthClouds(), { transparent: true, depthWrite: false }),
    );
    tilt.add(body.clouds);
  }
  if (def.rings) {
    const { inner, outer } = def.rings;
    const ri = def.radius * inner, ro = def.radius * outer;
    const g = new THREE.RingGeometry(ri, ro, 160, 1);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i);
      uv.setXY(i, (tmpV.length() - ri) / (ro - ri), 0.5);
    }
    const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      map: TX[def.rings.tex](), transparent: true, side: THREE.DoubleSide, depthWrite: false, color: '#e6e6e6',
    }));
    ring.rotation.x = -Math.PI / 2;
    tilt.add(ring);
  }
  addMoons(body, def);

  body.orbit = orbitLine(el, def.color);
  body.label = makeLabel(def.name, def.color, () => focusOn(body));
  body.label.position.set(0, def.radius * (def.rings ? 1.6 : 1.25) + 1, 0);
  root.add(body.label);

  bodies.push(body);
  orbiters.push(body);
  return body;
}

// ------------------------------------------------------------------ Halley's comet
function createComet(def) {
  const el = { a: def.aScene, e: def.e, i: def.i * DEG, node: def.node * DEG, argp: def.argp * DEG };
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  scene.add(root);

  const geo = new THREE.IcosahedronGeometry(def.radius, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    tmpV.fromBufferAttribute(p, i);
    tmpV.x *= 1.6;
    p.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, toon(TX.halley()));
  tilt.add(mesh);

  const coma = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TX.glow('rgba(220,245,255,0.9)', 'rgba(150,210,255,0.3)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  root.add(coma);

  // Tails always point directly away from the Sun.
  const tail = new THREE.Group();
  const alphaMap = TX.tailGradient();
  const makeTail = (radius, color, bend) => {
    const g = new THREE.ConeGeometry(radius, 1, 24, 1, true);
    g.translate(0, -0.5, 0);
    g.rotateX(Math.PI / 2); // tip at origin, opening toward -z
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, alphaMap, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.8,
    }));
    m.rotation.y = bend;
    tail.add(m);
    return m;
  };
  makeTail(0.12, '#7fc8ff', 0); // ion tail
  makeTail(0.2, '#fff1c9', 0.12); // curved dust tail
  root.add(tail);

  const body = {
    def, el, root, tilt, mesh, moons: [], tail, coma, isComet: true,
    period: def.period,
    M0: (TAU * (0 - def.periYears)) / def.period,
  };
  body.M = realMeanAnomaly(body, state.simYears);
  body.orbit = orbitLine(el, def.color, true);
  body.label = makeLabel('Halley', def.color, () => focusOn(body));
  body.label.position.set(0, 2, 0);
  root.add(body.label);
  bodies.push(body);
  orbiters.push(body);
  return body;
}

// ------------------------------------------------------------------ belts & stars
function rockField({ count, auMin, auMax, gaps = [], thickness, sizeMin, sizeMax, colors, seedSpin }) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = toon(null); // detail-0 icosahedron already has faceted normals
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  for (let n = 0; n < count; n++) {
    let au;
    do { au = auMin + Math.random() * (auMax - auMin); } while (gaps.some(([g, w]) => Math.abs(au - g) < w));
    const r = scaleDist(au) * (1 + (Math.random() - 0.5) * 0.04);
    const a = Math.random() * TAU;
    const y = (Math.random() + Math.random() + Math.random() - 1.5) * thickness;
    tmpV.set(Math.cos(a) * r, y, Math.sin(a) * r);
    e.set(Math.random() * TAU, Math.random() * TAU, Math.random() * seedSpin);
    q.setFromEuler(e);
    const sz = sizeMin + Math.pow(Math.random(), 3) * (sizeMax - sizeMin);
    s.set(sz * (0.8 + Math.random() * 0.6), sz * (0.6 + Math.random() * 0.4), sz);
    m.compose(tmpV, q, s);
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, c.set(colors[n % colors.length]));
  }
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  return group;
}

// Main asteroid belt (2.1-3.3 AU) with the Kirkwood gaps carved by Jupiter's resonances.
const asteroidBelt = rockField({
  count: 2600, auMin: 2.1, auMax: 3.3, gaps: [[2.5, 0.03], [2.82, 0.025], [2.95, 0.02]],
  thickness: 2.2, sizeMin: 0.12, sizeMax: 0.55, colors: ['#8d8173', '#a29482', '#6f655b', '#b5a58f'], seedSpin: 3,
});
asteroidBelt.userData.period = Math.pow(2.7, 1.5);

// Kuiper belt (30-50 AU): icy bodies beyond Neptune.
const kuiperBelt = rockField({
  count: 2200, auMin: 30.5, auMax: 50, thickness: 9, sizeMin: 0.25, sizeMax: 1.0,
  colors: ['#9fb6c9', '#c5d6e3', '#8aa0b8', '#d7c7c0'], seedSpin: 3,
});
kuiperBelt.userData.period = Math.pow(42, 1.5);

const beltLabels = [
  makeLabel('Asteroid Belt', '#c9b79c'),
  makeLabel('Kuiper Belt', '#a9c4dd'),
];
beltLabels[0].position.set(scaleDist(2.7) * Math.cos(-0.6), 3, scaleDist(2.7) * Math.sin(-0.6));
beltLabels[1].position.set(scaleDist(42) * Math.cos(-0.9), 10, scaleDist(42) * Math.sin(-0.9));
beltLabels.forEach((l) => scene.add(l));

function starfield() {
  const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    tmpV.randomDirection().multiplyScalar(8000 + Math.random() * 4000);
    pos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
    c.setHSL(Math.random() < 0.7 ? 0.6 : 0.1, 0.6, 0.75 + Math.random() * 0.25);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    size: 40, map: TX.dot(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(stars);
}
starfield();

// ------------------------------------------------------------------ build
createSun();
PLANETS.forEach(createPlanet);
createComet(HALLEY);
const planetBodies = orbiters.filter((b) => !b.isComet);

// ------------------------------------------------------------------ simulation update
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function placeBodies() {
  for (const b of orbiters) {
    positionFromE(b.el, solveKepler(b.M, b.el.e), b.root.position);
  }
}

function tweenAnomalies(items, seconds, onDone) {
  anomalyTween = { t0: performance.now(), dur: seconds * 1000, items, onDone };
}

function update(dt, now) {
  if (anomalyTween) {
    const p = Math.min(1, (now - anomalyTween.t0) / anomalyTween.dur);
    const k = ease(p);
    for (const it of anomalyTween.items) it.b.M = it.from + it.delta * k;
    if (p >= 1) {
      const done = anomalyTween.onDone;
      anomalyTween = null;
      done?.();
    }
  } else if (!state.paused) {
    const dYears = (dt * state.mult) / EARTH_YEAR_SECONDS;
    state.simYears += dYears;
    for (const b of orbiters) b.M += (TAU * dYears) / b.period;
  }
  for (const belt of [asteroidBelt, kuiperBelt]) belt.rotation.y = (TAU * state.simYears) / belt.userData.period;

  placeBodies();

  // spin & moons run on their own clock so you can always watch them turn
  state.spinT += dt * state.spinMult;
  const days = state.spinT / EARTH_DAY_SECONDS;
  for (const b of bodies) {
    b.mesh.rotation.y = (TAU * days) / b.def.rotDays;
    if (b.clouds) b.clouds.rotation.y = (TAU * days) / (b.def.rotDays * 0.85);
    for (const m of b.moons) m.pivot.rotation.y += (TAU * dt * state.spinMult) / (EARTH_DAY_SECONDS * m.period);
  }
  const sun = bodies[0];
  sun.burst.material.rotation = now * 0.00006;
  sun.burst.scale.setScalar(SUN.radius * (4.1 + Math.sin(now * 0.002) * 0.15));

  // comet tail grows near the Sun
  for (const b of orbiters) {
    if (!b.isComet) continue;
    const r = b.root.position.length();
    const len = THREE.MathUtils.clamp(900 / r, 3, 70);
    b.tail.lookAt(0, 0, 0);
    b.tail.children.forEach((t, i) => t.scale.set(len * 0.12 * (i ? 1.4 : 1), len * 0.12 * (i ? 1.4 : 1), len * (i ? 0.75 : 1)));
    b.coma.scale.setScalar(THREE.MathUtils.clamp(250 / r, 1.5, 9));
  }
}

// ------------------------------------------------------------------ camera
function overviewDistance() {
  // landscape: fit to just past Neptune; portrait phones: fit to Uranus (pinch out for more)
  const half = scaleDist(camera.aspect < 1 ? 22 : 36) + 10;
  const t = Math.tan((camera.fov * DEG) / 2);
  return (half / Math.min(t, t * camera.aspect)) * 1.05;
}
const overviewDir = new THREE.Vector3(0, 0.55, 0.83).normalize();
// Slightly tilted top-down view where ecliptic longitude 90° points "up" on screen.
const alignDir = new THREE.Vector3(0, 0.93, 0.36).normalize();

function fly(targetFn, camFn, seconds, onDone) {
  flight = {
    t0: performance.now(), dur: seconds * 1000,
    fromT: controls.target.clone(), fromC: camera.position.clone(),
    targetFn, camFn, onDone,
  };
  controls.enabled = false;
}

function updateFlight(now) {
  if (!flight) return false;
  const p = Math.min(1, (now - flight.t0) / flight.dur);
  const k = ease(p);
  const gt = flight.targetFn().clone();
  const gc = flight.camFn(gt);
  controls.target.lerpVectors(flight.fromT, gt, k);
  camera.position.lerpVectors(flight.fromC, gc, k);
  camera.lookAt(controls.target);
  if (p >= 1) {
    const f = flight;
    flight = null;
    controls.enabled = true;
    f.onDone?.();
  }
  return true;
}

function setOverviewLimits() {
  controls.minDistance = 4;
  controls.maxDistance = overviewDistance() * 3;
  controls.enablePan = true;
}

function goOverview(seconds = 1.8) {
  mode = 'overview';
  focused = null;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  const d = overviewDistance();
  fly(() => new THREE.Vector3(), (t) => t.clone().addScaledVector(overviewDir, d), seconds, setOverviewLimits);
  syncUI();
}

function focusOn(body) {
  if (mode === 'focus' && focused === body) return;
  if (mode !== 'focus' && window.innerWidth <= 640) ui.info.classList.add('collapsed');
  mode = 'focus';
  focused = body;
  const r = body.def.radius;
  const viewR = body.isComet ? 4 : r * (body.def.rings ? body.def.rings.outer : 1.25);
  let dist = viewR * 3 + 1;
  if (camera.aspect < 1) dist /= Math.max(camera.aspect, 0.45) * 1.15;

  const pos = body.root.getWorldPosition(new THREE.Vector3());
  let dir;
  if (body.isSun) {
    dir = camera.position.clone().sub(controls.target).normalize();
  } else {
    // view from the sunny side, a bit off-axis so you see the day/night line
    const toSun = pos.clone().negate().normalize();
    const side = new THREE.Vector3().crossVectors(toSun, UP).normalize();
    dir = toSun.multiplyScalar(0.75).addScaledVector(side, 0.6).addScaledVector(UP, 0.3).normalize();
    if (body.def.rings) {
      // make sure we're looking down onto the rings, not edge-on
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(body.tilt.getWorldQuaternion(new THREE.Quaternion()));
      if (pole.dot(dir) < 0) pole.negate();
      const lift = 0.45 - pole.dot(dir);
      if (lift > 0) dir.addScaledVector(pole, lift * 1.5).normalize();
    }
  }
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  fly(
    () => body.root.getWorldPosition(tmpV),
    (t) => t.clone().addScaledVector(dir, dist),
    1.8,
    () => {
      body.root.getWorldPosition(lastFocusPos);
      controls.minDistance = r * 1.3;
      controls.maxDistance = Math.max(dist * 8, 60);
      controls.enablePan = false;
    },
  );
  syncUI();
}

function followFocused() {
  if (mode !== 'focus' || !focused || flight) return;
  const p = focused.root.getWorldPosition(tmpV);
  const d = p.clone().sub(lastFocusPos);
  camera.position.add(d);
  controls.target.add(d);
  lastFocusPos.copy(p);
}

// ------------------------------------------------------------------ alignment
function align(up) {
  state.paused = true;
  state.imaginary = true;
  const lam = (up ? 90 : 270) * DEG;
  const items = planetBodies.map((b) => {
    const from = mod(b.M, TAU);
    let delta = mod(meanAnomalyForLongitude(b.el, lam) - from, TAU); // always move forward along the orbit
    if (delta > TAU - 1e-3) delta = 0;
    return { b, from, delta };
  });
  for (const b of orbiters) if (b.isComet) b.M = mod(b.M, TAU);
  tweenAnomalies(items, 3.5);

  // Frame the whole line (Sun at one end, outermost planet at the other).
  let extent = 0;
  for (const it of items) {
    extent = Math.max(extent, positionFromE(it.b.el, solveKepler(it.from + it.delta, it.b.el.e), tmpV).length());
  }
  const lineDir = new THREE.Vector3(0, 0, up ? -1 : 1); // ecliptic longitude 90° is "up" on screen
  const half = extent / 2 + SUN.radius * 2;
  // Fit the line into the screen area left between the top bar and the bottom controls.
  const h = window.innerHeight;
  const topPx = 80, bottomPx = document.getElementById('bottom').offsetHeight + 10;
  const freeFrac = Math.max(0.3, (h - topPx - bottomPx) / h);
  const t = Math.tan((camera.fov * DEG) / 2);
  const dist = (half / (Math.min(t * freeFrac, t * camera.aspect * 2) * alignDir.y)) * 1.05;
  // shift so the free area (not the whole screen) is centred on the line
  const shift = (dist * t * (bottomPx - topPx)) / h / alignDir.y;
  const center = lineDir.multiplyScalar(extent / 2).add(new THREE.Vector3(0, 0, shift));
  mode = 'overview';
  focused = null;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  fly(() => center, (c) => c.clone().addScaledVector(alignDir, dist), 2, setOverviewLimits);
  syncUI();
}

function backToNow() {
  state.simYears = (Date.now() - J2000_MS) / YEAR_MS;
  state.imaginary = false;
  const items = orbiters.map((b) => {
    const from = b.M;
    const target = realMeanAnomaly(b, state.simYears);
    const delta = mod(target - from + Math.PI, TAU) - Math.PI; // shortest way
    return { b, from, delta };
  });
  tweenAnomalies(items, 2.5);
  syncUI();
}

// ------------------------------------------------------------------ picking (tap / click)
// Screen-space picking is far friendlier on phones than ray casting tiny spheres.
const pointerDown = new Map();
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDown.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), multi: pointerDown.size > 0 });
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = pointerDown.get(e.pointerId);
  pointerDown.delete(e.pointerId);
  if (!d || d.multi || pointerDown.size) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
  pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18);
});
renderer.domElement.addEventListener('pointercancel', (e) => pointerDown.delete(e.pointerId));

function pick(x, y, slop) {
  const w = window.innerWidth, h = window.innerHeight;
  const pxPerUnit = h / 2 / Math.tan((camera.fov * DEG) / 2);
  let best = null, bestScore = Infinity;
  for (const b of bodies) {
    const p = b.root.getWorldPosition(new THREE.Vector3());
    const dist = p.distanceTo(camera.position);
    p.project(camera);
    if (p.z > 1) continue; // behind camera
    const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
    const rPx = (b.def.radius / dist) * pxPerUnit;
    const score = Math.hypot(sx - x, sy - y) - rPx;
    if (score < slop && score < bestScore) { best = b; bestScore = score; }
  }
  if (best) focusOn(best);
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const ui = {
  date: $('date'), back: $('backBtn'), title: $('titleBlock'), play: $('playBtn'),
  speed: $('speed'), speedLabel: $('speedLabel'), alignGroup: $('alignGroup'),
  info: $('info'), infoName: $('infoName'), infoBlurb: $('infoBlurb'), infoStats: $('infoStats'),
  chips: $('chips'), labels: $('labelsBtn'), orbits: $('orbitsBtn'), hint: $('hint'), infoToggle: $('infoToggle'),
};

for (const b of bodies) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.innerHTML = `<span class="dot" style="--c:${b.def.color}"></span>${b.isComet ? 'Halley' : b.def.name}`;
  chip.addEventListener('click', () => focusOn(b));
  b.chip = chip;
  ui.chips.appendChild(chip);
}

function fmtDuration(sec) {
  if (sec < 1) return `${sec.toFixed(2)} s`;
  if (sec < 90) return `${sec.toFixed(sec < 10 ? 1 : 0)} s`;
  return `${(sec / 60).toFixed(1)} min`;
}

function syncUI() {
  ui.play.textContent = state.paused ? '▶' : '⏸';
  ui.play.setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
  const year = EARTH_YEAR_SECONDS / state.mult;
  ui.speedLabel.innerHTML = `1 Earth year = <b>${fmtDuration(year)}</b><br><small>Neptune: ${fmtDuration(year * Math.pow(30.07, 1.5))}</small>`;
  const focus = mode === 'focus';
  document.body.classList.toggle('focus', focus);
  ui.back.classList.toggle('hidden', !focus);
  ui.title.classList.toggle('hidden', focus);
  ui.info.classList.toggle('hidden', !focus);
  ui.labels.classList.toggle('on', state.labels);
  ui.orbits.classList.toggle('on', state.orbits);
  for (const b of bodies) {
    b.label.visible = state.labels && !focus;
    b.chip.classList.toggle('active', focused === b);
    if (b.orbit) b.orbit.visible = state.orbits;
  }
  beltLabels.forEach((l) => (l.visible = state.labels && !focus));
  document.querySelectorAll('[data-spin]').forEach((btn) => btn.classList.toggle('on', Number(btn.dataset.spin) === state.spinMult));
  if (focused) {
    const d = focused.def;
    ui.infoName.innerHTML = `<span class="dot" style="--c:${d.color}"></span>${d.name}${d.dwarf ? ' <small>dwarf planet</small>' : ''}`;
    ui.infoBlurb.textContent = d.blurb;
    ui.infoStats.innerHTML = Object.entries(d.stats).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    focused.chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function updateDate() {
  const ms = J2000_MS + state.simYears * YEAR_MS;
  const d = new Date(ms);
  const txt = Number.isNaN(d.getTime())
    ? `Year ${Math.round(2000 + state.simYears).toLocaleString()}`
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  ui.date.innerHTML = state.imaginary
    ? `${txt} <span class="tag">imaginary alignment</span>`
    : txt;
}

ui.play.addEventListener('click', () => { state.paused = !state.paused; syncUI(); });
ui.speed.addEventListener('input', () => { state.mult = Math.pow(10, Number(ui.speed.value)); syncUI(); });
$('alignUp').addEventListener('click', () => align(true));
$('alignDown').addEventListener('click', () => align(false));
$('nowBtn').addEventListener('click', backToNow);
ui.back.addEventListener('click', () => goOverview());
ui.labels.addEventListener('click', () => { state.labels = !state.labels; syncUI(); });
ui.orbits.addEventListener('click', () => { state.orbits = !state.orbits; syncUI(); });
ui.infoToggle.addEventListener('click', () => ui.info.classList.toggle('collapsed'));
document.querySelectorAll('[data-spin]').forEach((btn) =>
  btn.addEventListener('click', () => { state.spinMult = Number(btn.dataset.spin); syncUI(); }));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'focus') goOverview();
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); ui.play.click(); }
});
renderer.domElement.addEventListener('pointerdown', () => ui.hint.classList.add('gone'), { once: true });
setTimeout(() => ui.hint.classList.add('gone'), 8000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  if (mode === 'overview' && !flight) controls.maxDistance = overviewDistance() * 3;
});

// Hide labels that would overlap a more important one (e.g. the crowded inner planets when zoomed out).
const labelPriority = ['sun', 'earth', 'jupiter', 'saturn', 'mars', 'uranus', 'neptune', 'venus', 'mercury', 'pluto', 'halley'];
function declutterLabels() {
  if (!state.labels || mode === 'focus') return;
  const w = window.innerWidth, h = window.innerHeight;
  const placed = [];
  const items = [...bodies]
    .sort((a, b) => labelPriority.indexOf(a.def.id) - labelPriority.indexOf(b.def.id))
    .map((b) => ({ obj: b.label, pos: b.root.getWorldPosition(new THREE.Vector3()).add(b.label.position) }))
    .concat(beltLabels.map((l) => ({ obj: l, pos: l.position.clone() })));
  for (const it of items) {
    const el = it.obj.element;
    const p = it.pos.project(camera);
    const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
    const bw = el.offsetWidth || 60, bh = el.offsetHeight || 22;
    const box = { l: x - bw / 2, r: x + bw / 2, t: y - bh, b: y };
    const hit = placed.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
    el.classList.toggle('hidden-label', hit);
    if (!hit) placed.push(box);
  }
}

// ------------------------------------------------------------------ start
placeBodies();
camera.position.copy(overviewDir).multiplyScalar(overviewDistance() * 2.2).add(new THREE.Vector3(0, 300, 0));
camera.lookAt(0, 0, 0);
goOverview(3);
syncUI();

const clock = new THREE.Clock();
let dateTick = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now();
  update(dt, now);
  if (!updateFlight(now)) {
    followFocused();
    controls.update();
  }
  if ((dateTick += dt) > 0.1) { dateTick = 0; updateDate(); declutterLabels(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
