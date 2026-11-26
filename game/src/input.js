// Skyline Courier — keyboard and mouse input.
// Arrow keys / WASD fly the plane, W/S (or Shift/Ctrl) work the throttle,
// P pauses, R restarts, Enter starts. The mouse steers when it moves: the
// plane banks toward the pointer and pitches toward its height.
import { clamp } from './config.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, active: false, lastMove: 0, down: false };
    this._onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    this._onMouseMove = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 1280;
      this.mouse.y = ((e.clientY - r.top) / r.height) * 720;
      this.mouse.active = true;
      this.mouse.lastMove = performance.now();
    };
    this._onMouseDown = () => {
      this.mouse.down = true;
    };
    this._onMouseUp = () => {
      this.mouse.down = false;
    };
    this._onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  pressed(code) {
    return this.keys.has(code);
  }

  consume(code) {
    if (this.keys.has(code)) {
      this.keys.delete(code);
      return true;
    }
    return false;
  }

  /** Flight controls for this frame: { roll, pitch, throttleDelta }. */
  flight() {
    let roll = 0;
    let pitch = 0;
    if (this.pressed('ArrowLeft') || this.pressed('a')) roll -= 1;
    if (this.pressed('ArrowRight') || this.pressed('d')) roll += 1;
    if (this.pressed('ArrowUp')) pitch += 1;
    if (this.pressed('ArrowDown')) pitch -= 1;
    const keysUsed = roll !== 0 || pitch !== 0;
    if (!keysUsed && this.mouse.active && performance.now() - this.mouse.lastMove < 2500) {
      roll = clamp(((this.mouse.x - 640) / 640) * 1.25, -1, 1);
      pitch = clamp(((396 - this.mouse.y) / 300), -1, 1);
    }
    let throttleDelta = 0;
    if (this.pressed('w') || this.pressed('Shift')) throttleDelta += 1;
    if (this.pressed('s') || this.pressed('Control')) throttleDelta -= 1;
    return { roll, pitch, throttleDelta };
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mouseup', this._onMouseUp);
  }
}
