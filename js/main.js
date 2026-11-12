// NEON STRIKE — entry point: renderer, post-processing, waves, scoring, loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';

const AUTOTEST = new URLSearchParams(location.search).has('autotest');
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 400);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ---------------- game objects ---------------- */
const audio = new AudioSys();
const world = new World(scene);
const fx = new FX(scene);
const player = new Player(camera, world, audio, fx);
const enemies = new EnemyManager(scene, world, fx, audio);

/* ---------------- game state ---------------- */
const state = {
  running: false,
  score: 0,
  wave: 0,
  combo: 0,
  lastKillT: -10,
  kills: 0,
  spawnQueue: [],
  spawnT: 0,
  intermission: -1,
  shake: 0,
  best: Number(localStorage.getItem('neonstrike_best') || 0),
};

const $ = (id) => document.getElementById(id);
const hud = $('hud');

/* ---------------- hooks ---------------- */
const hooks = {
  cameraPos: () => camera.position,
  onAmmoChange() {
    $('ammo').textContent = player.ammo;
    $('ammo-box').classList.toggle('empty', player.ammo === 0);
    $('reload-hint').classList.toggle('hidden', player.ammo > 0);
  },
  onFire() {
    const ch = $('crosshair');
    ch.classList.add('fire');
    clearTimeout(hooks._chT);
    hooks._chT = setTimeout(() => ch.classList.remove('fire'), 70);
  },
  onPlayerHurt() {
    $('damage-flash').style.opacity = 0.85;
    setTimeout(() => { $('damage-flash').style.opacity = 0; }, 120);
  },
  onPlayerHit(dmg) { player.hurt(dmg, hooks); },
  onPlayerDeath() { endGame(); },
  onKill(enemy, headshot) {
    // combo
    const now = performance.now() / 1000;
    state.combo = now - state.lastKillT < 3 ? Math.min(state.combo + 1, 5) : 1;
    state.lastKillT = now;
    state.kills++;

    const mult = 1 + (state.combo - 1) * 0.5;
    const gained = Math.round(enemy.cfg.score * mult * (headshot ? 1.5 : 1));
    state.score += gained;

    const hm = $('hitmarker');
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (headshot) hm.classList.add('kill');

    // floating score popup at screen center-ish
    const pop = document.createElement('div');
    pop.className = 'popup' + (headshot ? ' head' : '');
    pop.textContent = (headshot ? 'HEADSHOT ' : '') + '+' + gained + (state.combo > 1 ? '  ×' + state.combo : '');
    pop.style.left = 50 + (Math.random() - 0.5) * 14 + '%';
    pop.style.top = 42 + (Math.random() - 0.5) * 10 + '%';
    $('popups').appendChild(pop);
    setTimeout(() => pop.remove(), 950);

    updateHUD();
  },
  onBarrelIgnite() {},
};

player.bind(canvas, hooks);
hooks.onAmmoChange();

/* ---------------- waves ---------------- */
function waveComposition(n) {
  const comp = [];
  const runners = 3 + n * 2;
  for (let i = 0; i < runners; i++) comp.push('runner');
  for (let i = 0; i < Math.floor(n / 2); i++) comp.push('brute');
  for (let i = 0; i < Math.floor((n - 1) / 2) + (n > 2 ? 1 : 0); i++) comp.push('spitter');
  return comp;
}

function startWave(n) {
  state.wave = n;
  state.spawnQueue = waveComposition(n).sort(() => Math.random() - 0.5);
  state.spawnT = 0;
  const banner = $('wave-banner');
  banner.classList.remove('hidden');
  banner.innerHTML = `WAVE ${n}<span class="small">${state.spawnQueue.length} HOSTILES INBOUND</span>`;
  clearTimeout(startWave._t);
  startWave._t = setTimeout(() => banner.classList.add('hidden'), 2400);
  audio.waveStart();
  updateHUD();
}

function updateSpawning(dt) {
  if (state.intermission > 0) {
    state.intermission -= dt;
    if (state.intermission <= 0) {
      state.intermission = -1;
      startWave(state.wave + 1);
    }
    return;
  }
  if (state.spawnQueue.length) {
    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      state.spawnT = Math.max(0.25, 0.9 - state.wave * 0.06);
      // pick the gate farthest from the player
      let gate = world.gates[0], bestD = -1;
      for (const g of world.gates) {
        const d = g.distanceTo(player.pos) + Math.random() * 8;
        if (d > bestD) { bestD = d; gate = g; }
      }
      const type = state.spawnQueue.shift();
      enemies.spawn(type, gate.clone());
      updateHUD();
    }
  } else if (enemies.aliveCount === 0 && state.running) {
    // wave cleared
    const bonus = 150 * state.wave;
    state.score += bonus;
    state.intermission = 6;
    const banner = $('wave-banner');
    banner.classList.remove('hidden');
    banner.innerHTML = `WAVE ${state.wave} CLEARED<span class="small">+${bonus} BONUS — NEXT WAVE INCOMING</span>`;
    clearTimeout(startWave._t);
    startWave._t = setTimeout(() => banner.classList.add('hidden'), 3000);
    updateHUD();
  }
}

/* ---------------- explosions ---------------- */
function explodeBarrel(pos) {
  fx.explosion(pos);
  audio.explosion();
  state.shake = Math.min(1, state.shake + 0.55);

  const R = 6.5;
  // damage enemies
  for (const e of [...enemies.enemies]) {
    const d = e.pos.distanceTo(pos);
    if (d < R) {
      const dir = e.pos.clone().sub(pos).setY(0.4).normalize();
      enemies.damage(e, 150 * (1 - d / R) + 30, dir, e.pos.clone().setY(1), false, hooks);
    }
  }
  // damage player
  const pd = player.pos.distanceTo(pos);
  if (pd < R && player.alive) {
    player.hurt(Math.round(55 * (1 - pd / R) + 8), hooks);
  }
  // physics + chain reaction
  world.explode(pos, R);
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  $('score').textContent = state.score;
  $('wave').textContent = Math.max(state.wave, 1);
  const left = enemies.aliveCount + state.spawnQueue.length;
  $('enemies-left').textContent = state.running ? `${left} hostiles` : '';
  const comboEl = $('combo');
  if (state.combo > 1 && performance.now() / 1000 - state.lastKillT < 3) {
    comboEl.classList.remove('hidden');
    comboEl.textContent = '×' + state.combo;
  } else {
    comboEl.classList.add('hidden');
  }
  const hf = $('health-fill');
  const pct = Math.max(player.health, 0) / player.maxHealth * 100;
  hf.style.width = pct + '%';
  hf.classList.toggle('hurt', pct < 40);
  $('damage-flash').classList.toggle('low', pct < 30 && player.alive);
}

/* ---------------- screens / flow ---------------- */
function startGame() {
  audio.init();
  audio.resume();
  $('start-screen').classList.add('hidden');
  $('gameover-screen').classList.add('hidden');
  hud.classList.remove('hidden');
  state.running = true;
  if (!AUTOTEST) canvas.requestPointerLock();
  startWave(1);
}

function endGame() {
  state.running = false;
  document.exitPointerLock?.();
  enemies.killAll(hooks);
  const isBest = state.score > state.best;
  if (isBest) {
    state.best = state.score;
    localStorage.setItem('neonstrike_best', String(state.best));
  }
  $('final-stats').innerHTML =
    `SCORE <b>${state.score}</b> &nbsp;·&nbsp; WAVE <b>${state.wave}</b> &nbsp;·&nbsp; KILLS <b>${state.kills}</b>` +
    (isBest ? `<br><span class="newbest">★ NEW BEST</span>` : `<br><span style="color:#6b7c8f">BEST ${state.best}</span>`);
  $('gameover-screen').classList.remove('hidden');
}

$('play-btn').addEventListener('click', startGame);
$('restart-btn').addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  if (AUTOTEST) return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && state.running && player.alive) {
    $('pause-screen').classList.remove('hidden');
    paused = true;
  } else {
    $('pause-screen').classList.add('hidden');
    paused = false;
  }
});
$('pause-screen').addEventListener('click', () => canvas.requestPointerLock());

if (state.best > 0) {
  $('best-line').textContent = `PERSONAL BEST: ${state.best}`;
}

/* ---------------- main loop ---------------- */
let paused = false;
let last = performance.now();
let hudT = 0;

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state.running && !paused) {
    player.update(dt, enemies);
    enemies.update(dt, player.pos, player.alive, hooks);
    updateSpawning(dt);
    world.update(dt, (pos) => explodeBarrel(pos));

    // combo timeout
    if (state.combo > 0 && now / 1000 - state.lastKillT > 3) state.combo = 0;

    // camera shake (explosions / damage)
    if (state.shake > 0.001) {
      state.shake *= Math.pow(0.001, dt); // fast decay
      camera.position.x += (Math.random() - 0.5) * state.shake * 0.25;
      camera.position.y += (Math.random() - 0.5) * state.shake * 0.25;
      camera.rotation.z += (Math.random() - 0.5) * state.shake * 0.02;
    }

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.12; updateHUD(); }
  }

  fx.update(dt);
  composer.render();
}

/* ---------------- autotest mode (headless CI smoke test) ---------------- */
if (AUTOTEST) {
  window.__stats = { frames: 0, kills: 0, spawned: 0 };
  const origSpawn = enemies.spawn.bind(enemies);
  enemies.spawn = (t, p) => { window.__stats.spawned++; return origSpawn(t, p); };
  const origKill = hooks.onKill;
  hooks.onKill = (e, h) => { window.__stats.kills++; origKill(e, h); };

  setTimeout(() => {
    startGame();
    // auto-aim: point at the nearest enemy and fire in bursts
    setInterval(() => {
      if (!state.running) return;
      let nearest = null, nd = 1e9;
      for (const e of enemies.enemies) {
        const d = e.pos.distanceTo(player.pos);
        if (d < nd) { nd = d; nearest = e; }
      }
      if (nearest) {
        const eye = new THREE.Vector3(player.pos.x, player.eyeY, player.pos.z);
        const target = nearest.pos.clone().setY(1.2);
        const dir = target.sub(eye);
        player.yaw = Math.atan2(-dir.x, -dir.z);
        player.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
        player.firing = true;
        setTimeout(() => { player.firing = false; }, 350);
      }
      // wander so we cover ground
      const k = ['KeyW', 'KeyA', 'KeyD', 'KeyS'];
      player.keys.clear();
      player.keys.add(k[Math.floor(Math.random() * k.length)]);
      if (Math.random() < 0.2) player.keys.add('Space');
    }, 900);
  }, 600);

  let frames = 0;
  const countFrames = () => { frames++; window.__stats.frames = frames; requestAnimationFrame(countFrames); };
  requestAnimationFrame(countFrames);
  window.__game = { state, player, enemies, world };
}

loop();
