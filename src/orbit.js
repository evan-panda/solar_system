export const TAU = Math.PI * 2;
export const mod = (a, n) => ((a % n) + n) % n;

// Solve Kepler's equation M = E - e sin E for the eccentric anomaly E.
export function solveKepler(M, e) {
  M = mod(M, TAU);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 40; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

// Heliocentric position for eccentric anomaly E. el = { a, e, i, node, argp } (radians).
// Ecliptic (X, Y, Z-north) maps to three.js (x, y-up, -z).
export function positionFromE(el, E, out) {
  const xv = el.a * (Math.cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cw = Math.cos(el.argp), sw = Math.sin(el.argp);
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  const x1 = xv * cw - yv * sw;
  const y1 = xv * sw + yv * cw;
  const X = x1 * cO - y1 * ci * sO;
  const Y = x1 * sO + y1 * ci * cO;
  const Z = y1 * si;
  return out.set(X, Z, -Y);
}

// Mean anomaly that places the body at ecliptic longitude `lam` (seen from above).
export function meanAnomalyForLongitude(el, lam) {
  const d = lam - el.node;
  const u = Math.atan2(Math.sin(d) / Math.cos(el.i), Math.cos(d));
  const nu = u - el.argp;
  const E = 2 * Math.atan2(Math.sqrt(1 - el.e) * Math.sin(nu / 2), Math.sqrt(1 + el.e) * Math.cos(nu / 2));
  return mod(E - el.e * Math.sin(E), TAU);
}
