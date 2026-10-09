// Orbital elements: JPL "Keplerian Elements for Approximate Positions of the
// Major Planets" (J2000 epoch). Angles in degrees, a in AU.
//   a     semi-major axis        e     eccentricity     i     inclination
//   node  longitude of ascending node                  peri  longitude of perihelion
//   L     mean longitude at J2000
// Orbital periods come from Kepler's third law (P = a^1.5 years), so relative
// speeds are physically correct.
//
// Display scale: real distances span 100x (Mercury -> Pluto), which would make
// the inner planets invisible. Semi-major axes are compressed with a power law,
// but each orbit keeps its real eccentricity, so the *shape* of every ellipse
// is true to life. Planet sizes are exaggerated cartoon sizes.

export const DEG = Math.PI / 180;
export const SUN_RADIUS = 10;
export const scaleDist = (au) => 34 * Math.pow(au, 0.65);

// Real time that one Earth year takes at 1x speed.
export const EARTH_YEAR_SECONDS = 60;
// Spin uses its own (slower) clock so rotation is watchable: one Earth day
// takes this many seconds at 1x spin. All other spins are relative to it.
export const EARTH_DAY_SECONDS = 6;

export const J2000_MS = Date.UTC(2000, 0, 1, 12);
export const YEAR_MS = 365.25 * 86400000;

export const SUN = {
  id: 'sun',
  name: 'Sun',
  color: '#ffb300',
  radius: SUN_RADIUS,
  tilt: 7.25,
  rotDays: 25.38,
  blurb: 'A churning ball of hydrogen and helium that holds 99.86% of the solar system’s mass. Its light takes about 8 minutes to reach Earth.',
  stats: { Diameter: '1,392,700 km', 'Spin': '25 days (equator)', Surface: '5,500 °C', Type: 'G-type star' },
};

export const PLANETS = [
  {
    id: 'mercury', name: 'Mercury', color: '#b9b1a8',
    a: 0.38709927, e: 0.20563593, i: 7.00497902, node: 48.33076593, peri: 77.45779628, L: 252.2503235,
    radius: 1.1, tilt: 0.03, rotDays: 58.646,
    blurb: 'The smallest planet and closest to the Sun: a battered, cratered world with almost no atmosphere. Its orbit is the most stretched of the planets.',
    stats: { Diameter: '4,879 km', Day: '58.6 Earth days', Year: '88 days', Moons: '0' },
  },
  {
    id: 'venus', name: 'Venus', color: '#f2c879',
    a: 0.72333566, e: 0.00677672, i: 3.39467605, node: 76.67984255, peri: 131.60246718, L: 181.9790995,
    radius: 1.9, tilt: 177.4, rotDays: 243.02,
    blurb: 'Wrapped in thick, swirling clouds of sulfuric acid, Venus is the hottest planet (465 °C). It spins backwards, and so slowly its day is longer than its year.',
    stats: { Diameter: '12,104 km', Day: '243 Earth days (backwards)', Year: '225 days', Moons: '0' },
  },
  {
    id: 'earth', name: 'Earth', color: '#3d8ef0',
    a: 1.00000261, e: 0.01671123, i: 0, node: 0, peri: 102.93768193, L: 100.46457166,
    radius: 2.0, tilt: 23.44, rotDays: 0.99727, clouds: true,
    moons: [{ name: 'Moon', tex: 'moon', size: 0.27, dist: 2.7, period: 27.32 }],
    blurb: 'Our home: the only world known to have liquid oceans on its surface and life. The tilt of its axis gives us the seasons.',
    stats: { Diameter: '12,756 km', Day: '23 h 56 m', Year: '365.25 days', Moons: '1' },
  },
  {
    id: 'mars', name: 'Mars', color: '#e0643a',
    a: 1.52371034, e: 0.0933941, i: 1.84969142, node: 49.55953891, peri: -23.94362959, L: -4.55343205,
    radius: 1.4, tilt: 25.19, rotDays: 1.026,
    moons: [
      { name: 'Phobos', tex: 'phobos', size: 0.13, dist: 1.9, period: 0.319, lumpy: true },
      { name: 'Deimos', tex: 'phobos', size: 0.09, dist: 2.7, period: 1.263, lumpy: true },
    ],
    blurb: 'The rusty Red Planet, with icy polar caps, Olympus Mons (the tallest volcano in the solar system) and the 4,000 km Valles Marineris canyon.',
    stats: { Diameter: '6,792 km', Day: '24 h 37 m', Year: '687 days', Moons: '2' },
  },
  {
    id: 'jupiter', name: 'Jupiter', color: '#d9a066',
    a: 5.202887, e: 0.04838624, i: 1.30439695, node: 100.47390909, peri: 14.72847983, L: 34.39644051,
    radius: 7, tilt: 3.13, rotDays: 0.4135,
    moons: [
      { name: 'Io', tex: 'io', size: 0.075, dist: 1.6, period: 1.769 },
      { name: 'Europa', tex: 'europa', size: 0.065, dist: 1.95, period: 3.551 },
      { name: 'Ganymede', tex: 'ganymede', size: 0.1, dist: 2.45, period: 7.155 },
      { name: 'Callisto', tex: 'callisto', size: 0.09, dist: 3.1, period: 16.69 },
    ],
    blurb: 'The giant of the solar system, striped with colourful cloud bands. The Great Red Spot is a storm bigger than Earth that has raged for centuries.',
    stats: { Diameter: '142,984 km', Day: '9 h 56 m', Year: '11.9 years', Moons: '95+' },
  },
  {
    id: 'saturn', name: 'Saturn', color: '#ecd39a',
    a: 9.53667594, e: 0.05386179, i: 2.48599187, node: 113.66242448, peri: 92.59887831, L: 49.95424423,
    radius: 6, tilt: 26.73, rotDays: 0.444,
    rings: { tex: 'saturnRings', inner: 1.24, outer: 2.35 },
    moons: [{ name: 'Titan', tex: 'titan', size: 0.11, dist: 3.0, period: 15.95 }],
    blurb: 'Famous for its dazzling rings of ice and rock. Saturn is so light it would float in a (very large) bathtub, and a hexagon-shaped storm sits on its north pole.',
    stats: { Diameter: '120,536 km', Day: '10 h 33 m', Year: '29.5 years', Moons: '270+' },
  },
  {
    id: 'uranus', name: 'Uranus', color: '#8fe0e6',
    a: 19.18916464, e: 0.04725744, i: 0.77263783, node: 74.01692503, peri: 170.9542763, L: 313.23810451,
    radius: 4, tilt: 97.77, rotDays: 0.718,
    rings: { tex: 'uranusRings', inner: 1.55, outer: 2.0 },
    blurb: 'An icy giant knocked onto its side: its axis is tilted 98°, so it rolls around the Sun like a ball, with faint rings standing on end.',
    stats: { Diameter: '51,118 km', Day: '17 h 14 m', Year: '84 years', Moons: '28+' },
  },
  {
    id: 'neptune', name: 'Neptune', color: '#4a6cf0',
    a: 30.06992276, e: 0.00859048, i: 1.77004347, node: 131.78422574, peri: 44.96476227, L: -55.12002969,
    radius: 3.9, tilt: 28.32, rotDays: 0.671,
    rings: { tex: 'neptuneRings', inner: 1.7, outer: 2.6 },
    moons: [{ name: 'Triton', tex: 'triton', size: 0.12, dist: 2.9, period: -5.877 }],
    blurb: 'The deep-blue, windiest planet, with gusts over 2,000 km/h. Voyager 2 spotted the Great Dark Spot, a storm the size of Earth.',
    stats: { Diameter: '49,528 km', Day: '16 h 6 m', Year: '165 years', Moons: '16' },
  },
  {
    id: 'pluto', name: 'Pluto', color: '#d7b48f', dwarf: true,
    a: 39.48211675, e: 0.2488273, i: 17.14001206, node: 110.30393684, peri: 224.06891629, L: 238.92903833,
    radius: 0.8, tilt: 122.53, rotDays: 6.387,
    moons: [{ name: 'Charon', tex: 'charon', size: 0.5, dist: 2.6, period: 6.387 }],
    blurb: 'A dwarf planet in the Kuiper Belt with a giant heart-shaped glacier of nitrogen ice. Its tilted, stretched orbit sometimes brings it closer than Neptune.',
    stats: { Diameter: '2,377 km', Day: '6.4 Earth days', Year: '248 years', Moons: '5' },
  },
];

// Halley's Comet. Real: q = 0.586 AU, Q = 35.1 AU, retrograde (i = 162°).
// Perihelion and aphelion are mapped through the same distance compression as
// the planets so it still skims inside Venus and swings out past Neptune.
const hq = scaleDist(0.586), hQ = scaleDist(35.08);
export const HALLEY = {
  id: 'halley', name: 'Halley’s Comet', color: '#bfe8ff', comet: true,
  aScene: (hq + hQ) / 2, e: (hQ - hq) / (hQ + hq),
  i: 162.26, node: 58.42, argp: 111.33,
  period: 75.32, periYears: -13.89, // perihelion 1986-02-09 relative to J2000
  radius: 0.6, tilt: 0, rotDays: 2.2,
  blurb: 'The most famous comet: a dirty snowball that swings past the Sun every ~76 years, growing a glowing tail that always points away from the Sun. Next visit: 2061.',
  stats: { Nucleus: '15 × 8 km', Orbit: '75–79 years', 'Last seen': '1986', 'Next visit': '2061' },
};
