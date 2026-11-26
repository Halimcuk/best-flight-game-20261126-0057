// Skyline Courier — the world: terrain height, course, rings, trees, clouds
// and the flight model. Pure logic, no DOM, so the screenshot autopilot and
// the Node test harness can run it headless.
import { PHYSICS, COURSE, clamp, smoothstep, wrapAngle } from './config.js';
import { mulberry32, noise2 } from './random.js';

export const EVENT_RING = 1;
export const EVENT_CRASH = 2;
export const EVENT_LANDED = 4;
export const EVENT_DONE = 8;

export const STEP = 1 / 60;

/** The river's centreline x at a given z. */
export function riverX(z) {
  return 160 * Math.sin(z * 0.0009 + 1.3) + 40 * Math.sin(z * 0.0021);
}

/** Terrain height (metres above sea level) at world (x, z), for a seed. */
export function terrainHeight(x, z, seed) {
  // Rolling valley hills: two octaves of value noise.
  let h = 52 * noise2(x / 190, z / 190, seed) + 26 * noise2(x / 95 + 7.3, z / 95 + 3.1, seed + 11);
  // Keep the flight corridor gentler than the valley walls.
  const corridor = 0.35 + 0.65 * clamp((Math.abs(x) - 80) / 320, 0, 1);
  h *= corridor;
  // Mountain walls far from the corridor.
  const wall = smoothstep(380, 720, Math.abs(x));
  h += wall * (120 + 110 * noise2(x / 260 + 2.7, z / 260 + 8.4, seed + 23));
  // A lake near (-180, 2100) and the river carve down to water level.
  const lakeD = Math.hypot(x + 180, z - 2100);
  if (lakeD < 150) h = Math.min(h, 2 + 8 * smoothstep(90, 150, lakeD));
  const riverD = Math.abs(x - riverX(z));
  if (riverD < 18) h = Math.min(h, 3 + 6 * smoothstep(6, 18, riverD));
  // Flatten both runways so they sit at sea level.
  h *= runwayBlend(x, z, COURSE.runwayA);
  h *= runwayBlend(x, z, COURSE.runwayB);
  return Math.max(h, 0);
}

/** 1 far from a runway rect, 0 inside it, smooth in between. */
function runwayBlend(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  const d = Math.hypot(dx, dz);
  return smoothstep(0, 130, d);
}

/** Whether (x, z) is on a runway strip (inside the paved rect). */
export function onRunway(x, z, r) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Whether (x, z) is water (river band or lake). */
export function isWater(x, z) {
  if (Math.abs(x - riverX(z)) < 14) return true;
  return Math.hypot(x + 180, z - 2100) < 128;
}

/** Build the course: rings, trees and clouds for a seed. */
export function buildCourse(seed) {
  const rng = mulberry32(seed);
  const rings = COURSE.ringZ.map((z, i) => {
    const x = COURSE.ringX[i];
    const y = terrainHeight(x, z, seed) + 95 + ((i * 53) % 90);
    return { x, y, z, r: PHYSICS.ringRadius, taken: false, index: i };
  });
  const trees = [];
  for (let i = 0; i < 520; i++) {
    const x = (rng() * 2 - 1) * 680;
    const z = rng() * 4700 - 100;
    const h = terrainHeight(x, z, seed);
    if (h > 95 || isWater(x, z)) continue;
    if (onRunway(x, z, COURSE.runwayA) || onRunway(x, z, COURSE.runwayB)) continue;
    if (Math.abs(x) < 26 && z > -60 && z < 4560 && Math.abs(x - riverX(z)) > 30) {
      // keep the corridor mostly clear so rings stay readable
      if (rng() < 0.75) continue;
    }
    trees.push({ x, z, y: h, s: 7 + rng() * 7 });
  }
  const clouds = [];
  for (let i = 0; i < 20; i++) {
    clouds.push({
      x: (rng() * 2 - 1) * 750,
      y: 300 + rng() * 150,
      z: rng() * 5000 - 200,
      r: 45 + rng() * 55,
    });
  }
  return { rings, trees, clouds };
}

/** Fresh flight state on Runway 09, nose down the valley. */
export function freshState(seed) {
  return {
    seed,
    x: 0,
    y: terrainHeight(0, 150, seed) + 1.2,
    z: 150,
    heading: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: PHYSICS.startFuel,
    time: 0,
    airborne: false,
    rings: 0,
    score: 0,
    crashed: false,
    crashReason: '',
    landed: false,
    done: false,
    onGround: true,
    warned: '',
  };
}

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.course = buildCourse(seed);
    this.state = freshState(seed);
  }

  reset(seed = this.seed) {
    this.seed = seed;
    this.course = buildCourse(seed);
    this.state = freshState(seed);
  }

  groundY(x, z) {
    return terrainHeight(x, z, this.seed);
  }

  nextRing() {
    return this.course.rings.find((r) => !r.taken) ?? null;
  }

  /** One physics step. `input` is { roll, pitch, throttleDelta, throttleSet }. */
  step(dt, input) {
    const s = this.state;
    if (s.crashed || s.done) return 0;
    let events = 0;
    if (typeof input.throttleSet === 'number') {
      s.throttle = clamp(input.throttleSet, 0, 1);
    } else if (input.throttleDelta) {
      s.throttle = clamp(s.throttle + input.throttleDelta * dt * 0.6, 0, 1);
    }
    if (s.fuel <= 0) s.throttle = 0;

    // Bank toward the commanded roll, pitch toward the commanded pitch.
    const rollTarget = clamp(input.roll || 0, -1, 1) * PHYSICS.maxRoll;
    const pitchTarget = clamp(input.pitch || 0, -1, 1) * PHYSICS.maxPitch;
    s.roll += (rollTarget - s.roll) * Math.min(1, dt * 3.2);
    let pitchCmd = pitchTarget;
    if (s.speed < PHYSICS.stallSpeed && s.airborne) pitchCmd = Math.min(pitchCmd, -0.22); // stall: nose drops
    s.pitch += (pitchCmd - s.pitch) * Math.min(1, dt * 2.8);

    // Turn rate from bank angle; heading 0 is +z, positive heading turns to +x.
    const turn = (9.8 * Math.tan(clamp(s.roll, -1, 1)) / Math.max(s.speed, 20)) * PHYSICS.turnScale;
    s.heading = wrapAngle(s.heading + turn * dt);

    // Speed chases the throttle setting; climbing bleeds speed, diving gains it.
    const targetSpeed = PHYSICS.minSpeed + s.throttle * (PHYSICS.maxSpeed - PHYSICS.minSpeed);
    s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 0.45);
    s.speed -= Math.sin(s.pitch) * 9 * dt;
    s.speed = clamp(s.speed, 6, 78);

    const vy = s.speed * Math.sin(s.pitch);
    const horiz = s.speed * Math.cos(s.pitch);
    s.x += horiz * Math.sin(s.heading) * dt;
    s.z += horiz * Math.cos(s.heading) * dt;
    s.y += vy * dt;
    if (s.y > PHYSICS.ceiling) {
      s.y = PHYSICS.ceiling;
      s.pitch = Math.min(s.pitch, 0);
    }
    // Soft world edge: steer back toward the valley.
    if (Math.abs(s.x) > COURSE.worldHalfX) {
      s.heading += (s.x > 0 ? -1 : 1) * 0.25 * dt;
      s.warned = 'TURN BACK — VALLEY EDGE';
    } else if (s.warned === 'TURN BACK — VALLEY EDGE') {
      s.warned = '';
    }

    if (s.airborne) s.time += dt;
    s.fuel = Math.max(0, s.fuel - dt * (0.10 + 0.30 * s.throttle));
    if (s.fuel <= 0 && !s.airborne) s.fuel = 0;

    // Ring pickup: 3D distance to the ring centre.
    const ring = this.nextRing();
    if (ring) {
      const d = Math.hypot(s.x - ring.x, s.y - ring.y, s.z - ring.z);
      if (d < ring.r) {
        ring.taken = true;
        s.rings += 1;
        s.score += PHYSICS.ringScore;
        events |= EVENT_RING;
      }
    }

    // Ground contact.
    const ground = this.groundY(s.x, s.z) + 1.2;
    const inA = onRunway(s.x, s.z, COURSE.runwayA);
    const inB = onRunway(s.x, s.z, COURSE.runwayB);
    if (s.y <= ground) {
      const hard = Math.abs(vy) > 8 || s.speed > 52;
      if ((inA || inB) && !hard && Math.abs(s.roll) < 0.55) {
        // Safe touchdown: roll along the runway.
        s.y = ground;
        s.onGround = true;
        s.airborne = false;
        if (inB) {
          s.landed = true;
          if (s.rings >= this.course.rings.length) {
            s.done = true;
            s.score += PHYSICS.landingBonus + Math.max(0, Math.round(600 - s.time * 2)) + Math.round(s.fuel * 2);
            events |= EVENT_DONE;
          } else {
            events |= EVENT_LANDED;
          }
        }
      } else {
        s.y = ground;
        s.crashed = true;
        s.crashReason = inA || inB
          ? (hard ? 'HARD LANDING' : 'WINGS NOT LEVEL')
          : isWater(s.x, s.z)
            ? 'DITCHED IN THE WATER'
            : 'TERRAIN IMPACT';
        events |= EVENT_CRASH;
        return events;
      }
    } else {
      s.onGround = false;
      if (s.y > ground + 3) s.airborne = true;
    }

    // Takeoff roll: once fast enough with the nose up, we are airborne.
    if (s.onGround && s.speed > 22 && s.pitch > 0.08) {
      s.airborne = true;
      s.onGround = false;
    }

    // Warnings for the HUD.
    if (!s.crashed && !s.done) {
      if (s.airborne && s.speed < PHYSICS.stallSpeed) s.warned = 'STALL — NOSE DOWN, ADD THROTTLE';
      else if (s.airborne && s.y - ground < 25 && vy < -2) s.warned = 'PULL UP — TERRAIN';
      else if (s.fuel < 20 && s.fuel > 0) s.warned = 'LOW FUEL';
      else if (s.warned && !s.warned.startsWith('TURN BACK')) s.warned = '';
    }
    return events;
  }
}
