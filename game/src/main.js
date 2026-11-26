// Skyline Courier — entry point: game loop, screens, shot mode.
// Opens game/index.html in a desktop browser and plays offline; no network.
import { VIEW_W, VIEW_H, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSE, SCREEN_OVER, SCREEN_DONE } from './config.js';
import { World, EVENT_RING, EVENT_CRASH, EVENT_DONE, EVENT_LANDED, STEP } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const sfx = new Sfx();

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || '1') || 1;
const shotName = params.get('shot');
const world = new World(seed);

let screen = SCREEN_TITLE;
let best = 0;
let last = performance.now();
let acc = 0;
let flash = '';
let flashUntil = 0;

function startGame() {
  world.reset(seed);
  screen = SCREEN_PLAY;
  flash = '';
  sfx.unlock();
  sfx.click();
}

function onEvent(events) {
  if (events & EVENT_RING) {
    sfx.ring();
    flash = `RING ${world.state.rings} / ${world.course.rings.length}  +100`;
    flashUntil = performance.now() + 1400;
  }
  if (events & EVENT_LANDED) {
    flash = `LANDED EARLY — ${world.course.rings.length - world.state.rings} RING(S) LEFT · THROTTLE UP TO GO AGAIN`;
    flashUntil = performance.now() + 3000;
    sfx.click();
  }
  if (events & EVENT_CRASH) {
    screen = SCREEN_OVER;
    best = Math.max(best, world.state.score);
    sfx.crash();
  }
  if (events & EVENT_DONE) {
    screen = SCREEN_DONE;
    best = Math.max(best, world.state.score);
    sfx.done();
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (input.consume('Enter') || input.consume(' ')) {
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_DONE) startGame();
  }
  if (input.mouse.down && (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_DONE)) {
    input.mouse.down = false;
    startGame();
  }
  if (input.consume('p') || input.consume('Escape')) {
    if (screen === SCREEN_PLAY) screen = SCREEN_PAUSE;
    else if (screen === SCREEN_PAUSE) screen = SCREEN_PLAY;
  }
  if (input.consume('r')) {
    if (screen !== SCREEN_TITLE) startGame();
  }
  if (screen === SCREEN_PLAY) {
    acc += dt;
    while (acc >= STEP) {
      onEvent(world.step(STEP, input.flight()));
      acc -= STEP;
      if (screen !== SCREEN_PLAY) break;
    }
    if (world.state.fuel <= 0 && world.state.airborne && Math.random() < dt * 0.5) sfx.warn();
  }
  renderer.render(world, screen, { time: now, best });
  if (flash && now < flashUntil && screen === SCREEN_PLAY) {
    const ctx = renderer.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(flash, VIEW_W / 2, 220);
    ctx.restore();
  }
  requestAnimationFrame(frame);
}

if (shotName) {
  // Screenshot mode (?shot=start|play|rings|end&seed=N): stage one
  // deterministic frame from the real rules and hold it still, so the
  // screenshots/ renders are exactly what a player would see.
  const staged = stageShot(shotName, world);
  screen = staged.screen;
  best = staged.best;
  renderer.render(world, screen, { time: 0, best });
  document.title = `Skyline Courier — ${shotName}`;
} else {
  document.title = 'Skyline Courier — a flight game';
  requestAnimationFrame(frame);
}
