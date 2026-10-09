// Hand-"painted" cartoon textures, drawn procedurally on canvases as
// equirectangular maps (longitude across, latitude down).
import * as THREE from 'three';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

function finish(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

class Painter {
  constructor(w, h, seed = 1) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.k = w / 1024; // sizes below are authored for a 1024-wide map
    this.rand = rng(seed);
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rand(); }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
  x(lon) { return ((lon + 180) / 360) * this.w; }
  y(lat) { return ((90 - lat) / 180) * this.h; }
  // Equirectangular maps squash features near the poles; stretch to compensate.
  stretch(lat) { return 1 / Math.max(Math.cos(lat * DEG), 0.3); }

  fill(color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }
  vgrad(stops) {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.h);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    this.fill(g);
  }
  // Draw three times so features crossing the 180° seam wrap seamlessly.
  wrap(fn) {
    for (const dx of [-this.w, 0, this.w]) {
      this.ctx.save();
      this.ctx.translate(dx, 0);
      fn(this.ctx);
      this.ctx.restore();
    }
  }
  blob(lon, lat, rx, ry, color, { jag = 0.3, n = 12, stroke, lw = 3, alpha = 1 } = {}) {
    const cx = this.x(lon), cy = this.y(lat), s = this.stretch(lat);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const m = 1 + (this.rand() * 2 - 1) * jag;
      pts.push([cx + Math.cos(a) * rx * this.k * s * m, cy + Math.sin(a) * ry * this.k * m]);
    }
    this.wrap((ctx) => {
      ctx.globalAlpha = alpha;
      smoothClosed(ctx, pts);
      ctx.fillStyle = color;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw * this.k; ctx.stroke(); }
    });
  }
  poly(lonlat, fill, stroke, lw = 3) {
    const pts = lonlat.map(([lon, lat]) => [this.x(lon), this.y(lat)]);
    this.wrap((ctx) => {
      smoothClosed(ctx, pts);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw * this.k; ctx.lineJoin = 'round'; ctx.stroke(); }
    });
  }
  speckle(colors, count, rmin, rmax, { alpha = 1, latMax = 82, jag = 0.25 } = {}) {
    for (let i = 0; i < count; i++) {
      const rad = this.r(rmin, rmax);
      this.blob(this.r(-180, 180), this.r(-latMax, latMax), rad, rad, this.pick(colors), { jag, n: 8, alpha });
    }
  }
  crater(lon, lat, rad, { floor = 'rgba(0,0,0,0.16)', rim = 'rgba(40,30,30,0.45)', light = 'rgba(255,255,255,0.45)' } = {}) {
    const cx = this.x(lon), cy = this.y(lat), s = this.stretch(lat), R = rad * this.k;
    this.wrap((ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, 1);
      ctx.fillStyle = floor;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, R * 0.16);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = light; ctx.lineWidth = Math.max(1, R * 0.14);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0.05 * Math.PI, 0.65 * Math.PI); ctx.stroke();
      ctx.restore();
    });
  }
  craters(count, rmin, rmax, opts) {
    for (let i = 0; i < count; i++) {
      // bias toward small craters
      const rad = rmin + (rmax - rmin) * Math.pow(this.rand(), 2.5);
      this.crater(this.r(-180, 180), this.r(-70, 70), rad, opts);
    }
  }
  // Wavy horizontal cloud bands. list = [[topLatitude, color], ...] north -> south.
  bands(list, amp = 5) {
    const { ctx, w, h } = this;
    for (const [lat, color] of list) {
      const f1 = 2 + Math.floor(this.r(0, 4)), f2 = 7 + Math.floor(this.r(0, 6));
      const p1 = this.r(0, TAU), p2 = this.r(0, TAU);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        const y = this.y(lat) + amp * this.k * (Math.sin((TAU * f1 * x) / w + p1) * 0.7 + Math.sin((TAU * f2 * x) / w + p2) * 0.3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  // Short wavy strokes, like wind-blown cloud streaks.
  streaks(colors, count, latMin, latMax, { lw = [2, 6], len = [60, 260], amp = 4, alpha = 0.6 } = {}) {
    for (let i = 0; i < count; i++) {
      const lat = this.r(latMin, latMax);
      const x0 = this.x(this.r(-180, 180)), y0 = this.y(lat);
      const L = this.r(len[0], len[1]) * this.k, A = this.r(1, amp) * this.k;
      const f = this.r(1, 3), ph = this.r(0, TAU);
      const color = this.pick(colors), width = this.r(lw[0], lw[1]) * this.k;
      this.wrap((ctx) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const x = x0 + t * L, y = y0 + Math.sin(t * TAU * f + ph) * A;
          t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }
  }
  oval(lon, lat, rx, ry, layers) {
    // concentric ellipses: layers = [[scale, color], ...] outer -> inner
    const cx = this.x(lon), cy = this.y(lat);
    this.wrap((ctx) => {
      for (const [s, color] of layers) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * s * this.k, ry * s * this.k, 0, 0, TAU);
        ctx.fill();
      }
    });
  }
  polarCap(latEdge, color, north = true, wobble = 3) {
    const { ctx, w } = this;
    const yEdge = this.y(latEdge), yPole = north ? -10 : this.h + 10;
    const p = this.r(0, TAU);
    ctx.beginPath();
    ctx.moveTo(0, yPole);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, yEdge + Math.sin((x / w) * TAU * 6 + p) * wobble * this.k + Math.sin((x / w) * TAU * 13) * wobble * 0.5 * this.k);
    }
    ctx.lineTo(w, yPole);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  texture() { return finish(this.canvas); }
}

const PW = 2048, PH = 1024; // planet map size

// ---------------------------------------------------------------- Sun
export function sun() {
  const p = new Painter(1024, 512, 7);
  p.fill('#ffae1a');
  p.speckle(['#ffc93c', '#ff9a12', '#ffd75e', '#ffb726'], 900, 4, 13, { alpha: 0.9 });
  for (let i = 0; i < 6; i++) {
    const lon = p.r(-180, 180), lat = p.r(-30, 30);
    p.blob(lon, lat, 16, 12, '#e86f00', { jag: 0.3 });
    p.blob(lon, lat, 8, 6, '#a63d00', { jag: 0.3 });
  }
  return p.texture();
}

// ---------------------------------------------------------------- Mercury
export function mercury() {
  const p = new Painter(PW, PH, 11);
  p.fill('#a9a29a');
  p.speckle(['#968f87', '#bab3ab', '#8c857e'], 160, 20, 60, { alpha: 0.6, jag: 0.4 });
  // Caloris Basin
  p.crater(160, 30, 70, { floor: 'rgba(200,180,150,0.35)' });
  p.craters(260, 4, 34);
  // bright rayed crater
  const cx = p.x(-30), cy = p.y(-20);
  p.wrap((ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3 * p.k;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + p.r(0, 0.3), L = p.r(40, 110) * p.k;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.stroke();
    }
  });
  p.crater(-30, -20, 12, { floor: 'rgba(255,255,255,0.4)' });
  return p.texture();
}

// ---------------------------------------------------------------- Venus
export function venus() {
  const p = new Painter(PW, PH, 23);
  p.vgrad([[0, '#f3d79e'], [0.5, '#e8bd6a'], [1, '#f1d297']]);
  p.bands([[60, '#efcd88'], [35, '#e4b562'], [15, '#ecc678'], [-10, '#dcaa55'], [-35, '#e9c47a'], [-60, '#f0d394']], 14);
  // swirly "Y"-shaped cloud streams
  p.streaks(['#fff0c8', '#fbe2a8'], 90, -70, 70, { lw: [8, 22], len: [200, 600], amp: 18, alpha: 0.55 });
  p.streaks(['#c4914a', '#cf9d55'], 60, -60, 60, { lw: [6, 16], len: [150, 450], amp: 14, alpha: 0.45 });
  p.speckle(['#fff3d1'], 40, 12, 30, { alpha: 0.35, jag: 0.4 });
  return p.texture();
}

// ---------------------------------------------------------------- Earth
const CONTINENTS = {
  northAmerica: [[-168, 65], [-160, 71], [-140, 70], [-120, 72], [-95, 72], [-82, 68], [-62, 60], [-55, 52], [-66, 45], [-75, 38], [-81, 31], [-80, 25], [-84, 30], [-90, 29], [-97, 27], [-97, 20], [-88, 21], [-87, 15], [-83, 10], [-78, 8], [-80, 7], [-92, 14], [-105, 20], [-112, 30], [-117, 33], [-124, 40], [-124, 48], [-135, 58], [-150, 60], [-165, 60]],
  southAmerica: [[-78, 8], [-72, 12], [-62, 10], [-50, 0], [-35, -6], [-38, -15], [-48, -25], [-58, -35], [-65, -42], [-68, -52], [-73, -53], [-74, -45], [-72, -30], [-71, -18], [-76, -12], [-81, -5], [-80, 1]],
  africa: [[-17, 15], [-17, 21], [-10, 30], [-5, 36], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 12], [42, -2], [40, -15], [35, -25], [27, -34], [18, -34], [12, -18], [13, -5], [9, 4], [-8, 5], [-15, 10]],
  eurasia: [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [0, 50], [5, 54], [10, 58], [5, 62], [15, 69], [25, 71], [40, 68], [60, 70], [80, 73], [100, 77], [115, 74], [140, 72], [170, 70], [180, 67], [178, 63], [160, 60], [155, 58], [140, 53], [135, 43], [127, 38], [122, 40], [121, 31], [110, 20], [106, 10], [100, 13], [98, 8], [103, 1], [100, 6], [98, 16], [92, 22], [80, 15], [77, 8], [72, 20], [66, 25], [57, 26], [56, 24], [59, 22], [52, 16], [44, 12], [38, 22], [35, 28], [33, 31], [36, 36], [27, 37], [26, 40], [20, 40], [16, 38], [12, 44], [8, 44], [3, 43], [-9, 37]],
  australia: [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [140, -38], [131, -31], [116, -35], [114, -28]],
  greenland: [[-55, 60], [-43, 60], [-20, 70], [-18, 80], [-35, 83], [-60, 82], [-73, 78], [-55, 70]],
  uk: [[-5, 50], [2, 52], [-2, 58], [-6, 57]],
  madagascar: [[44, -25], [50, -15], [49, -12], [47, -25]],
  japan: [[130, 32], [136, 34], [141, 37], [142, 44], [140, 42], [135, 35]],
  borneo: [[109, 1], [117, 7], [119, 1], [116, -4], [110, -3]],
  sumatra: [[95, 5], [100, 2], [106, -6], [104, -5], [97, 1]],
  newGuinea: [[131, -1], [141, -3], [150, -10], [141, -9], [134, -4]],
  newZealand: [[172, -34], [178, -38], [174, -42], [167, -46], [171, -41]],
};

export function earth() {
  const p = new Painter(PW, PH, 3);
  p.vgrad([[0, '#2a6fc9'], [0.5, '#2f8ae6'], [1, '#2a6fc9']]);
  // shallow-water halo around land
  for (const pts of Object.values(CONTINENTS)) p.poly(pts, '#4fa8f0', '#4fa8f0', 18);
  for (const pts of Object.values(CONTINENTS)) p.poly(pts, '#58b947', '#2f7d2a', 4);
  // deserts & forests
  p.blob(12, 22, 90, 35, '#e3c27a', { jag: 0.2 }); // Sahara
  p.blob(45, 24, 35, 18, '#e3c27a', { jag: 0.2 }); // Arabia
  p.blob(130, -25, 40, 20, '#d9a85f', { jag: 0.25 }); // Outback
  p.blob(-112, 37, 18, 12, '#d9b170', { jag: 0.3 }); // US southwest
  p.blob(-62, -6, 45, 25, '#3f9a36', { jag: 0.3 }); // Amazon
  p.blob(22, 0, 30, 18, '#3f9a36', { jag: 0.3 }); // Congo
  p.blob(95, 58, 90, 18, '#4aa83f', { jag: 0.3 }); // Siberian taiga
  p.blob(-100, 55, 55, 14, '#4aa83f', { jag: 0.3 }); // Canadian forest
  p.blob(85, 33, 40, 14, '#a68c6a', { jag: 0.3 }); // Himalaya/Tibet
  // Antarctica & Arctic ice
  const ant = [];
  for (let lon = -180; lon <= 180; lon += 12) ant.push([lon, -68 + p.r(-4, 4)]);
  ant.push([180, -95], [-180, -95]);
  p.poly(ant, '#f4fbff', '#cfe6f5', 3);
  p.polarCap(80, '#f4fbff', true, 4);
  return p.texture();
}

export function earthClouds() {
  const p = new Painter(PW, PH, 5);
  const puff = (lon, lat, size) => {
    for (let i = 0; i < 6; i++) {
      p.blob(lon + p.r(-1.2, 1.2) * size / 6, lat + p.r(-0.6, 0.6) * size / 12, size * p.r(0.5, 1), size * p.r(0.25, 0.45), 'rgba(255,255,255,0.85)', { jag: 0.2, n: 10 });
    }
  };
  for (let i = 0; i < 32; i++) puff(p.r(-180, 180), p.pick([p.r(-62, -40), p.r(40, 65), p.r(-10, 10)]), p.r(14, 34));
  // a cartoon hurricane
  const cx = p.x(-60), cy = p.y(22);
  p.wrap((ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineCap = 'round';
    for (let arm = 0; arm < 3; arm++) {
      ctx.lineWidth = 9 * p.k;
      ctx.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = arm * (TAU / 3) + t * 5, rr = t * 55 * p.k;
        const x = cx + Math.cos(a) * rr * 1.1, y = cy + Math.sin(a) * rr;
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  return p.texture();
}

// ---------------------------------------------------------------- Mars
export function mars() {
  const p = new Painter(PW, PH, 17);
  p.fill('#c9592b');
  p.speckle(['#d66d39', '#b84c22', '#db7a45'], 140, 20, 70, { alpha: 0.6, jag: 0.4 });
  // dark albedo regions
  const dark = '#8a3a1c';
  p.blob(70, 10, 40, 45, dark, { jag: 0.4 }); // Syrtis Major
  p.blob(-30, 45, 60, 18, dark, { jag: 0.4 }); // Acidalia
  p.blob(0, -5, 60, 12, dark, { jag: 0.4 }); // Meridiani
  p.blob(-40, -25, 70, 16, dark, { jag: 0.4 }); // Erythraeum
  p.blob(145, -20, 70, 16, dark, { jag: 0.4 }); // Cimmerium
  p.blob(100, -35, 50, 12, dark, { jag: 0.4 });
  // Valles Marineris: a big jagged canyon
  p.wrap((ctx) => {
    const pts = [];
    for (let lon = -112; lon <= -40; lon += 3) pts.push([p.x(lon), p.y(-9 + Math.sin(lon * 0.4) * 1.2 + p.r(-0.8, 0.8))]);
    for (const [col, lw] of [['#f0a070', 16], ['#5e2410', 10], ['#3b1508', 4]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw * p.k; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
  });
  // Olympus Mons and the Tharsis volcanoes
  p.oval(-134, 18, 34, 34, [[1, '#a8441c'], [0.8, '#de7d47'], [0.55, '#eea06c'], [0.22, '#7a2c10']]);
  for (const [lon, lat] of [[-121, 1], [-113, -9], [-102, 12]]) p.oval(lon, lat, 14, 14, [[1, '#a8441c'], [0.75, '#e08550'], [0.3, '#7a2c10']]);
  p.craters(90, 4, 22);
  p.polarCap(76, '#fbf6f0', true, 5);
  p.polarCap(-80, '#fbf6f0', false, 4);
  return p.texture();
}

// ---------------------------------------------------------------- Jupiter
export function jupiter() {
  const p = new Painter(PW, PH, 29);
  p.bands([
    [90, '#c9b08c'], [62, '#d8c09a'], [48, '#efe0c4'], [38, '#b98256'], [28, '#f4e8d2'],
    [19, '#a7633a'], [9, '#f7eedc'], [-4, '#e6cba3'], [-11, '#a7633a'], [-19, '#f2e3c8'],
    [-30, '#c48f62'], [-40, '#ede0c8'], [-52, '#c9ab84'], [-66, '#d4bf9e'],
  ], 6);
  p.streaks(['#ffffff', '#fff6e6'], 110, -45, 45, { lw: [2, 6], len: [80, 300], amp: 5, alpha: 0.45 });
  p.streaks(['#8e4f2b', '#9d5c35'], 70, -35, 35, { lw: [2, 5], len: [60, 220], amp: 4, alpha: 0.45 });
  // Great Red Spot
  p.oval(-20, -22, 78, 36, [[1, '#f6e4c8'], [0.88, '#d8673a'], [0.68, '#c4482a'], [0.4, '#d35c36'], [0.18, '#b33a22']]);
  p.wrap((ctx) => {
    ctx.strokeStyle = 'rgba(255,240,220,0.6)'; ctx.lineWidth = 3 * p.k;
    ctx.beginPath(); ctx.ellipse(p.x(-20), p.y(-22), 50 * p.k, 22 * p.k, 0, 0.3, 4.5); ctx.stroke();
  });
  // "string of pearls" white ovals
  for (let i = 0; i < 7; i++) p.oval(-160 + i * 45, -40, 14, 8, [[1, '#d9c3a0'], [0.8, '#ffffff']]);
  return p.texture();
}

// ---------------------------------------------------------------- Saturn
export function saturn() {
  const p = new Painter(PW, PH, 31);
  p.bands([
    [90, '#b8a274'], [72, '#d9c18a'], [58, '#efdcaa'], [44, '#d7b97c'], [30, '#f3e3b8'],
    [16, '#e2c58b'], [5, '#f7ead0'], [-10, '#e6cc95'], [-24, '#f2e1b4'], [-40, '#d6b97f'],
    [-56, '#e9d5a3'], [-72, '#c9b07c'],
  ], 4);
  p.streaks(['#fff6dc'], 60, -50, 50, { lw: [2, 5], len: [120, 400], amp: 3, alpha: 0.4 });
  // North-pole hexagon
  const { ctx, w } = p;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  for (let x = 0; x <= w; x += 4) {
    const t = ((x / w) * 6) % 1; // six sides
    ctx.lineTo(x, p.y(76 + Math.abs(t - 0.5) * 6));
  }
  ctx.lineTo(w, -5);
  ctx.closePath();
  ctx.fillStyle = '#9fa6a0';
  ctx.fill();
  ctx.strokeStyle = '#7d8580'; ctx.lineWidth = 4 * p.k; ctx.stroke();
  return p.texture();
}

function ringTexture(stops, seed) {
  // 1-D radial texture: x = inner -> outer edge. stops: [start, end, color, alpha]
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 4;
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  for (const [a, b, color, alpha] of stops) {
    for (let x = Math.floor(a * 1024); x < b * 1024; x++) {
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha * (0.8 + rand() * 0.35)));
      ctx.fillStyle = color;
      ctx.fillRect(x, 0, 1, 4);
    }
  }
  return finish(c);
}

// Radial positions are fractions of the ring's span (inner..outer).
export const saturnRings = () => ringTexture([
  [0.0, 0.25, '#9c8c6c', 0.3], // C ring
  [0.25, 0.62, '#efdcae', 0.95], // B ring
  [0.62, 0.69, '#5a4d3a', 0.08], // Cassini division
  [0.69, 0.88, '#dcc89a', 0.85], // A ring
  [0.88, 0.9, '#5a4d3a', 0.1], // Encke gap
  [0.9, 0.95, '#d6c294', 0.8],
  [0.97, 0.99, '#e8d8b0', 0.6], // F ring
], 4);

export const uranusRings = () => ringTexture([
  [0.1, 0.14, '#cfeff2', 0.5], [0.35, 0.38, '#cfeff2', 0.45], [0.6, 0.63, '#cfeff2', 0.5], [0.92, 1.0, '#e6fbff', 0.8],
], 5);

export const neptuneRings = () => ringTexture([
  [0.1, 0.14, '#b9c6ff', 0.25], [0.55, 0.58, '#b9c6ff', 0.3], [0.94, 0.98, '#c9d4ff', 0.45],
], 6);

// ---------------------------------------------------------------- Uranus
export function uranus() {
  const p = new Painter(PW, PH, 37);
  p.bands([[90, '#c8f4f6'], [65, '#a8e8ee'], [35, '#98e0e8'], [10, '#9ee3ea'], [-20, '#94dce4'], [-50, '#8ed6df'], [-70, '#a2e2e9']], 3);
  p.streaks(['#d7fbfd'], 40, -60, 60, { lw: [3, 7], len: [150, 500], amp: 3, alpha: 0.4 });
  p.oval(40, 30, 16, 9, [[1, '#e8feff']]);
  return p.texture();
}

// ---------------------------------------------------------------- Neptune
export function neptune() {
  const p = new Painter(PW, PH, 41);
  p.bands([[90, '#3554c4'], [60, '#3d61d8'], [30, '#4369e2'], [5, '#3f64dc'], [-15, '#4870e6'], [-40, '#3b5fd3'], [-65, '#3452c2']], 6);
  p.streaks(['#6a8cf5', '#5b7ef0'], 50, -60, 60, { lw: [4, 10], len: [150, 500], amp: 5, alpha: 0.5 });
  // Great Dark Spot with bright companion clouds
  p.oval(30, -20, 58, 28, [[1, '#2a3fa8'], [0.75, '#1d2b80'], [0.4, '#16226a']]);
  const white = 'rgba(255,255,255,0.92)';
  p.blob(36, -29, 40, 6, white, { jag: 0.15, n: 10 });
  p.blob(-10, -14, 26, 5, white, { jag: 0.2, n: 10 });
  p.blob(-80, -42, 22, 8, white, { jag: 0.2, n: 10 }); // "Scooter"
  p.oval(-120, -55, 18, 10, [[1, '#2a3fa8'], [0.5, '#e8f0ff']]); // small dark spot
  p.streaks(['#ffffff'], 25, -50, 40, { lw: [2, 5], len: [40, 140], amp: 2, alpha: 0.75 });
  return p.texture();
}

// ---------------------------------------------------------------- Pluto
export function pluto() {
  const p = new Painter(1024, 512, 43);
  p.fill('#c9a07a');
  p.speckle(['#b88c66', '#d9b48d', '#a87c58'], 80, 10, 40, { alpha: 0.6, jag: 0.4 });
  // Cthulhu Macula - dark reddish whale along the equator
  p.blob(-150, -8, 110, 22, '#5c2f1c', { jag: 0.3, n: 16 });
  p.blob(-110, -15, 40, 18, '#6a3722', { jag: 0.3 });
  // Tombaugh Regio: the heart
  const cx = p.x(-60), cy = p.y(12), s = 1.7;
  p.wrap((ctx) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, 1.35);
    ctx.beginPath();
    ctx.moveTo(0, 50);
    ctx.bezierCurveTo(-75, 5, -70, -55, -32, -55);
    ctx.bezierCurveTo(-12, -55, -2, -42, 0, -28);
    ctx.bezierCurveTo(2, -42, 12, -55, 32, -55);
    ctx.bezierCurveTo(70, -55, 75, 5, 0, 50);
    ctx.closePath();
    ctx.fillStyle = '#fbf3e6';
    ctx.fill();
    ctx.strokeStyle = '#e8d6bd';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  });
  p.polarCap(70, '#e6d2c0', true, 3);
  return p.texture();
}

// ---------------------------------------------------------------- Moons
function moonBase(base, spots, seed, { craters = 40, spotCount = 30, spotSize = [8, 30] } = {}) {
  const p = new Painter(512, 256, seed);
  p.fill(base);
  p.speckle(spots, spotCount, spotSize[0], spotSize[1], { alpha: 0.8, jag: 0.35 });
  p.craters(craters, 2, 14);
  return p;
}

export function moon() {
  const p = moonBase('#c8c8c4', ['#b7b7b3', '#d6d6d2'], 51, { craters: 70 });
  // maria (the "man in the moon")
  for (const [lon, lat, rx, ry] of [[-20, 25, 60, 30], [10, 20, 30, 25], [35, 10, 25, 20], [-50, -5, 40, 30], [-10, -15, 30, 18], [50, -10, 20, 15]]) {
    p.blob(lon, lat, rx / 2, ry / 2, '#7d7d84', { jag: 0.25, alpha: 0.85 });
  }
  p.crater(-10, -42, 8, { floor: 'rgba(255,255,255,0.5)' }); // Tycho
  return p.texture();
}
export const phobos = () => moonBase('#8d7b6a', ['#7a6858', '#9b8978'], 52, { craters: 25 }).texture();
export function io() {
  const p = moonBase('#f2dc5c', ['#e9b13a', '#fff1a0', '#d98a2a'], 53, { craters: 0, spotCount: 50 });
  p.speckle(['#7a3b12', '#3a2a1a', '#c0441d'], 25, 3, 7, { alpha: 0.9 });
  return p.texture();
}
export function europa() {
  const p = moonBase('#efe6d6', ['#e2d6c0', '#f8f3ea'], 54, { craters: 2 });
  p.streaks(['#a8643a', '#b97a4c'], 40, -70, 70, { lw: [1, 3], len: [60, 260], amp: 20, alpha: 0.8 });
  return p.texture();
}
export const ganymede = () => moonBase('#9a8b78', ['#7d6e5e', '#c2b6a5', '#8c7d6b'], 55, { craters: 30, spotCount: 40, spotSize: [10, 40] }).texture();
export const callisto = () => moonBase('#5f5248', ['#4e433a', '#6f6156'], 56, { craters: 120 }).texture();
export function titan() {
  const p = new Painter(512, 256, 57);
  p.bands([[90, '#c98a2c'], [50, '#e0a540'], [10, '#e8b04e'], [-30, '#dca041'], [-60, '#cf9235']], 3);
  return p.texture();
}
export const triton = () => moonBase('#e9cfc6', ['#d4aea2', '#f3e2dc', '#c99f94'], 58, { craters: 6 }).texture();
export function charon() {
  const p = moonBase('#a19c98', ['#8e8985', '#b3aeaa'], 59, { craters: 25 });
  p.polarCap(65, '#7a4a3a', true, 3); // Mordor Macula red cap
  return p.texture();
}
export const halley = () => moonBase('#5a5048', ['#3f3731', '#77695d'], 60, { craters: 10 }).texture();

// ---------------------------------------------------------------- Sprites
export function glow(inner = 'rgba(255,214,110,0.95)', mid = 'rgba(255,160,40,0.35)') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(255,140,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return finish(c);
}

export function sunburst() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.translate(256, 256);
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, long = i % 2 === 0;
    const L = long ? 250 : 190, half = TAU / n / 2.6;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
    g.addColorStop(0.3, long ? 'rgba(255,214,80,0.85)' : 'rgba(255,170,40,0.8)');
    g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - half) * 100, Math.sin(a - half) * 100);
    ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
    ctx.lineTo(Math.cos(a + half) * 100, Math.sin(a + half) * 100);
    ctx.closePath();
    ctx.fill();
  }
  return finish(c);
}

export function dot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c);
}

export function tailGradient() {
  // alpha along the tail: bright at the head (v=1), fading to nothing (v=0)
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  return t;
}
