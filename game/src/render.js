// Skyline Courier — all canvas drawing: chase-view 3D projection of the
// valley, the plane, the glass-cockpit instruments and the HUD.
import { VIEW_W, VIEW_H, FOCAL, COLORS, COURSE, clamp, lerp, smoothstep } from './config.js';
import { terrainHeight, riverX, onRunway, isWater } from './world.js';
import { noise2 } from './random.js';

const PLANE_X = VIEW_W / 2;
const PLANE_Y = 452; // where the chase-view plane sits on screen

/** Camera basis vectors from yaw (heading) and pitch. */
function cameraBasis(yaw, pitch) {
  const cp = Math.cos(pitch);
  const forward = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  // up = forward x right (right-handed: right, up, forward).
  const up = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  return { forward, right, up };
}

/** Project a world point into screen space; null when behind the camera. */
function project(p, cam, cx, cy) {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const zc = dx * cam.forward[0] + dy * cam.forward[1] + dz * cam.forward[2];
  if (zc < 2) return null;
  return { x: cx + (FOCAL * xc) / zc, y: cy - (FOCAL * yc) / zc, z: zc };
}

/** Parse a '#rrggbb' or 'rgb(r,g,b)' colour into [r, g, b]. */
function parseColor(c) {
  if (c[0] === '#') return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [0, 0, 0];
}

function mixHex(a, b, t) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
}

/** Terrain colour by height, with a little noise texture and distance fog. */
function terrainColor(h, x, z, seed, dist) {
  const v = noise2(x / 55, z / 55, seed + 5) * 0.16 - 0.08;
  let c;
  if (h < 6) c = '#79a854';
  else if (h < 45) c = mixHex('#6da34c', '#5d8f47', h / 45);
  else if (h < 95) c = mixHex('#5d8f47', '#8a7a52', (h - 45) / 50);
  else if (h < 150) c = mixHex('#8a7a52', '#9a938a', (h - 95) / 55);
  else if (h < 200) c = mixHex('#9a938a', '#b9b2a4', (h - 150) / 50);
  else if (h < 270) c = mixHex('#b9b2a4', '#dfe7ec', (h - 200) / 70);
  else c = '#eef3f6';
  const fogged = mixHex(c, COLORS.fog, clamp(dist / 1150, 0, 1) * 0.72);
  // Apply the texture variation as a translucent overlay instead of a second fill.
  return { fill: fogged, shade: v };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.propAngle = 0;
  }

  render(world, screen, opts) {
    const { ctx } = this;
    const s = world.state;
    const time = opts.time;
    this.propAngle += s.speed * 0.06;
    ctx.save();
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    this.drawSky(ctx, s, time);
    // Chase camera: behind and above the plane, looking where it looks.
    const camPitch = s.pitch * 0.55;
    const basis = cameraBasis(s.heading, camPitch);
    const back = 40;
    const cam = {
      x: s.x - Math.sin(s.heading) * Math.cos(camPitch) * back,
      y: s.y + 13 - Math.sin(camPitch) * back,
      z: s.z - Math.cos(s.heading) * Math.cos(camPitch) * back,
      ...basis,
    };
    // Bank the whole world view with the plane's roll.
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.rotate(-s.roll * 0.72);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    this.drawClouds(ctx, world, cam, time);
    this.drawTerrain(ctx, world, cam);
    this.drawRings(ctx, world, cam);
    ctx.restore();
    this.drawPlane(ctx, s, time);
    this.drawHud(ctx, world, screen, opts);
    this.drawPanel(ctx, world, screen, opts);
    if (screen !== 'play') this.drawScreen(ctx, world, screen, opts);
  }

  drawSky(ctx, s, time) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H * 0.72);
    g.addColorStop(0, COLORS.skyTop);
    g.addColorStop(0.75, '#a8cdea');
    g.addColorStop(1, COLORS.skyHorizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Sun with a soft glow, upper right.
    const sx = VIEW_W - 190;
    const sy = 108;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 120);
    glow.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
    glow.addColorStop(0.25, 'rgba(255, 236, 160, 0.55)');
    glow.addColorStop(1, 'rgba(255, 236, 160, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 130, sy - 130, 260, 260);
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  drawClouds(ctx, world, cam, time) {
    ctx.save();
    for (const c of world.course.clouds) {
      const p = project(c, cam, VIEW_W / 2, VIEW_H / 2);
      if (!p || p.x < -160 || p.x > VIEW_W + 160 || p.y < -80 || p.y > VIEW_H) continue;
      const k = FOCAL / p.z;
      const r = c.r * k;
      if (r < 2) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - r * 0.55, p.y + r * 0.1, r * 0.62, r * 0.3, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + r * 0.55, p.y + r * 0.08, r * 0.66, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTerrain(ctx, world, cam) {
    const s = world.state;
    const seed = world.seed;
    const step = 44;
    const zStart = Math.floor((cam.z + 24) / step) * step;
    const zEnd = zStart + 1150;
    // Far rows first (painter's algorithm).
    for (let z = zEnd; z >= zStart; z -= step) {
      for (let x = -660; x <= 660; x += step) {
        const corners = [
          { x, z },
          { x: x + step, z },
          { x: x + step, z: z + step },
          { x, z: z + step },
        ];
        const pts = [];
        let behind = false;
        let avgH = 0;
        for (const c of corners) {
          const h = terrainHeight(c.x, c.z, seed);
          avgH += h / 4;
          const p = project({ x: c.x, y: h, z: c.z }, cam, VIEW_W / 2, VIEW_H / 2);
          if (!p) {
            behind = true;
            break;
          }
          pts.push(p);
        }
        if (behind) continue;
        const cxm = x + step / 2;
        const czm = z + step / 2;
        const dist = czm - cam.z;
        let fill;
        if (isWater(cxm, czm)) {
          fill = mixHex(COLORS.water, '#7fb2dd', 0.25 * noise2(cxm / 40, czm / 40, seed));
          fill = mixHex(fill, COLORS.fog, clamp(dist / 1150, 0, 1) * 0.6);
        } else if (onRunway(cxm, czm, COURSE.runwayA) || onRunway(cxm, czm, COURSE.runwayB)) {
          fill = mixHex(COLORS.runway, COLORS.fog, clamp(dist / 1150, 0, 1) * 0.55);
        } else {
          fill = terrainColor(avgH, cxm, czm, seed, dist).fill;
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
        // Stroke with the same colour so anti-aliasing never opens a gap
        // between neighbouring quads.
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    this.drawRunwayMarks(ctx, world, cam);
    this.drawTrees(ctx, world, cam);
  }

  drawRunwayMarks(ctx, world, cam) {
    // Centreline dashes and edge lights for both runways.
    ctx.save();
    for (const r of [COURSE.runwayA, COURSE.runwayB]) {
      for (let z = r.z0 + 20; z < r.z1; z += 60) {
        const a = project({ x: -1.5, y: 0.4, z }, cam, VIEW_W / 2, VIEW_H / 2);
        const b = project({ x: 1.5, y: 0.4, z: z + 26 }, cam, VIEW_W / 2, VIEW_H / 2);
        if (!a || !b) continue;
        ctx.strokeStyle = 'rgba(242,245,247,0.9)';
        ctx.lineWidth = Math.max(1, 260 / a.z);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let z = r.z0 + 10; z < r.z1; z += 60) {
        for (const x of [r.x0, r.x1]) {
          const p = project({ x, y: 0.6, z }, cam, VIEW_W / 2, VIEW_H / 2);
          if (!p || p.x < 0 || p.x > VIEW_W || p.y < 0 || p.y > VIEW_H) continue;
          ctx.fillStyle = '#ffb347';
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1.2, 160 / p.z), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  drawTrees(ctx, world, cam) {
    // Nearest trees last so they overlap the far ones.
    const visible = [];
    for (const t of world.course.trees) {
      if (t.z < cam.z - 10 || t.z > cam.z + 1150) continue;
      const p = project({ x: t.x, y: t.y, z: t.z }, cam, VIEW_W / 2, VIEW_H / 2);
      if (!p || p.x < -40 || p.x > VIEW_W + 40 || p.y < -40 || p.y > VIEW_H + 40) continue;
      visible.push({ t, p });
    }
    visible.sort((a, b) => b.p.z - a.p.z);
    for (const { t, p } of visible) {
      const k = FOCAL / p.z;
      const h = t.s * k * 1.6;
      const w = h * 0.55;
      if (h < 1.5) continue;
      ctx.fillStyle = '#3f6b2f';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - h);
      ctx.lineTo(p.x - w / 2, p.y);
      ctx.lineTo(p.x + w / 2, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(63,107,47,0.75)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - h * 0.72);
      ctx.lineTo(p.x - w * 0.32, p.y - h * 0.28);
      ctx.lineTo(p.x + w * 0.32, p.y - h * 0.28);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawRings(ctx, world, cam) {
    const s = world.state;
    const next = world.nextRing();
    for (const ring of world.course.rings) {
      if (ring.taken) continue;
      const p = project(ring, cam, VIEW_W / 2, VIEW_H / 2);
      if (!p) continue;
      const k = FOCAL / p.z;
      const rr = ring.r * k;
      if (rr < 2 || p.x < -rr * 2 || p.x > VIEW_W + rr * 2 || p.y < -rr * 2 || p.y > VIEW_H + rr * 2) continue;
      const isNext = ring === next;
      const pulse = isNext ? 0.75 + 0.25 * Math.sin(performance.now() / 180) : 0.55;
      // Approximate the ring (a circle in the XY plane) with projected points.
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const q = project(
          { x: ring.x + Math.cos(a) * ring.r, y: ring.y + Math.sin(a) * ring.r, z: ring.z },
          cam,
          VIEW_W / 2,
          VIEW_H / 2,
        );
        if (q) pts.push(q);
      }
      if (pts.length < 8) continue;
      const stroke = (width, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
      };
      const col = isNext ? '255, 176, 32' : '64, 224, 208';
      stroke(Math.max(2, rr * 0.16), `rgba(${col},${0.25 * pulse})`);
      stroke(Math.max(1.5, rr * 0.07), `rgba(${col},${pulse})`);
      // Centre beacon.
      ctx.fillStyle = `rgba(${col},${pulse})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, rr * 0.06), 0, Math.PI * 2);
      ctx.fill();
      if (isNext) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(12, Math.min(22, rr * 0.5))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`RING ${ring.index + 1}`, p.x, p.y - rr - 10);
      }
    }
    void s;
  }

  drawPlane(ctx, s, time) {
    ctx.save();
    ctx.translate(PLANE_X, PLANE_Y);
    ctx.rotate(s.roll * 0.55);
    const bob = Math.sin(time / 240) * 1.5;
    ctx.translate(0, bob);
    // Shadow on the ground far below is skipped; the plane is the chase subject.
    // Main wings.
    ctx.fillStyle = '#e8590c';
    ctx.beginPath();
    ctx.moveTo(-118, 6);
    ctx.quadraticCurveTo(-118, -6, -96, -8);
    ctx.lineTo(-14, -4);
    ctx.lineTo(14, -4);
    ctx.lineTo(96, -8);
    ctx.quadraticCurveTo(118, -6, 118, 6);
    ctx.lineTo(96, 12);
    ctx.lineTo(-96, 12);
    ctx.closePath();
    ctx.fill();
    // Fuselage.
    const fg = ctx.createLinearGradient(0, -46, 0, 34);
    fg.addColorStop(0, '#f8fafc');
    fg.addColorStop(0.55, '#dde5ec');
    fg.addColorStop(1, '#9aa7b4');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(0, -4, 17, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    // Orange cheatline.
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(-15, -26, 30, 7);
    // Tail fin and stabilisers.
    ctx.fillStyle = '#e8590c';
    ctx.beginPath();
    ctx.moveTo(-4, -44);
    ctx.lineTo(4, -44);
    ctx.lineTo(9, -66);
    ctx.lineTo(-9, -66);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c2410c';
    ctx.beginPath();
    ctx.moveTo(-34, -38);
    ctx.lineTo(34, -38);
    ctx.lineTo(26, -30);
    ctx.lineTo(-26, -30);
    ctx.closePath();
    ctx.fill();
    // Cockpit windows (lit).
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    ctx.ellipse(0, -30, 9, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.ellipse(-2, -32, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Spinning propeller disc at the nose.
    ctx.save();
    ctx.translate(0, 40);
    ctx.rotate(this.propAngle);
    ctx.fillStyle = 'rgba(30,41,59,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, 40, 6, 0, Math.PI * 2);
    ctx.fill();
    // Nav lights: red left, green right, blinking white tail.
    const blink = Math.sin(time / 160) > 0;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(-118, 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(118, 4, 4, 0, Math.PI * 2);
    ctx.fill();
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -64, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHud(ctx, world, screen, opts) {
    const s = world.state;
    const knots = Math.round(s.speed * 1.944);
    const hdg = Math.round(((s.heading * 180) / Math.PI % 360 + 360) % 360);
    const alt = Math.max(0, Math.round(s.y - world.groundY(s.x, s.z)));
    const agl = Math.max(0, Math.round(s.y));
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Top-left flight data block.
    ctx.fillStyle = 'rgba(8, 20, 36, 0.62)';
    roundRect(ctx, 16, 14, 300, 96, 10);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('ALTITUDE', 30, 38);
    ctx.fillText('SPEED', 128, 38);
    ctx.fillText('HEADING', 226, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(`${agl}m`, 30, 68);
    ctx.fillText(`${knots}kt`, 128, 68);
    ctx.fillText(`${String(hdg).padStart(3, '0')}°`, 226, 68);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`AGL ${alt}m  ·  VS ${Math.round(s.speed * Math.sin(s.pitch))} m/s`, 30, 94);
    // Top-right score block.
    ctx.fillStyle = 'rgba(8, 20, 36, 0.62)';
    roundRect(ctx, VIEW_W - 316, 14, 300, 96, 10);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('SCORE', VIEW_W - 302, 38);
    ctx.fillText('RINGS', VIEW_W - 204, 38);
    ctx.fillText('TIME', VIEW_W - 106, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(`${s.score}`, VIEW_W - 302, 68);
    ctx.fillText(`${s.rings}/${world.course.rings.length}`, VIEW_W - 204, 68);
    const mm = String(Math.floor(s.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(s.time % 60)).padStart(2, '0');
    ctx.fillText(`${mm}:${ss}`, VIEW_W - 106, 68);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('8 rings · land on the far runway', VIEW_W - 302, 94);
    // Objective line under the top bar (not on the title screen: the title
    // already states the mission, and the pill would sit under its heading).
    const next = world.nextRing();
    if (screen !== 'title') {
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(8, 20, 36, 0.55)';
      const msg = next
        ? `NEXT RING ${next.index + 1} — ${Math.round(Math.hypot(next.x - s.x, next.y - s.y, next.z - s.z))}m ahead`
        : 'ALL RINGS — LAND ON RUNWAY 27';
      const w = ctx.measureText(msg).width + 28;
      roundRect(ctx, VIEW_W / 2 - w / 2, 122, w, 30, 15);
      ctx.fill();
      ctx.fillStyle = next ? '#fbbf24' : '#4ade80';
      ctx.fillText(msg, VIEW_W / 2, 143);
    }
    // Warning banner.
    if (s.warned) {
      ctx.font = 'bold 20px system-ui, sans-serif';
      const ww = ctx.measureText(s.warned).width + 32;
      ctx.fillStyle = 'rgba(127, 29, 29, 0.85)';
      roundRect(ctx, VIEW_W / 2 - ww / 2, 164, ww, 34, 8);
      ctx.fill();
      ctx.fillStyle = '#fecaca';
      ctx.fillText(s.warned, VIEW_W / 2, 188);
    }
    // Next-ring edge arrow when the ring is off screen.
    if (next && screen === 'play') this.drawRingArrow(ctx, world, next);
    ctx.restore();
  }

  drawRingArrow(ctx, world, ring) {
    const s = world.state;
    const dx = ring.x - s.x;
    const dz = ring.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 120) return;
    const desired = Math.atan2(dx, dz);
    const rel = Math.sin(desired - s.heading);
    const absRel = Math.abs(rel);
    if (absRel < 0.25) return; // roughly ahead already
    const x = rel > 0 ? VIEW_W - 60 : 60;
    const y = 330;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rel > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(16, 12);
    ctx.lineTo(0, 4);
    ctx.lineTo(-16, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(dist)}m`, x, y + 42);
  }

  drawPanel(ctx, world, screen, opts) {
    // Glass-cockpit strip along the bottom: attitude, altitude, speed,
    // heading tape, throttle and fuel.
    const s = world.state;
    const y0 = VIEW_H - 108;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 20, 36, 0.78)';
    ctx.fillRect(0, y0, VIEW_W, 108);
    ctx.fillStyle = 'rgba(125, 211, 252, 0.25)';
    ctx.fillRect(0, y0, VIEW_W, 2);
    // Artificial horizon.
    const cx = 92;
    const cy = y0 + 54;
    const r = 42;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-s.roll);
    ctx.translate(0, s.pitch * 220);
    ctx.fillStyle = '#3b82c4';
    ctx.fillRect(-r - 2, -r - 60, r * 2 + 4, r + 60);
    ctx.fillStyle = '#8a6b45';
    ctx.fillRect(-r - 2, 0, r * 2 + 4, r + 60);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-r - 2, -2, r * 2 + 4, 4);
    ctx.restore();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.stroke();
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE', cx, y0 + 102);
    // Altimeter tape.
    this.drawTape(ctx, 220, y0, 'ALT m', Math.round(s.y), 20, (v) => `${v}`);
    // Airspeed tape.
    this.drawTape(ctx, 340, y0, 'SPD kt', Math.round(s.speed * 1.944), 10, (v) => `${v}`);
    // Heading compass tape.
    this.drawCompass(ctx, 560, y0, s.heading);
    // Throttle + fuel bars.
    const bx = 830;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('THROTTLE', bx, y0 + 18);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, bx, y0 + 26, 180, 14, 7);
    ctx.fill();
    ctx.fillStyle = s.throttle > 0.85 ? '#f59e0b' : '#38bdf8';
    roundRect(ctx, bx, y0 + 26, 180 * s.throttle, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText('FUEL', bx, y0 + 62);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, bx, y0 + 70, 180, 14, 7);
    ctx.fill();
    ctx.fillStyle = s.fuel < 20 ? '#ef4444' : '#4ade80';
    roundRect(ctx, bx, y0 + 70, 180 * (s.fuel / 100), 14, 7);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${Math.round(s.throttle * 100)}%`, bx + 188, y0 + 39);
    ctx.fillText(`${Math.round(s.fuel)}%`, bx + 188, y0 + 83);
    // Controls reminder.
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Arrows / mouse — fly', VIEW_W - 24, y0 + 30);
    ctx.fillText('W / S — throttle', VIEW_W - 24, y0 + 52);
    ctx.fillText('P — pause · R — restart', VIEW_W - 24, y0 + 74);
    ctx.restore();
  }

  drawTape(ctx, x, y0, label, value, step, fmt) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(label, x, y0 + 18);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, x - 48, y0 + 26, 96, 62, 6);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 48, y0 + 26, 96, 62);
    ctx.clip();
    const span = 3;
    for (let i = -span; i <= span; i++) {
      const v = Math.round(value / step) * step + i * step;
      if (v < 0 && i !== 0) continue;
      const yy = y0 + 57 - i * 16;
      ctx.fillStyle = i === 0 ? '#ffffff' : '#94a3b8';
      ctx.font = i === 0 ? 'bold 15px system-ui, sans-serif' : '12px system-ui, sans-serif';
      ctx.fillText(fmt(i === 0 ? value : v), x, yy + 4);
    }
    ctx.restore();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 48, y0 + 57);
    ctx.lineTo(x - 38, y0 + 57);
    ctx.moveTo(x + 38, y0 + 57);
    ctx.lineTo(x + 48, y0 + 57);
    ctx.stroke();
    ctx.restore();
  }

  drawCompass(ctx, x, y0, heading) {
    const deg = ((heading * 180) / Math.PI % 360 + 360) % 360;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('HEADING', x, y0 + 18);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, x - 110, y0 + 26, 220, 62, 6);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 110, y0 + 26, 220, 62);
    ctx.clip();
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -180; d <= 180; d += 15) {
      const dd = ((Math.round(deg / 15) * 15 + d) % 360 + 360) % 360;
      const xx = x + (d * 220) / 180;
      const major = dd % 45 === 0;
      // Tick marks every 15 degrees; labels only on the 45-degree cardinals
      // so the tape never overlaps itself.
      ctx.fillStyle = major ? '#ffffff' : '#5b6b7c';
      ctx.fillRect(xx - 0.5, y0 + 58, 1, major ? 10 : 6);
      if (!major) continue;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(names[dd], xx, y0 + 48);
    }
    ctx.restore();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(x - 7, y0 + 26);
    ctx.lineTo(x + 7, y0 + 26);
    ctx.lineTo(x, y0 + 36);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(`${String(Math.round(deg)).padStart(3, '0')}°`, x, y0 + 82);
    ctx.restore();
  }

  drawScreen(ctx, world, screen, opts) {
    const s = world.state;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 24, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H - 108);
    ctx.textAlign = 'center';
    if (screen === 'title') {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.fillText('SKYLINE COURIER', VIEW_W / 2, 190);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '28px system-ui, sans-serif';
      ctx.fillText('A chase-view flight game over a mountain valley', VIEW_W / 2, 236);
      ctx.font = '19px system-ui, sans-serif';
      ctx.fillStyle = '#bae6fd';
      ctx.fillText('Take off from Runway 09 · fly all 8 glowing rings · land on Runway 27', VIEW_W / 2, 292);
      ctx.fillText('before the fuel runs out. Watch the terrain — the valley walls bite.', VIEW_W / 2, 322);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText('ENTER or CLICK to fly  ·  Arrows / mouse steer  ·  W / S throttle', VIEW_W / 2, 392);
      if (opts.best > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '18px system-ui, sans-serif';
        ctx.fillText(`Best score: ${opts.best}`, VIEW_W / 2, 432);
      }
    } else if (screen === 'pause') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px system-ui, sans-serif';
      ctx.fillText('PAUSED', VIEW_W / 2, 300);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('Press P to keep flying · R to restart', VIEW_W / 2, 348);
    } else if (screen === 'over') {
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 56px system-ui, sans-serif';
      ctx.fillText('CRASHED', VIEW_W / 2, 260);
      ctx.fillStyle = '#fecaca';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(s.crashReason || 'THE VALLEY WINS THIS TIME', VIEW_W / 2, 308);
      this.drawScoreLines(ctx, world, 360);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText('Press R to fly again', VIEW_W / 2, 480);
    } else if (screen === 'done') {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 56px system-ui, sans-serif';
      ctx.fillText('MISSION COMPLETE', VIEW_W / 2, 240);
      ctx.fillStyle = '#bbf7d0';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText('All 8 rings, wheels down on Runway 27. The valley is yours.', VIEW_W / 2, 288);
      this.drawScoreLines(ctx, world, 340);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText('Press R to fly again', VIEW_W / 2, 480);
    }
    ctx.restore();
  }

  drawScoreLines(ctx, world, y) {
    const s = world.state;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(`Rings flown: ${s.rings} / ${world.course.rings.length}   ·   Time: ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`, VIEW_W / 2, y);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(`SCORE  ${s.score}`, VIEW_W / 2, y + 44);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
