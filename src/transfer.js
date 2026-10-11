// Rocket trajectories: two-body orbits around the Sun.
// Units are AU and years, so the Sun's gravitational parameter is 4π².
// All 2D vectors are [X, Y] in the ecliptic plane, with prograde motion counter-clockwise.
import { TAU, mod } from './orbit.js';

export const MU = 4 * Math.PI * Math.PI;
export const AU_PER_YEAR_KMS = 4.740470463; // 1 AU/year in km/s

// Hohmann transfer time between two circular orbits (half the transfer ellipse's period).
export const hohmannYears = (r1, r2) => 0.5 * Math.pow((r1 + r2) / 2, 1.5);

// Stumpff functions for the universal-variable formulation.
function stumpff(psi) {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * s * s)];
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return [(1 - Math.cosh(s)) / psi, (Math.sinh(s) - s) / (s * s * s)];
  }
  return [1 / 2, 1 / 6];
}

// Lambert's problem: the prograde orbit that goes from r1 to r2 in `tof` years
// (less than one revolution). Universal variables with bisection (Vallado, Algorithm 58).
// Returns the velocities at both ends, or null if the geometry is degenerate.
export function lambert(r1, r2, tof) {
  const r1m = Math.hypot(r1[0], r1[1]), r2m = Math.hypot(r2[0], r2[1]);
  const theta = mod(Math.atan2(r2[1], r2[0]) - Math.atan2(r1[1], r1[0]), TAU);
  // 180° transfers have no unique plane; the formulation breaks down right at it.
  if (Math.abs(theta - Math.PI) < 1e-4) return null;
  const A = (theta < Math.PI ? 1 : -1) * Math.sqrt(r1m * r2m * (1 + Math.cos(theta)));
  const sqMu = Math.sqrt(MU);
  let lo = -400, hi = TAU * TAU, psi = 0, y = 0, converged = false;
  for (let k = 0; k < 200; k++) {
    const [c2, c3] = stumpff(psi);
    y = r1m + r2m + (A * (psi * c3 - 1)) / Math.sqrt(c2);
    if (A > 0 && y < 0) { lo = psi; psi = (lo + hi) / 2; continue; }
    const chi = Math.sqrt(y / c2);
    const t = (chi * chi * chi * c3 + A * Math.sqrt(y)) / sqMu;
    if (Math.abs(t - tof) < 1e-10 * tof) { converged = true; break; }
    if (t < tof) lo = psi; else hi = psi;
    psi = (lo + hi) / 2;
  }
  // No solution in range: e.g. a long-way (>180°) transfer asked to finish too quickly.
  if (!converged) return null;
  const f = 1 - y / r1m, g = A * Math.sqrt(y / MU), gdot = 1 - y / r2m;
  const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g];
  const v2 = [(gdot * r2[0] - r1[0]) / g, (gdot * r2[1] - r1[1]) / g];
  if (![...v1, ...v2].every(Number.isFinite)) return null;
  return { v1, v2, theta };
}

// Orbit through position r with velocity v, ready for propagate().
export function conic(r, v) {
  const rm = Math.hypot(r[0], r[1]);
  const v2 = v[0] * v[0] + v[1] * v[1];
  const rv = r[0] * v[0] + r[1] * v[1];
  const ex = ((v2 - MU / rm) * r[0] - rv * v[0]) / MU;
  const ey = ((v2 - MU / rm) * r[1] - rv * v[1]) / MU;
  const e = Math.hypot(ex, ey);
  const h = r[0] * v[1] - r[1] * v[0];
  return {
    r, v, rm, rv,
    alpha: 2 / rm - v2 / MU, // 1/a: > 0 ellipse, 0 parabola, < 0 hyperbola
    e,
    rp: (h * h) / (MU * (1 + e)), // perihelion distance, stable for every e
    nu0: e > 1e-9 ? mod(Math.atan2(r[1], r[0]) - Math.atan2(ey, ex), TAU) : 0, // true anomaly at the start
  };
}

// Position [X, Y] on the orbit `t` years after its starting point. Universal-variable
// Kepler solve (Vallado, Algorithm 8), so it works for ellipses, parabolas and hyperbolas.
export function propagate(o, t) {
  if (t === 0) return [o.r[0], o.r[1]];
  const sqMu = Math.sqrt(MU);
  // time of flight for universal anomaly chi; monotonic, with derivative r(chi) > 0
  const timeAt = (chi) => {
    const psi = chi * chi * o.alpha;
    const [c2, c3] = stumpff(psi);
    const T = (chi * chi * chi * c3 + (o.rv / sqMu) * chi * chi * c2 + o.rm * chi * (1 - psi * c3)) / sqMu;
    const r = chi * chi * c2 + (o.rv / sqMu) * chi * (1 - psi * c3) + o.rm * (1 - psi * c2);
    return [T, r, c2, c3];
  };
  // bracket the root, then Newton steps that fall back to bisection if they leave the bracket
  let lo = 0, hi = (sqMu * t) / o.rm;
  while (timeAt(hi)[0] < t) { lo = hi; hi *= 2; }
  let chi = (lo + hi) / 2;
  for (let k = 0; k < 100; k++) {
    const [T, r] = timeAt(chi);
    if (T < t) lo = chi; else hi = chi;
    let next = chi - ((T - t) * sqMu) / r;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - chi) < 1e-12 * Math.max(1, chi)) { chi = next; break; }
    chi = next;
  }
  const [, , c2, c3] = timeAt(chi);
  const f = 1 - ((chi * chi) / o.rm) * c2;
  const g = t - (chi * chi * chi * c3) / sqMu;
  return [f * o.r[0] + g * o.v[0], f * o.r[1] + g * o.v[1]];
}

// Speed (AU/year) at distance r from the Sun (vis-viva).
export const speedAt = (o, r) => Math.sqrt(MU * (2 / r - o.alpha));

// Closest approach to the Sun while sweeping `theta` radians (prograde) from the start.
export function closestApproach(o, r1m, r2m, theta) {
  const passesPerihelion = o.nu0 + theta >= TAU;
  return passesPerihelion ? o.rp : Math.min(r1m, r2m);
}

// Flight times tried: 0.5x to 1.6x the Hohmann time. A grid of 2n samples contains the
// grid of n samples, so plans found with different sample counts compare exactly.
const tofAt = (hohmann, i, samples) => hohmann * 0.5 * Math.pow(3.2, i / samples);

// One candidate trip with a given flight time, or null. `cost` is the total Δv
// (departure + arrival) plus a penalty for paths that dive too close to the Sun.
function tryTrip(dep, arrAt, tof) {
  const arr = arrAt(tof);
  const sol = lambert(dep.p, arr.p, tof);
  if (!sol) return null;
  const orbit = conic(dep.p, sol.v1);
  const dv = Math.hypot(sol.v1[0] - dep.v[0], sol.v1[1] - dep.v[1])
    + Math.hypot(sol.v2[0] - arr.v[0], sol.v2[1] - arr.v[1]);
  const rMin = closestApproach(orbit, Math.hypot(dep.p[0], dep.p[1]), Math.hypot(arr.p[0], arr.p[1]), sol.theta);
  return { tof, dv, cost: dv + (rMin < 0.3 ? (0.3 - rMin) * 100 : 0), orbit, arr };
}

// Cheapest transfer that leaves right now: the flight time needing the least Δv.
//   dep:   { p: [X, Y], v: [vx, vy] } of the departure planet now
//   arrAt: (years) => { p, v } of the target planet that many years from now
export function bestTransfer(dep, arrAt, hohmann, samples = 40) {
  let best = null;
  for (let i = 0; i <= samples; i++) {
    const trip = tryTrip(dep, arrAt, tofAt(hohmann, i, samples));
    if (trip && (!best || trip.cost < best.cost)) best = trip;
  }
  return best;
}

// Fastest transfer that leaves right now without costing more than `budget`.
export function fastestTransfer(dep, arrAt, hohmann, budget, samples = 40) {
  for (let i = 0; i <= samples; i++) {
    const trip = tryTrip(dep, arrAt, tofAt(hohmann, i, samples));
    if (trip && trip.cost <= budget) return trip;
  }
  return null;
}

// Best launch window in the next `horizon` years for a rocket with `budget` of Δv
// (what leaving right now would cost): the departure delay that allows the shortest
// trip, using the least fuel on a tie. Leaving now always qualifies, so the window is
// never slower or more expensive. Coarse scan, then a finer look around the best delay.
//   depAt: (years) => { p, v } of the departure planet that many years from now
export function bestWindow(depAt, arrAt, hohmann, horizon, budget) {
  const plan = (delay, samples) => {
    const b = fastestTransfer(depAt(delay), (t) => arrAt(delay + t), hohmann, budget, samples);
    if (b) b.delay = delay;
    return b;
  };
  const better = (a, b) => a && (!b || a.tof < b.tof || (a.tof === b.tof && a.cost < b.cost));
  const steps = 60;
  let best = null;
  for (let i = 0; i <= steps; i++) {
    const b = plan((horizon * i) / steps, 20);
    if (better(b, best)) best = b;
  }
  if (!best) return null;
  const center = best.delay, step = horizon / steps;
  for (let j = -10; j <= 10; j++) {
    const d = center + (step * j) / 10;
    if (d < 0) continue;
    const b = plan(d, 40);
    if (better(b, best)) best = b;
  }
  return best;
}
