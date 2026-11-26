// Skyline Courier — deterministic screenshot scenes behind ?shot=start|play|
// rings|end. Each scene plays the real rules forward from a fresh world for a
// fixed amount of time, steered by a simple autopilot (bank toward the next
// ring or the far runway, pitch toward its height, throttle for cruise), so
// the frame is what a real flight looks like and the same seed always gives
// the same frame.
import { COURSE, clamp, wrapAngle } from './config.js';
import { EVENT_CRASH, EVENT_DONE, EVENT_LANDED, STEP, onRunway } from './world.js';
import { SCREEN_DONE, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './config.js';

const START_SECONDS = 3;
const PLAY_SECONDS = 42;
const RINGS_SECONDS = 80;
const END_LIMIT_SECONDS = 420;

/** Autopilot input: steer at the next ring, or land on Runway 27 once all are flown. */
export function autopilot(world) {
  const s = world.state;
  const ring = world.nextRing();
  let tx;
  let ty;
  let tz;
  let throttle = 0.85;
  if (ring) {
    tx = ring.x;
    ty = ring.y;
    tz = ring.z;
  } else {
    // Landing pattern with phases (kept on the state so a go-around survives
    // from one step to the next): final approach from the near side, a
    // go-around climb-out, a far-side line-up, then final from the far side.
    const r = COURSE.runwayB;
    const midZ = (r.z0 + r.z1) / 2;
    const ground = world.groundY(0, midZ);
    if (!s.apPhase) s.apPhase = 'final';
    if (s.apPhase === 'final' && s.z > r.z1 + 60 && s.airborne) s.apPhase = 'goaround';
    if (s.apPhase === 'finalFar' && s.z < r.z0 - 60 && s.airborne) s.apPhase = 'goaround';
    if (s.apPhase === 'goaround') {
      tx = 0;
      ty = 220;
      tz = 5400;
      throttle = 0.9;
      if (s.z > 5050) s.apPhase = 'lineupFar';
    } else if (s.apPhase === 'lineupFar') {
      // Far-side line-up: circle wide at 170 m until we are heading back
      // toward the runway, roughly on the centreline.
      tx = 0;
      ty = 170;
      tz = 5160;
      throttle = 0.5;
      if (s.z > 4700 && Math.abs(s.x) < 150 && Math.cos(s.heading) < -0.5) {
        s.apPhase = 'finalFar';
      }
    } else if (s.apPhase === 'finalFar') {
      // Far-side final: fly down the runway toward the near end.
      tx = 0;
      tz = r.z0 - 300;
      const tdZ = r.z1 - 120;
      const dist = Math.max(0, s.z - tdZ);
      ty = ground + clamp(dist * 0.45, 0, 220);
      throttle = dist < 100 && s.y - ground < 20 ? 0.12 : dist < 250 ? 0.3 : dist < 700 ? 0.5 : 0.7;
    } else {
      // Near-side final: fly down the runway toward the far end, aiming to
      // touch down just past the near threshold on a steep glide path.
      tx = 0;
      tz = r.z1 + 300;
      const tdZ = r.z0 + 120;
      const dist = Math.max(0, tdZ - s.z);
      // Badly misaligned while low and close: climb out and re-enter from
      // the far side instead of circling the runway.
      if (Math.abs(s.x) > 90 && dist < 300 && s.y - ground < 110) {
        s.apPhase = 'goaround';
        tx = 0;
        ty = 220;
        tz = 5400;
        throttle = 0.9;
      } else {
        ty = ground + clamp(dist * 0.45, 0, 220);
        throttle = dist < 100 && s.y - ground < 20 ? 0.12 : dist < 250 ? 0.3 : dist < 700 ? 0.5 : 0.7;
      }
    }
  }
  // Heading: chase the next ring, or hold the runway centreline with a
  // cross-track correction while landing (an aim point far down the runway
  // alone converges far too slowly).
  let desiredHeading;
  if (!ring && (s.apPhase === 'final' || s.apPhase === 'finalFar')) {
    const base = s.apPhase === 'final' ? 0 : Math.PI;
    const sign = s.apPhase === 'final' ? -1 : 1;
    desiredHeading = base + clamp(sign * s.x * 0.005, -0.45, 0.45);
  } else {
    desiredHeading = Math.atan2(tx - s.x, tz - s.z);
  }
  const headingErr = wrapAngle(desiredHeading - s.heading);
  let roll = clamp(headingErr * 3.2, -1, 1);
  // Slow down to turn tighter when the ring is near or the turn is sharp.
  if (ring) {
    const dist = Math.hypot(tx - s.x, ty - s.y, tz - s.z);
    if (dist < 350) throttle = 0.55;
    if (dist < 150) throttle = 0.45;
    if (Math.abs(headingErr) > 0.6) throttle = Math.min(throttle, 0.6);
  }
  // Level the wings only in the last moments over the runway itself.
  if (!ring && onRunway(s.x, s.z, COURSE.runwayB) && s.y - world.groundY(s.x, s.z) < 12) {
    roll = clamp(roll, -0.15, 0.15);
  }
  // Pitch toward the target height, damped by the current pitch.
  const dy = ty - s.y;
  let pitch = clamp(dy * 0.012 - s.pitch * 0.5, -0.9, 0.9);
  // Final sink: once low over the runway, hold a steady descent instead of
  // chasing the glide path asymptotically, or the plane floats forever.
  if (!ring && (s.apPhase === 'final' || s.apPhase === 'finalFar') && s.y - world.groundY(s.x, s.z) < 15) {
    pitch = -0.12;
  }
  // On the ground, keep the nose up once fast so we lift off.
  if (s.onGround && s.speed > 22) pitch = 0.5;
  if (s.onGround && s.speed <= 22) pitch = 0.15;
  return { roll, pitch, throttleSet: throttle };
}

/**
 * Set `world` to the named scene (start, play, rings or end; any other name
 * is start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  const shot = name === 'play' || name === 'rings' || name === 'end' ? name : 'start';
  if (shot === 'start') {
    for (let i = 0; i < START_SECONDS / STEP; i++) {
      world.step(STEP, { roll: 0, pitch: 0.12, throttleSet: 0.45 });
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = shot === 'end' ? END_LIMIT_SECONDS : shot === 'rings' ? RINGS_SECONDS : PLAY_SECONDS;
  const wantRings = shot === 'rings' ? 5 : shot === 'play' ? 2 : 99;
  for (let i = 0; i < limit / STEP; i++) {
    const events = world.step(STEP, autopilot(world));
    if (events & EVENT_CRASH) break;
    if (events & EVENT_DONE) break;
    if (world.state.rings >= wantRings && shot !== 'end') break;
    if (events & EVENT_LANDED && shot === 'end' && world.state.rings < world.course.rings.length) {
      // Landed early on the far runway: take off again and keep flying.
      // (The world lets the plane roll and lift off again.)
    }
  }
  if (shot === 'rings') {
    // After the fifth ring, fly on until the next ring is close enough to
    // fill the frame, so the screenshot shows the target, not empty sky.
    const next = world.nextRing();
    if (next && !world.state.crashed && !world.state.done) {
      for (let i = 0; i < 20 / STEP; i++) {
        const d = Math.hypot(next.x - world.state.x, next.y - world.state.y, next.z - world.state.z);
        if (d < 240) break;
        const events = world.step(STEP, autopilot(world));
        if (events & (EVENT_CRASH | EVENT_DONE)) break;
      }
    }
  }
  const s = world.state;
  if (s.done) return { screen: SCREEN_DONE, best: s.score };
  if (s.crashed) return { screen: SCREEN_OVER, best: s.score };
  return { screen: SCREEN_PLAY, best: s.score };
}
