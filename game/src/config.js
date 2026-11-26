// Skyline Courier — shared constants for the flight game.
// All units are metres, metres per second and radians unless noted.
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const FOCAL = 640; // perspective focal length in pixels

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSE = 'pause';
export const SCREEN_OVER = 'over';
export const SCREEN_DONE = 'done';

export const PHYSICS = {
  maxSpeed: 72, // m/s at full throttle
  minSpeed: 10,
  cruiseThrottle: 0.8,
  stallSpeed: 17,
  maxRoll: 1.0, // radians of bank
  maxPitch: 0.55, // radians of pitch
  turnScale: 1.35, // turn-rate multiplier
  fuelDrain: 0.55, // percent per second at full throttle
  startFuel: 100,
  ceiling: 620,
  ringRadius: 26,
  ringScore: 100,
  landingBonus: 500,
};

export const COURSE = {
  runwayA: { x0: -18, x1: 18, z0: -60, z1: 360 },
  runwayB: { x0: -18, x1: 18, z0: 4140, z1: 4800 },
  worldHalfX: 980,
  ringZ: [600, 1100, 1600, 2100, 2600, 3100, 3600, 4100],
  ringX: [-180, 140, -90, 220, -240, 120, -160, 60],
};

export const COLORS = {
  skyTop: '#5ea3dd',
  skyHorizon: '#dceefb',
  fog: '#bfd4e6',
  water: '#3f7fbf',
  runway: '#3a3f46',
  runwayLine: '#f2f5f7',
};

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Smoothstep interpolation factor. */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
