import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  DEG, SUN, PLANETS, HALLEY, scaleDist, EARTH_YEAR_SECONDS, EARTH_DAY_SECONDS, J2000_MS, YEAR_MS,
} from './data.js';
import { TAU, mod, solveKepler, positionFromE, meanAnomalyForLongitude } from './orbit.js';
import * as TX from './textures.js';
import {
  AU_PER_YEAR_KMS, hohmannYears, lambert, conic, propagate, speedAt, bestTransfer, fastestTransfer, bestWindow,
} from './transfer.js';

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
let timeJump = null; // fast-forward to a date: { from, to, t0, dur } in sim years / ms
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
    elReal: { ...el, a: def.a }, // same orbit in real AU, for rocket navigation
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

function advanceTime(dYears) {
  state.simYears += dYears;
  for (const b of orbiters) b.M += (TAU * dYears) / b.period;
  advanceRockets(dYears);
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
  } else if (timeJump) {
    const p = Math.min(1, (now - timeJump.t0) / timeJump.dur);
    advanceTime(timeJump.from + (timeJump.to - timeJump.from) * ease(p) - state.simYears);
    if (p >= 1) {
      timeJump = null;
      refreshEstimate();
    }
  } else if (!state.paused) {
    advanceTime((dt * state.mult) / EARTH_YEAR_SECONDS);
  }
  for (const belt of [asteroidBelt, kuiperBelt]) belt.rotation.y = (TAU * state.simYears) / belt.userData.period;

  placeBodies();
  placeRockets(now);

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
  if (mode !== 'focus' && isPhone()) setInfoCollapsed(true);
  mode = 'focus';
  focused = body;
  const r = body.def.radius;
  const viewR = body.isComet ? 4 : body.isRocket ? 1 : r * (body.def.rings ? body.def.rings.outer : 1.25);
  let dist = viewR * 3 + 1;
  if (camera.aspect < 1) dist /= Math.max(camera.aspect, 0.45) * 1.15;

  const pos = body.root.getWorldPosition(new THREE.Vector3());
  let dir;
  if (body.isSun) {
    dir = camera.position.clone().sub(controls.target).normalize();
  } else if (body.isRocket && body.phase === 'flying') {
    // chase view: behind the rocket and a little above
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(body.ship.getWorldQuaternion(new THREE.Quaternion()));
    dir = ahead.negate().addScaledVector(UP, 0.6).normalize();
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
  timeJump = null;
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
  tweenAnomalies(items, 3.5, replanRockets);

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
  jumpTo((Date.now() - J2000_MS) / YEAR_MS);
}

// Go to a date (in years since J2000). Forward from real positions, time fast-forwards so
// rockets keep flying, launching and landing on schedule. Backward, or out of an imaginary
// alignment, the planets glide to their real positions and rockets in flight correct course.
function jumpTo(years) {
  timeJump = null;
  const delta = years - state.simYears;
  if (!state.imaginary && delta >= 0) {
    if (delta > 1e-9) {
      const seconds = THREE.MathUtils.clamp(1 + 0.6 * Math.log2(1 + delta), 1, 4);
      timeJump = { from: state.simYears, to: years, t0: performance.now(), dur: seconds * 1000 };
    }
  } else {
    state.simYears = years;
    state.imaginary = false;
    const items = orbiters.map((b) => {
      const from = b.M;
      const target = realMeanAnomaly(b, state.simYears);
      const delta = mod(target - from + Math.PI, TAU) - Math.PI; // shortest way
      return { b, from, delta };
    });
    tweenAnomalies(items, 2.5, replanRockets);
  }
  syncUI();
}

// ------------------------------------------------------------------ rockets
// Rockets coast on real two-body orbits around the Sun, worked out in AU and years
// (see transfer.js), then drawn with the same distance compression as the planets.
const ROCKET_COLORS = ['#ff5d5d', '#ffd23d', '#5ee08a', '#4fb3ff', '#c48bff', '#ff9a3d'];
const TRAIL_SAMPLES = 360;
const PAD_LIFT = 0.04; // share of the trip spent rising off the launch pad
const rockets = [];
let rocketCount = 0;
const beaconTex = TX.dot();
const shipTarget = new THREE.Vector3(), padV = new THREE.Vector3();

// Planet `dt` years from now, in real AU: ecliptic position p = [X, Y], height h above
// the ecliptic, and velocity v (AU/year).
function physState(b, dt = 0) {
  const at = (t) => positionFromE(b.elReal, solveKepler(b.M + (TAU * t) / b.period, b.el.e), new THREE.Vector3());
  const q0 = at(dt), q1 = at(dt + 1e-5);
  return { p: [q0.x, -q0.z], h: q0.y, v: [(q1.x - q0.x) / 1e-5, (q0.z - q1.z) / 1e-5] };
}

// Same distance compression as the planets. Each planet's orbit is scaled by a single
// factor (scaleDist(a) / a), so `c` blends from the departure planet's factor to the
// target's and the path starts and ends exactly on them.
function toScene(p, h, c, out) {
  const r = Math.hypot(p[0], p[1], h);
  const k = (scaleDist(r) / r) * c;
  return out.set(p[0] * k, h * k, -p[1] * k);
}
function scaleFix(body, st) {
  const r = Math.hypot(st.p[0], st.p[1], st.h);
  return scaleDist(body.def.a) / body.def.a / (scaleDist(r) / r);
}

function legPhys(leg, t) {
  const s = t / leg.dur;
  return { p: propagate(leg.orbit, t), h: leg.h0 + (leg.h1 - leg.h0) * s, c: leg.c0 + (leg.c1 - leg.c0) * s };
}
function legScene(leg, t, out) {
  const q = legPhys(leg, t);
  return toScene(q.p, q.h, q.c, out);
}

// Cartoon rocket like a foil party balloon: egg-shaped body with a red nose, teal and
// red bands with rivets, four portholes and four puffy red fins. Modelled along +y.
const SHIP = { red: '#e3262f', white: '#f1f2f6', teal: '#2aa7ad', glass: '#3b2e86', rim: '#cfd3dc' };
const shipProfile = (() => {
  // body radius by height, smoothed through a few hand-placed points
  const curve = new THREE.SplineCurve([
    [0.16, -0.42], [0.21, -0.36], [0.245, -0.25], [0.26, -0.1], [0.255, 0.05],
    [0.235, 0.17], [0.2, 0.27], [0.15, 0.37], [0.085, 0.47], [0, 0.56],
  ].map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(200);
  return (y) => {
    const i = pts.findIndex((p) => p.y >= y);
    if (i <= 0) return pts[Math.max(i, 0)].x;
    const a = pts[i - 1], b = pts[i];
    return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
  };
})();

function buildShip() {
  const ship = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = Math.PI / 2; // modelled along +y; the ship faces +z for lookAt()
  ship.add(inner);
  const mats = {};
  const mat = (c) => (mats[c] ??= toon(null, { color: c }));
  const add = (geo, m) => {
    const mesh = new THREE.Mesh(geo, m);
    inner.add(mesh);
    return mesh;
  };
  const lathe = (y0, y1, scale = 1) => {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const y = y0 + ((y1 - y0) * k) / 24;
      pts.push(new THREE.Vector2(shipProfile(y) * scale, y));
    }
    return new THREE.LatheGeometry(pts, 40);
  };

  // body, bottom to tip, in painted bands
  for (const [y0, y1, c] of [
    [-0.42, -0.32, SHIP.teal], [-0.32, -0.26, SHIP.red], [-0.26, 0.18, SHIP.white],
    [0.18, 0.235, SHIP.teal], [0.235, 0.26, SHIP.white], [0.26, 0.56, SHIP.red],
  ]) add(lathe(y0, y1), mat(c));
  const outline = add(lathe(-0.42, 0.56, 1.06), new THREE.MeshBasicMaterial({ color: '#0b0b1a', side: THREE.BackSide }));
  outline.scale.y = 1.02;
  const base = add(new THREE.CircleGeometry(shipProfile(-0.42), 40), mat(SHIP.teal));
  base.rotation.x = Math.PI / 2;
  base.position.y = -0.42;
  add(new THREE.CylinderGeometry(0.08, 0.1, 0.07, 24), mat('#22868b')).position.y = -0.455;

  // rivets: a ring on the red band and another along the bottom of the nose
  const rivetRings = [[-0.29, 16], [0.3, 12]];
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), mat(SHIP.white), 28);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), out = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  let n = 0;
  for (const [y, count] of rivetRings) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU, r = shipProfile(y);
      out.set(Math.sin(a), 0, Math.cos(a));
      q.setFromUnitVectors(Z, out);
      m4.compose(out.clone().multiplyScalar(r).setY(y), q, new THREE.Vector3(1, 1, 0.45));
      rivets.setMatrixAt(n++, m4);
    }
  }
  inner.add(rivets);

  // four portholes, between the fins
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU, y = 0.02, r = shipProfile(y);
    const port = new THREE.Group();
    port.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    port.rotation.y = a;
    port.add(new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 8, 28), mat(SHIP.rim)));
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 12), mat(SHIP.glass));
    glass.scale.z = 0.25;
    port.add(glass);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat('#ffffff'));
    shine.position.set(-0.025, 0.025, 0.015);
    port.add(shine);
    inner.add(port);
  }

  // four puffy fins sweeping down past the base
  const fin = new THREE.Shape();
  fin.moveTo(0.18, -0.02);
  fin.quadraticCurveTo(0.42, -0.12, 0.43, -0.6);
  fin.quadraticCurveTo(0.35, -0.42, 0.18, -0.36);
  fin.lineTo(0.18, -0.02);
  const finGeo = new THREE.ExtrudeGeometry(fin, {
    depth: 0.03, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 4, curveSegments: 16,
  });
  finGeo.translate(0, 0, -0.015);
  for (let k = 0; k < 4; k++) add(k ? finGeo.clone() : finGeo, mat(SHIP.red)).rotation.y = Math.PI / 4 + (k * Math.PI) / 2;

  const flame = new THREE.Group();
  flame.position.y = -0.49;
  for (const [radius, len, c] of [[0.11, 0.5, '#ff9a3d'], [0.06, 0.32, '#fff3b0']]) {
    const g = new THREE.ConeGeometry(radius, len, 12);
    g.rotateX(Math.PI);
    g.translate(0, -len / 2, 0); // base at the nozzle, tip pointing away
    flame.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }
  inner.add(flame);
  return { ship, flame };
}

// Thick trail lines (plain WebGL lines are always 1 px). Shown up to `instanceCount` segments.
function trailLine(positions, opts) {
  const g = new LineGeometry();
  g.setPositions(positions);
  const line = new Line2(g, new LineMaterial({ transparent: true, ...opts }));
  if (opts.dashed) line.computeLineDistances();
  line.frustumCulled = false;
  g.instanceCount = 0;
  return line;
}

// One coasting arc. `start` = { h, c } where it begins; orbit from transfer.js conic().
function addLeg(r, start, orbit, h1, c1, dur) {
  const N = TRAIL_SAMPLES;
  const leg = { orbit, h0: start.h, h1, c0: start.c, c1, dur, k: -1 };
  leg.samples = new Float32Array((N + 1) * 3);
  for (let k = 0; k <= N; k++) legScene(leg, (dur * k) / N, tmpV).toArray(leg.samples, k * 3);
  // flown part: solid, its last segment ends at the rocket (see updateTrail)
  leg.flown = trailLine(leg.samples, { color: r.color, linewidth: 2.5, opacity: 0.95 });
  // part still ahead: dashed, stored back to front so it can be cut short from the far end
  const reversed = new Float32Array(leg.samples.length);
  for (let k = 0; k <= N; k++) reversed.set(leg.samples.subarray((N - k) * 3, (N - k + 1) * 3), k * 3);
  leg.ahead = trailLine(reversed, { color: r.color, linewidth: 1.6, opacity: 0.6, dashed: true, dashSize: 2, gapSize: 1.6 });
  r.trails.add(leg.flown, leg.ahead);
  r.legs.push(leg);
  r.leg = leg;
  r.t = 0;
}

function dropAhead(r, leg) {
  if (!leg.ahead) return;
  r.trails.remove(leg.ahead);
  leg.ahead.geometry.dispose();
  leg.ahead.material.dispose();
  leg.ahead = null;
}

function updateTrail(leg, t, pos) {
  const N = TRAIL_SAMPLES;
  const k = Math.min(N, Math.floor((t / leg.dur) * N)); // last sample behind the rocket
  const g = leg.flown.geometry;
  const buf = g.attributes.instanceStart.data; // per segment: start xyz, end xyz
  if (k !== leg.k) {
    // give the segment that ended at the rocket its real end point back
    if (leg.k >= 0 && leg.k < N) buf.array.set(leg.samples.subarray((leg.k + 1) * 3, (leg.k + 2) * 3), leg.k * 6 + 3);
    leg.k = k;
  }
  if (k < N) pos.toArray(buf.array, k * 6 + 3);
  buf.needsUpdate = true;
  g.instanceCount = k < N ? k + 1 : N;
  if (leg.ahead) leg.ahead.geometry.instanceCount = Math.max(0, N - k - 1);
}

// `budget`: Δv the trip may use; the rocket then flies the fastest trip within it.
// Without one it flies the cheapest trip.
function createRocket(rawName, from, to, delay, plannedYears, budget = Infinity) {
  rocketCount++;
  const name = rawName || `Rocket ${rocketCount}`;
  const color = ROCKET_COLORS[(rocketCount - 1) % ROCKET_COLORS.length];
  const root = new THREE.Group();
  const { ship, flame } = buildShip();
  root.add(ship);
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: beaconTex, color, transparent: true, depthWrite: false, sizeAttenuation: false,
  }));
  beacon.scale.setScalar(0.016); // a dot that stays visible when zoomed far out
  root.add(beacon);
  scene.add(root);
  const trails = new THREE.Group();
  scene.add(trails);
  const r = {
    isRocket: true, name, color, from, to, root, ship, flame, beacon, trails,
    def: { name, color, radius: 0.6 },
    phase: 'waiting', wait: delay, plannedYears, budget, legs: [], leg: null, t: 0, done: 0,
  };
  r.label = makeLabel(name, color, () => focusOn(r));
  r.label.position.set(0, 1.1, 0);
  root.add(r.label);
  rockets.push(r);
  if (delay <= 0) launchRocket(r);
  placeRockets(performance.now());
  renderFlights();
  syncUI();
}

// `ago`: how long ago (in years) the launch should have happened, when one time step
// overshoots it. The trip is planned from that moment and the rocket catches up.
function launchRocket(r, ago = 0) {
  const dep = physState(r.from, -ago);
  const arrAt = (t) => physState(r.to, t - ago), hohmann = hohmannYears(r.from.def.a, r.to.def.a);
  const plan = (r.budget < Infinity && fastestTransfer(dep, arrAt, hohmann, r.budget)) || bestTransfer(dep, arrAt, hohmann);
  if (!plan) {
    showToast(`${r.name} couldn't find a way to ${r.to.def.name}`);
    removeRocket(r);
    return;
  }
  r.phase = 'flying';
  addLeg(r, { h: dep.h, c: scaleFix(r.from, dep) }, plan.orbit, plan.arr.h, scaleFix(r.to, plan.arr), plan.tof);
  showToast(`🚀 ${r.name} launched from ${r.from.def.name}`);
  r.t = ago;
  if (r.t >= r.leg.dur) land(r);
  renderFlights();
}

function land(r) {
  r.phase = 'landed';
  r.t = r.leg.dur;
  updateTrail(r.leg, r.t, legScene(r.leg, r.t, tmpV));
  dropAhead(r, r.leg);
  r.root.visible = false;
  showToast(`🎉 ${r.name} landed on ${r.to.def.name}`);
  if (focused === r) focusOn(r.to);
  renderFlights();
  syncUI();
}

function removeRocket(r) {
  const i = rockets.indexOf(r);
  if (i < 0) return;
  rockets.splice(i, 1);
  r.label.element.remove();
  scene.remove(r.root, r.trails);
  for (const o of [r.root, r.trails]) {
    o.traverse((m) => {
      if (!m.isSprite) m.geometry?.dispose(); // sprites share one geometry
      m.material?.dispose();
    });
  }
  if (focused === r) goOverview();
  renderFlights();
}

function advanceRockets(dYears) {
  for (const r of [...rockets]) {
    if (r.phase === 'waiting') {
      r.wait -= dYears;
      if (r.wait <= 0) launchRocket(r, -r.wait);
    } else if (r.phase === 'flying') {
      r.t += dYears;
      if (r.t >= r.leg.dur) land(r);
    }
  }
}

const padOffset = (b) => padV.set(0, b.def.radius + 0.75, 0); // standing on the north pole

function placeRockets(now) {
  for (const r of rockets) {
    if (r.phase === 'landed') continue;
    if (r.phase === 'waiting') {
      r.root.position.copy(r.from.root.position).add(padOffset(r.from));
      r.ship.lookAt(shipTarget.copy(r.root.position).add(UP));
      r.flame.visible = false;
    } else {
      const leg = r.leg, step = leg.dur * 0.002;
      legScene(leg, r.t, r.root.position);
      updateTrail(leg, r.t, r.root.position);
      legScene(leg, r.t + step, shipTarget);
      if (r.legs.length === 1) {
        // ease up off the pad onto the transfer orbit
        const lift = (t) => Math.max(0, 1 - t / leg.dur / PAD_LIFT) ** 2;
        r.root.position.addScaledVector(padOffset(r.from), lift(r.t));
        shipTarget.addScaledVector(padOffset(r.from), lift(r.t + step));
      }
      r.ship.lookAt(shipTarget);
      r.flame.visible = true;
      r.flame.scale.set(1, 0.85 + 0.2 * Math.sin(now * 0.035 + r.legs.length + rockets.indexOf(r)), 1);
    }
    const d = camera.position.distanceTo(r.root.position);
    r.beacon.material.opacity = THREE.MathUtils.clamp((d - 15) / 30, 0, 1);
  }
}

// Align and Now move the planets in an instant. Rockets in flight then make a
// mid-course correction toward wherever their target will be.
function replanRockets() {
  for (const r of rockets) {
    if (r.phase !== 'flying') continue;
    const leg = r.leg, left = leg.dur - r.t;
    const target = physState(r.to, left).p, end = propagate(leg.orbit, leg.dur);
    if (Math.hypot(target[0] - end[0], target[1] - end[1]) < 1e-6) continue; // target didn't move
    const here = legPhys(leg, r.t);
    let tof = Math.max(left, 0.25 * hohmannYears(Math.hypot(...here.p), r.to.def.a));
    let arr = physState(r.to, tof), sol = lambert(here.p, arr.p, tof);
    for (let k = 0; k < 6 && !sol; k++) {
      tof *= 1.05;
      arr = physState(r.to, tof);
      sol = lambert(here.p, arr.p, tof);
    }
    if (!sol) continue;
    dropAhead(r, leg);
    r.done += r.t;
    addLeg(r, here, conic(here.p, sol.v1), arr.h, scaleFix(r.to, arr), tof);
  }
  windowCache = null; // the planets moved, so the next launch window did too
  refreshEstimate();
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
  for (const b of [...bodies, ...rockets.filter((r) => r.phase !== 'landed')]) {
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
  date: $('date'), back: $('backBtn'), title: $('title'), play: $('playBtn'),
  speed: $('speed'), speedLabel: $('speedLabel'), alignGroup: $('alignGroup'),
  info: $('info'), infoName: $('infoName'), infoBlurb: $('infoBlurb'), infoStats: $('infoStats'),
  chips: $('chips'), labels: $('labelsBtn'), orbits: $('orbitsBtn'), hint: $('hint'), infoToggle: $('infoToggle'),
  rockets: $('rockets'), rocketsBtn: $('rocketsBtn'), rkFrom: $('rkFrom'), rkTo: $('rkTo'), rkName: $('rkName'),
  rkEstimate: $('rkEstimate'), rkNow: $('rkNow'), rkWait: $('rkWait'), rkJump: $('rkJump'), flights: $('flights'),
  toast: $('toast'), dateBtn: $('dateBtn'), datePick: $('datePick'),
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
  ui.title.classList.toggle('hidden', focus); // the date stays, under the back button
  ui.info.classList.toggle('hidden', !focus);
  ui.labels.classList.toggle('on', state.labels);
  ui.orbits.classList.toggle('on', state.orbits);
  for (const b of bodies) {
    b.label.visible = state.labels && !focus;
    b.chip.classList.toggle('active', focused === b);
    if (b.orbit) b.orbit.visible = state.orbits;
  }
  for (const r of rockets) {
    r.label.visible = state.labels && !focus && r.phase !== 'landed';
    r.trails.visible = state.orbits;
  }
  beltLabels.forEach((l) => (l.visible = state.labels && !focus));
  ui.rocketsBtn.classList.toggle('on', !ui.rockets.classList.contains('hidden'));
  ui.info.classList.toggle('rocket', !!focused?.isRocket);
  document.querySelectorAll('[data-spin]').forEach((btn) => btn.classList.toggle('on', Number(btn.dataset.spin) === state.spinMult));
  if (focused?.isRocket) {
    rocketInfo();
  } else if (focused) {
    const d = focused.def;
    ui.infoName.innerHTML = `<span class="dot" style="--c:${d.color}"></span>${d.name}${d.dwarf ? ' <small>dwarf planet</small>' : ''}`;
    ui.infoBlurb.textContent = d.blurb;
    ui.infoStats.innerHTML = Object.entries(d.stats).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    focused.chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
ui.speed.addEventListener('input', () => { state.mult = Math.pow(10, Number(ui.speed.value)); syncUI(); refreshEstimate(); });
$('alignUp').addEventListener('click', () => align(true));
$('alignDown').addEventListener('click', () => align(false));
$('nowBtn').addEventListener('click', backToNow);
ui.back.addEventListener('click', () => goOverview());
ui.labels.addEventListener('click', () => { state.labels = !state.labels; syncUI(); });
ui.orbits.addEventListener('click', () => { state.orbits = !state.orbits; syncUI(); });
ui.infoToggle.addEventListener('click', () => setInfoCollapsed(!ui.info.classList.contains('collapsed')));

// Phones: the info card and the Rockets panel share the top of the screen, so only one is open.
const isPhone = () => window.innerWidth <= 640;
function setInfoCollapsed(collapsed) {
  ui.info.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('info-collapsed', collapsed);
  if (!collapsed && isPhone()) closeRockets();
}

// Panels size themselves to stop above the bottom controls, whose height changes with
// screen width and mode.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--bottom-h', `${$('bottom').offsetHeight}px`);
}).observe($('bottom'));
document.querySelectorAll('[data-spin]').forEach((btn) =>
  btn.addEventListener('click', () => { state.spinMult = Number(btn.dataset.spin); syncUI(); }));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'focus') goOverview();
  else if (e.key === 'Escape') closeRockets();
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); ui.play.click(); }
});
renderer.domElement.addEventListener('pointerdown', () => ui.hint.classList.add('gone'), { once: true });
setTimeout(() => ui.hint.classList.add('gone'), 8000);

// ------------------------------------------------------------------ rockets UI
function fmtYears(y) {
  const days = y * 365.25;
  if (days < 1) return 'under a day';
  if (days < 730) return `${Math.round(days)} days`;
  return `${y.toFixed(1)} years`;
}
const route = (r) => `${r.from.def.name} → ${r.to.def.name}`;

let toastTimer;
function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3500);
}

function rocketInfo() {
  const r = focused;
  ui.infoName.innerHTML = `<span class="dot" style="--c:${r.color}"></span><span></span> <small>rocket</small>`;
  ui.infoName.children[1].textContent = r.name;
  const stats = { Route: route(r) };
  if (r.phase === 'waiting') {
    ui.infoBlurb.textContent = `Waiting on ${r.from.def.name} for the next launch window, when the planets line up for the cheapest trip to ${r.to.def.name}.`;
    stats['Launch in'] = fmtYears(r.wait);
    stats.Trip = fmtYears(r.plannedYears);
  } else {
    const q = legPhys(r.leg, r.t);
    ui.infoBlurb.textContent = `Coasting to ${r.to.def.name} on a transfer orbit, steered only by the Sun's gravity. It left ${r.from.def.name} with just the right speed to meet ${r.to.def.name} on arrival.`;
    stats['Arrives in'] = fmtYears(r.leg.dur - r.t);
    stats.Speed = `${(speedAt(r.leg.orbit, Math.hypot(...q.p)) * AU_PER_YEAR_KMS).toFixed(1)} km/s`;
    stats['From the Sun'] = `${Math.hypot(...q.p, q.h).toFixed(2)} AU`;
  }
  ui.infoStats.innerHTML = Object.entries(stats).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderFlights() {
  ui.flights.replaceChildren(...rockets.map((r) => {
    const li = document.createElement('li');
    li.className = 'flight';
    li.style.setProperty('--c', r.color);
    li.innerHTML = '<button class="go"><b><span class="dot"></span><span></span></b><small></small>'
      + '<span class="bar"><i></i></span></button><button class="x" aria-label="Remove rocket">×</button>';
    li.querySelector('b span:last-child').textContent = r.name;
    li.querySelector('.go').addEventListener('click', () => focusOn(r.phase === 'landed' ? r.to : r));
    li.querySelector('.x').addEventListener('click', () => removeRocket(r));
    r.listItem = li;
    return li;
  }));
  updateFlights();
}

function updateFlights() {
  for (const r of rockets) {
    let text, frac;
    if (r.phase === 'waiting') {
      text = `${route(r)} · launches in ${fmtYears(r.wait)}`;
      frac = 0;
    } else if (r.phase === 'flying') {
      text = `${route(r)} · ${fmtYears(r.leg.dur - r.t)} to go`;
      frac = (r.done + r.t) / (r.done + r.leg.dur);
    } else {
      text = `Landed on ${r.to.def.name}`;
      frac = 1;
    }
    r.listItem.querySelector('small').textContent = text;
    r.listItem.querySelector('.bar i').style.width = `${(frac * 100).toFixed(1)}%`;
  }
}

for (const sel of [ui.rkFrom, ui.rkTo]) {
  sel.innerHTML = planetBodies.map((b, i) => `<option value="${i}">${b.def.name}</option>`).join('');
  sel.addEventListener('change', refreshEstimate);
}
ui.rkFrom.value = String(planetBodies.findIndex((b) => b.def.id === 'earth'));
ui.rkTo.value = String(planetBodies.findIndex((b) => b.def.id === 'mars'));
let estimate = null, windowCache = null;

// The window search is the slow part, so keep its result (as an absolute date) until it's
// reached, the planets change, or another pair is picked.
// `budget` is what leaving now costs: the window is the fastest trip on that much fuel.
function findWindow(from, to, hohmann, budget) {
  const c = windowCache;
  if (c && c.from === from && c.to === to && c.at > state.simYears) return c;
  const synodic = 1 / Math.abs(1 / from.period - 1 / to.period); // how often the alignment repeats
  const win = bestWindow((d) => physState(from, d), (t) => physState(to, t), hohmann, Math.min(synodic, 20), budget);
  windowCache = win && { from, to, budget, at: state.simYears + win.delay, tof: win.tof, dv: win.dv };
  return windowCache;
}

// Trip options for the chosen planets: leave now on the cheapest trip, or wait for the
// window where the same fuel (or less) gets there fastest.
function refreshEstimate() {
  if (ui.rockets.classList.contains('hidden') || anomalyTween || timeJump) return;
  ui.rkName.placeholder = `Rocket ${rocketCount + 1}`;
  const from = planetBodies[ui.rkFrom.value], to = planetBodies[ui.rkTo.value];
  estimate = null;
  ui.rkNow.disabled = ui.rkWait.disabled = ui.rkJump.disabled = true;
  if (from === to) {
    ui.rkEstimate.textContent = 'Pick two different planets.';
    return;
  }
  const hohmann = hohmannYears(from.def.a, to.def.a);
  const now = bestTransfer(physState(from), (t) => physState(to, t), hohmann);
  if (!now) {
    ui.rkEstimate.textContent = 'No path found right now.';
    return;
  }
  const win = findWindow(from, to, hohmann, now.cost);
  const wait = win ? win.at - state.simYears : 0;
  const worthWaiting = win && wait > 1 / 365.25 && (win.tof < now.tof * 0.9 || win.dv < now.dv * 0.9);
  const dv = (p) => `<span title="Change in speed the rocket needs: lower means less fuel">Δv</span> ${(p.dv * AU_PER_YEAR_KMS).toFixed(1)} km/s`;
  ui.rkEstimate.innerHTML = `Now: <b>${fmtYears(now.tof)}</b> trip · ${dv(now)}<br>`
    + (worthWaiting
      ? `Window in ${fmtYears(wait)}: <b>${fmtYears(win.tof)}</b> trip · ${dv(win)}<br>`
      : 'Now is a good launch window.<br>')
    + `<small>At this speed, ${fmtYears(now.tof)} pass in ${fmtDuration((now.tof * EARTH_YEAR_SECONDS) / state.mult)}.</small>`;
  estimate = { from, to, now, win: worthWaiting ? win : null };
  ui.rkNow.disabled = false;
  ui.rkWait.disabled = !worthWaiting;
  // after Align the planets aren't where the calendar says, so a jump would land elsewhere
  ui.rkJump.disabled = !worthWaiting || state.imaginary;
}

function launchFromForm(wait) {
  refreshEstimate(); // fresh numbers for this exact moment
  if (!estimate || (wait && !estimate.win)) return null;
  const name = ui.rkName.value.trim().slice(0, 24), { from, to, now, win } = estimate;
  if (wait) createRocket(name, from, to, win.at - state.simYears, win.tof, win.budget);
  else createRocket(name, from, to, 0, now.tof);
  ui.rkName.value = '';
  refreshEstimate();
  return estimate;
}

function openRockets() {
  if (planetBodies.includes(focused)) {
    const i = planetBodies.indexOf(focused);
    ui.rkFrom.value = String(i);
    if (ui.rkTo.value === ui.rkFrom.value) ui.rkTo.value = String((i + 1) % planetBodies.length);
  }
  ui.rockets.classList.remove('hidden');
  ui.hint.classList.add('gone');
  if (isPhone()) setInfoCollapsed(true);
  refreshEstimate();
  syncUI();
}
function closeRockets() {
  ui.rockets.classList.add('hidden');
  syncUI();
}

ui.rocketsBtn.addEventListener('click', () => (ui.rockets.classList.contains('hidden') ? openRockets() : closeRockets()));
$('rocketsClose').addEventListener('click', closeRockets);
$('launchForm').addEventListener('submit', (e) => { e.preventDefault(); launchFromForm(false); });
ui.rkWait.addEventListener('click', () => launchFromForm(true));
// queue the rocket for the window, then skip ahead so it launches right away
ui.rkJump.addEventListener('click', () => {
  refreshEstimate();
  const win = estimate?.win;
  if (win && !state.imaginary && launchFromForm(true)) jumpTo(win.at);
});

// date picker: pick a day and the whole solar system travels there
const isoDate = (years) => new Date(J2000_MS + years * YEAR_MS).toISOString().slice(0, 10);
ui.dateBtn.addEventListener('click', () => {
  const d = isoDate(state.simYears);
  ui.datePick.value = d >= ui.datePick.min && d <= ui.datePick.max ? d : '';
  try {
    ui.datePick.showPicker();
  } catch {
    ui.datePick.focus();
    ui.datePick.click();
  }
});
ui.datePick.addEventListener('change', () => {
  const [y, m, d] = ui.datePick.value.split('-').map(Number);
  if (!y || ui.datePick.value < ui.datePick.min || ui.datePick.value > ui.datePick.max) return;
  const ms = new Date(Date.UTC(2000, m - 1, d, 12)).setUTCFullYear(y); // setUTCFullYear keeps years < 100 literal
  jumpTo((ms - J2000_MS) / YEAR_MS);
});

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
    .concat(rockets.filter((r) => r.phase !== 'landed'))
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
let dateTick = 0, estimateTick = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now();
  update(dt, now);
  if (!updateFlight(now)) {
    followFocused();
    controls.update();
  }
  if ((dateTick += dt) > 0.1) {
    dateTick = 0;
    updateDate();
    declutterLabels();
    updateFlights();
    if (focused?.isRocket) rocketInfo();
  }
  if ((estimateTick += dt) > 1) { estimateTick = 0; refreshEstimate(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
