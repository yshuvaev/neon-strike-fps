// Procedural texture generation — all surfaces are painted on canvas at runtime,
// including derived normal maps (Sobel over a height field). No external assets.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }

// Value noise painter: scatter soft radial blotches, composited additively.
function blotch(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', alpha.toFixed(3)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function grime(ctx, w, h, count, color, aMin, aMax, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    blotch(ctx, rand(0, w), rand(0, h), rand(rMin, rMax), color, rand(aMin, aMax));
  }
}

function scratches(ctx, w, h, count, alpha, light) {
  for (let i = 0; i < count; i++) {
    const x = rand(0, w), y = rand(0, h);
    const len = rand(20, 160), ang = rand(0, Math.PI * 2);
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${alpha * rand(0.4, 1)})`
      : `rgba(0,0,0,${alpha * rand(0.4, 1)})`;
    ctx.lineWidth = rand(0.5, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x2) / 2 + rand(-8, 8), (y + y2) / 2 + rand(-8, 8), x2, y2);
    ctx.stroke();
  }
}

function toTexture(canvas, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Sobel height→normal. Height read from canvas luminance.
function normalFromHeight(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const lum = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (src[i] + src[i + 1] + src[i + 2]) / 765;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = lum(x - 1, y - 1), t = lum(x, y - 1), tr = lum(x + 1, y - 1);
      const l = lum(x - 1, y), r = lum(x + 1, y);
      const bl = lum(x - 1, y + 1), b = lum(x, y + 1), br = lum(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return toTexture(out, { srgb: false });
}

function noiseFill(ctx, w, h, base, spread, cell = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const v = Math.floor(rand(-spread, spread));
      if (v !== 0) {
        ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

/* ---------------- Floor: riveted metal plates ---------------- */
export function makeFloor() {
  const S = 1024, cols = 4, rows = 4, pw = S / cols, ph = S / rows;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const hc = makeCanvas(S, S), hx = hc.getContext('2d');

  noiseFill(x, S, S, '#262a31', 26);
  hx.fillStyle = '#404040'; hx.fillRect(0, 0, S, S);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const px = gx * pw, py = gy * ph;
      const shade = randi(-8, 10);
      // plate face
      x.fillStyle = `rgb(${58 + shade},${63 + shade},${72 + shade})`;
      x.fillRect(px + 3, py + 3, pw - 6, ph - 6);
      hx.fillStyle = '#8a8a8a';
      hx.fillRect(px + 3, py + 3, pw - 6, ph - 6);

      // bevel light/shadow
      x.strokeStyle = 'rgba(255,255,255,0.16)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(px + 3, py + ph - 4); x.lineTo(px + 3, py + 3); x.lineTo(px + pw - 4, py + 3); x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.45)';
      x.beginPath(); x.moveTo(px + pw - 3, py + 3); x.lineTo(px + pw - 3, py + ph - 3); x.lineTo(px + 3, py + ph - 3); x.stroke();
      hx.strokeStyle = '#b0b0b0'; hx.lineWidth = 3;
      hx.beginPath(); hx.moveTo(px + 3, py + ph - 4); hx.lineTo(px + 3, py + 3); hx.lineTo(px + pw - 4, py + 3); hx.stroke();

      // rivets
      const rivet = (rx, ry) => {
        const g = x.createRadialGradient(rx - 2, ry - 2, 1, rx, ry, 7);
        g.addColorStop(0, '#9aa2ad'); g.addColorStop(0.7, '#3a3f47'); g.addColorStop(1, '#15171b');
        x.fillStyle = g;
        x.beginPath(); x.arc(rx, ry, 6, 0, Math.PI * 2); x.fill();
        const hg = hx.createRadialGradient(rx, ry, 0, rx, ry, 7);
        hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#404040');
        hx.fillStyle = hg;
        hx.beginPath(); hx.arc(rx, ry, 6, 0, Math.PI * 2); hx.fill();
      };
      const m = 18;
      rivet(px + m, py + m); rivet(px + pw - m, py + m);
      rivet(px + m, py + ph - m); rivet(px + pw - m, py + ph - m);

      // wear streak along plate
      for (let s = 0; s < 3; s++) {
        x.fillStyle = `rgba(0,0,0,${rand(0.04, 0.1)})`;
        x.fillRect(px + rand(10, pw - 60), py, rand(2, 6), ph);
      }
    }
  }
  // seams
  x.strokeStyle = 'rgba(0,0,0,0.8)'; x.lineWidth = 5;
  for (let i = 0; i <= cols; i++) { x.beginPath(); x.moveTo(i * pw, 0); x.lineTo(i * pw, S); x.stroke(); }
  for (let i = 0; i <= rows; i++) { x.beginPath(); x.moveTo(0, i * ph); x.lineTo(S, i * ph); x.stroke(); }
  hx.strokeStyle = '#101010'; hx.lineWidth = 6;
  for (let i = 0; i <= cols; i++) { hx.beginPath(); hx.moveTo(i * pw, 0); hx.lineTo(i * pw, S); hx.stroke(); }
  for (let i = 0; i <= rows; i++) { hx.beginPath(); hx.moveTo(0, i * ph); hx.lineTo(S, i * ph); hx.stroke(); }

  scratches(x, S, S, 240, 0.10, true);
  scratches(x, S, S, 200, 0.14, false);
  scratches(hx, S, S, 240, 0.25, true);
  grime(x, S, S, 60, 'rgba(10,12,16,A)', 0.12, 0.3, 40, 160);
  grime(x, S, S, 26, 'rgba(96,120,90,A)', 0.05, 0.12, 30, 90); // mossy tint

  // hazard chevrons strip on one row of plates
  x.save();
  x.beginPath(); x.rect(0, rows * ph - ph, S, ph); x.clip();
  x.fillStyle = 'rgba(214,164,32,0.16)';
  x.fillRect(0, rows * ph - ph, S, ph);
  x.strokeStyle = 'rgba(10,10,10,0.5)'; x.lineWidth = 16;
  for (let i = -2; i < cols * 2 + 2; i++) {
    x.beginPath();
    x.moveTo(i * 90, rows * ph); x.lineTo(i * 90 + 90, rows * ph - ph);
    x.stroke();
  }
  x.restore();

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 2.2) };
}

/* ---------------- Wall: armored panels ---------------- */
export function makeWall() {
  const S = 1024;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const hc = makeCanvas(S, S), hx = hc.getContext('2d');

  noiseFill(x, S, S, '#2c313a', 20);
  hx.fillStyle = '#505050'; hx.fillRect(0, 0, S, S);

  // horizontal panel bands
  const bands = [0, 200, 560, 780, 1024];
  for (let b = 0; b < bands.length - 1; b++) {
    const y0 = bands[b], h = bands[b + 1] - y0;
    const shade = randi(-6, 8);
    x.fillStyle = `rgb(${52 + shade},${57 + shade},${66 + shade})`;
    x.fillRect(0, y0 + 2, S, h - 4);
    hx.fillStyle = '#787878';
    hx.fillRect(0, y0 + 2, S, h - 4);
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.fillRect(0, y0, S, 4);
    hx.fillStyle = '#141414';
    hx.fillRect(0, y0, S, 5);
  }

  // vertical seams + rivet columns
  for (let i = 0; i <= 4; i++) {
    const sx = i * 256;
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(sx - 2, 0, 5, S);
    hx.fillStyle = '#181818'; hx.fillRect(sx - 2, 0, 6, S);
    for (let y = 30; y < S; y += 90) {
      const g = x.createRadialGradient(sx + 14, y - 2, 1, sx + 14, y, 6);
      g.addColorStop(0, '#8d95a1'); g.addColorStop(0.7, '#33373e'); g.addColorStop(1, '#101216');
      x.fillStyle = g;
      x.beginPath(); x.arc(sx + 14, y, 5.5, 0, Math.PI * 2); x.fill();
      const hg = hx.createRadialGradient(sx + 14, y, 0, sx + 14, y, 6);
      hg.addColorStop(0, '#eee'); hg.addColorStop(1, '#505050');
      hx.fillStyle = hg;
      hx.beginPath(); hx.arc(sx + 14, y, 5.5, 0, Math.PI * 2); hx.fill();
    }
  }

  // vent grilles in the middle band
  for (const vx of [180, 640]) {
    x.fillStyle = '#171a1f'; x.fillRect(vx, 610, 220, 110);
    hx.fillStyle = '#222'; hx.fillRect(vx, 610, 220, 110);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = '#454b55';
      x.fillRect(vx + 10, 618 + i * 14, 200, 7);
      hx.fillStyle = '#999';
      hx.fillRect(vx + 10, 618 + i * 14, 200, 7);
    }
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2;
    x.strokeRect(vx, 610, 220, 110);
  }

  // stencil markings
  x.fillStyle = 'rgba(190,200,212,0.5)';
  x.font = '900 84px monospace';
  x.fillText('07', 860, 540);
  x.font = '700 26px monospace';
  x.fillStyle = 'rgba(214,164,32,0.55)';
  x.fillText('SECTOR-7 // RESTRICTED', 60, 108);
  x.font = '700 22px monospace';
  x.fillStyle = 'rgba(190,200,212,0.32)';
  x.fillText('MAINT ACCESS 4B', 700, 1050 > S ? S - 20 : 1050);

  // caution stripe band at the bottom
  x.save();
  x.beginPath(); x.rect(0, 900, S, 60); x.clip();
  x.fillStyle = 'rgba(214,164,32,0.75)'; x.fillRect(0, 900, S, 60);
  x.fillStyle = 'rgba(12,12,12,0.9)';
  for (let i = -1; i < 10; i++) {
    x.beginPath();
    x.moveTo(i * 128, 960); x.lineTo(i * 128 + 64, 900);
    x.lineTo(i * 128 + 128, 900); x.lineTo(i * 128 + 64, 960);
    x.fill();
  }
  x.restore();

  scratches(x, S, S, 200, 0.1, true);
  scratches(x, S, S, 220, 0.13, false);
  grime(x, S, S, 70, 'rgba(8,10,14,A)', 0.1, 0.28, 50, 200);
  grime(x, S, S, 24, 'rgba(140,90,40,A)', 0.05, 0.12, 20, 70); // rust

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 2.0) };
}

/* ---------------- Crate: military supply box ---------------- */
export function makeCrate() {
  const S = 512;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const hc = makeCanvas(S, S), hx = hc.getContext('2d');

  noiseFill(x, S, S, '#3d4433', 22);
  hx.fillStyle = '#606060'; hx.fillRect(0, 0, S, S);

  // corner reinforcements
  const corner = (cx, cy) => {
    x.fillStyle = '#22262b';
    x.fillRect(cx, cy, 90, 90);
    hx.fillStyle = '#909090';
    hx.fillRect(cx, cy, 90, 90);
    x.strokeStyle = 'rgba(255,255,255,0.1)'; x.lineWidth = 2;
    x.strokeRect(cx + 4, cy + 4, 82, 82);
  };
  corner(0, 0); corner(S - 90, 0); corner(0, S - 90); corner(S - 90, S - 90);

  // center cross frame
  x.fillStyle = 'rgba(20,23,27,0.85)';
  x.fillRect(S / 2 - 28, 0, 56, S);
  x.fillRect(0, S / 2 - 28, S, 56);
  hx.fillStyle = '#888';
  hx.fillRect(S / 2 - 28, 0, 56, S);
  hx.fillRect(0, S / 2 - 28, S, 56);

  // bolts
  for (let i = 0; i < 8; i++) {
    const bx = 30 + (i % 4) * 150, by = i < 4 ? 30 : S - 30;
    const g = x.createRadialGradient(bx - 2, by - 2, 1, bx, by, 8);
    g.addColorStop(0, '#9aa2ad'); g.addColorStop(0.7, '#2c3036'); g.addColorStop(1, '#0c0e11');
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, by, 8, 0, Math.PI * 2); x.fill();
  }

  // stencil
  x.save();
  x.translate(S / 2, S / 2); x.rotate(-Math.PI / 2);
  x.font = '900 44px monospace';
  x.textAlign = 'center';
  x.fillStyle = 'rgba(214,164,32,0.7)';
  x.fillText('SUPPLY // A-113', 0, 14);
  x.restore();
  x.font = '700 30px monospace';
  x.fillStyle = 'rgba(200,208,218,0.5)';
  x.fillText('THIS SIDE UP ↑', 120, 70);

  scratches(x, S, S, 130, 0.12, false);
  scratches(x, S, S, 80, 0.08, true);
  grime(x, S, S, 30, 'rgba(8,10,12,A)', 0.1, 0.3, 40, 140);

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 2.4) };
}

/* ---------------- Barrel: explosive ---------------- */
export function makeBarrel() {
  const S = 512, H = 512;
  const c = makeCanvas(S, H), x = c.getContext('2d');
  const hc = makeCanvas(S, H), hx = hc.getContext('2d');

  noiseFill(x, S, H, '#7a1f1c', 24);
  hx.fillStyle = '#606060'; hx.fillRect(0, 0, S, H);

  // rolling hoops
  for (const hy of [60, 190, 320, 450]) {
    x.fillStyle = '#4a1210'; x.fillRect(0, hy, S, 26);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, hy, S, 4);
    hx.fillStyle = '#a0a0a0'; hx.fillRect(0, hy, S, 26);
  }

  // hazard band
  x.save();
  x.beginPath(); x.rect(0, 240, S, 80); x.clip();
  x.fillStyle = '#d6a420'; x.fillRect(0, 240, S, 80);
  x.fillStyle = '#141414';
  for (let i = -1; i < 8; i++) {
    x.beginPath();
    x.moveTo(i * 128, 320); x.lineTo(i * 128 + 64, 240);
    x.lineTo(i * 128 + 128, 240); x.lineTo(i * 128 + 64, 320);
    x.fill();
  }
  x.restore();
  hx.fillStyle = '#909090'; hx.fillRect(0, 240, S, 80);

  // label
  x.fillStyle = 'rgba(230,235,240,0.85)';
  x.font = '900 52px monospace'; x.textAlign = 'center';
  x.fillText('FLAMMABLE', S / 2, 150);
  x.font = '700 30px monospace';
  x.fillStyle = 'rgba(230,235,240,0.6)';
  x.fillText('NO OPEN FLAME', S / 2, 400);

  // rust streaks running down
  for (let i = 0; i < 40; i++) {
    const sx = rand(0, S), sy = rand(0, H * 0.7), len = rand(20, 120);
    const g = x.createLinearGradient(0, sy, 0, sy + len);
    g.addColorStop(0, `rgba(120,66,28,${rand(0.15, 0.4)})`);
    g.addColorStop(1, 'rgba(120,66,28,0)');
    x.fillStyle = g;
    x.fillRect(sx, sy, rand(2, 6), len);
  }
  scratches(x, S, H, 120, 0.12, true);
  scratches(x, S, H, 100, 0.14, false);
  grime(x, S, H, 26, 'rgba(8,8,10,A)', 0.12, 0.3, 40, 120);

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 2.2) };
}

/* ---------------- Enemy chassis: carbon hex + emissive circuits ---------------- */
export function makeEnemy(variant) {
  const S = 512;
  const palettes = {
    runner:  { base: '#23262e', line: '#ff8a2a', glow: '#ff5a1e' },
    brute:   { base: '#2e2326', line: '#ff4e4e', glow: '#ff1e3c' },
    spitter: { base: '#1f2a2c', line: '#3ee0ff', glow: '#1eb8ff' },
  };
  const p = palettes[variant] || palettes.runner;

  const c = makeCanvas(S, S), x = c.getContext('2d');
  const hc = makeCanvas(S, S), hx = hc.getContext('2d');
  const e = makeCanvas(S, S), ex = e.getContext('2d');

  noiseFill(x, S, S, p.base, 16);
  hx.fillStyle = '#585858'; hx.fillRect(0, 0, S, S);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);

  // carbon-fiber hex cells
  const r = 22;
  for (let row = 0; row * r * 1.5 < S + r; row++) {
    for (let col = 0; col * r * Math.sqrt(3) < S + r; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? r * Math.sqrt(3) / 2 : 0);
      const cy = row * r * 1.5;
      x.strokeStyle = 'rgba(0,0,0,0.5)';
      x.lineWidth = 2;
      x.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k + Math.PI / 6;
        const px = cx + Math.cos(a) * r * 0.9, py = cy + Math.sin(a) * r * 0.9;
        k === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.closePath(); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.05)';
      x.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k + Math.PI / 6;
        const px = cx + Math.cos(a) * r * 0.82, py = cy + Math.sin(a) * r * 0.82;
        k === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.closePath(); x.stroke();
    }
  }

  // armor seams
  x.strokeStyle = 'rgba(0,0,0,0.65)'; x.lineWidth = 6;
  for (let i = 0; i < 6; i++) {
    const y0 = rand(0, S);
    x.beginPath(); x.moveTo(0, y0);
    x.lineTo(rand(S * 0.4, S * 0.6), y0 + rand(-80, 80));
    x.lineTo(S, y0 + rand(-60, 60));
    x.stroke();
  }

  // glowing circuit traces (emissive map)
  ex.strokeStyle = p.glow; ex.lineWidth = 5;
  ex.shadowColor = p.glow; ex.shadowBlur = 12;
  for (let i = 0; i < 14; i++) {
    let px = rand(0, S), py = rand(0, S);
    ex.beginPath(); ex.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      if (Math.random() < 0.5) px = rand(0, S); else py = rand(0, S);
      ex.lineTo(px, py);
    }
    ex.stroke();
    ex.beginPath(); ex.arc(px, py, 7, 0, Math.PI * 2); ex.fillStyle = p.glow; ex.fill();
  }
  // faint traces on the color map too
  x.strokeStyle = p.line; x.lineWidth = 2; x.globalAlpha = 0.5;
  x.drawImage(e, 0, 0);
  x.globalAlpha = 1;

  scratches(x, S, S, 100, 0.14, false);
  scratches(x, S, S, 60, 0.07, true);
  grime(x, S, S, 20, 'rgba(5,6,8,A)', 0.15, 0.35, 40, 120);

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 1.6), emissiveMap: toTexture(e) };
}

/* ---------------- Gunmetal (viewmodel) ---------------- */
export function makeGun() {
  const S = 512;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const hc = makeCanvas(S, S), hx = hc.getContext('2d');

  noiseFill(x, S, S, '#23262b', 18);
  hx.fillStyle = '#585858'; hx.fillRect(0, 0, S, S);

  // machined grooves
  for (let i = 0; i < 10; i++) {
    const y0 = i * 52 + 10;
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, y0, S, 6);
    x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(0, y0 + 6, S, 3);
    hx.fillStyle = '#a0a0a0'; hx.fillRect(0, y0, S, 6);
  }
  scratches(x, S, S, 140, 0.1, true);
  scratches(x, S, S, 100, 0.12, false);
  grime(x, S, S, 20, 'rgba(6,8,10,A)', 0.12, 0.3, 40, 120);

  return { map: toTexture(c), normalMap: normalFromHeight(hc, 2.0) };
}

/* ---------------- Sky dome ---------------- */
export function makeSky() {
  const W = 2048, H = 1024;
  const c = makeCanvas(W, H), x = c.getContext('2d');

  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#02030a');
  g.addColorStop(0.45, '#070c1c');
  g.addColorStop(0.75, '#101a33');
  g.addColorStop(1, '#1a2a4a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // nebulae
  const nebColors = ['rgba(90,40,160,A)', 'rgba(20,90,140,A)', 'rgba(160,40,90,A)', 'rgba(20,120,110,A)'];
  for (let i = 0; i < 26; i++) {
    blotch(x, rand(0, W), rand(0, H * 0.8), rand(90, 320), nebColors[randi(0, 3)], rand(0.03, 0.10));
  }

  // star field with varying brightness / size
  for (let i = 0; i < 1400; i++) {
    const sx = rand(0, W), sy = rand(0, H * 0.92);
    const mag = Math.random();
    const r = mag < 0.85 ? rand(0.4, 1.1) : rand(1.2, 2.2);
    x.fillStyle = `rgba(255,255,255,${0.25 + mag * 0.75})`;
    x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill();
    if (mag > 0.93) {
      x.fillStyle = 'rgba(180,220,255,0.25)';
      x.beginPath(); x.arc(sx, sy, r * 3.5, 0, Math.PI * 2); x.fill();
    }
  }

  // distant skyline silhouette along the horizon
  x.fillStyle = '#05070f';
  let bx = 0;
  while (bx < W) {
    const bw = rand(30, 110), bh = rand(10, 70);
    x.fillRect(bx, H * 0.92 - bh, bw, bh + H * 0.08);
    // window lights
    for (let w = 0; w < bw * bh / 260; w++) {
      x.fillStyle = Math.random() < 0.7 ? 'rgba(255,190,90,0.5)' : 'rgba(120,220,255,0.5)';
      x.fillRect(bx + rand(3, bw - 5), H * 0.92 - bh + rand(3, bh - 6), 2, 3);
      x.fillStyle = '#05070f';
    }
    bx += bw + rand(2, 14);
  }

  // horizon glow
  const hg = x.createLinearGradient(0, H * 0.88, 0, H);
  hg.addColorStop(0, 'rgba(60,140,190,0)');
  hg.addColorStop(0.7, 'rgba(60,140,190,0.22)');
  hg.addColorStop(1, 'rgba(90,190,220,0.35)');
  x.fillStyle = hg;
  x.fillRect(0, H * 0.88, W, H * 0.12);

  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ---------------- Sprite helpers ---------------- */
export function makeGlowSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,180,60,0)') {
  const S = 128;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace('1)', '0.6)'));
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return toTexture(c);
}

export function makeSmokeSprite() {
  const S = 128;
  const c = makeCanvas(S, S), x = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    blotch(x, rand(30, 98), rand(30, 98), rand(12, 34), 'rgba(160,160,165,A)', rand(0.04, 0.12));
  }
  return toTexture(c);
}
