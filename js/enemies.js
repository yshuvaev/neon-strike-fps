// Enemy drones: procedural models, chase AI, melee/ranged attacks,
// physics-driven corpses, plasma projectiles.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { makeEnemy, makeGlowSprite } from './textures.js';
import { ARENA } from './world.js';

const TYPES = {
  runner:  { hp: 60,  speed: 4.8, scale: 1.0,  dmg: 12, score: 100, attackRange: 1.7, emissive: 0xff5a1e },
  brute:   { hp: 260, speed: 2.4, scale: 1.5,  dmg: 26, score: 250, attackRange: 2.4, emissive: 0xff1e3c },
  spitter: { hp: 90,  speed: 3.4, scale: 1.05, dmg: 0,  score: 150, attackRange: 26,  emissive: 0x1eb8ff, ranged: true },
};

const _ray = new THREE.Raycaster();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function rayVsAABB(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / d[ax];
    let t0 = (min[ax] - o[ax]) * inv;
    let t1 = (max[ax] - o[ax]) * inv;
    if (inv < 0) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return Infinity;
  }
  return tmin;
}

export class EnemyManager {
  constructor(scene, world, fx, audio) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.enemies = [];
    this.corpses = [];
    this.orbs = [];
    this._colliders = [];

    this._orbGeo = new THREE.SphereGeometry(0.16, 12, 8);
    this._orbMat = new THREE.MeshBasicMaterial({ color: 0x66e0ff });
    this._orbGlow = makeGlowSprite('rgba(140,230,255,1)', 'rgba(30,140,255,0)');

    this.materials = {};
    for (const v of Object.keys(TYPES)) {
      const t = makeEnemy(v);
      this.materials[v] = {
        body: new THREE.MeshStandardMaterial({
          map: t.map, normalMap: t.normalMap,
          emissiveMap: t.emissiveMap, emissive: new THREE.Color(TYPES[v].emissive),
          emissiveIntensity: 1.5, roughness: 0.5, metalness: 0.65,
        }),
        dark: new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.45, metalness: 0.8 }),
      };
    }
  }

  /* ---------------- spawning ---------------- */
  spawn(type, pos) {
    const cfg = TYPES[type];
    // per-enemy clone of the emissive material so hit-flashes don't leak between drones
    const mats = { body: this.materials[type].body.clone(), dark: this.materials[type].dark };
    const s = cfg.scale;
    const g = new THREE.Group();

    const box = (w, h, d, mat, x, y, z, name) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), mat);
      m.position.set(x * s, y * s, z * s);
      m.castShadow = true;
      if (name) m.userData.part = name;
      g.add(m);
      return m;
    };

    const torso = box(0.62, 0.72, 0.4, mats.body, 0, 1.12, 0, 'torso');
    const head = box(0.3, 0.28, 0.32, mats.body, 0, 1.68, 0, 'head');
    box(0.34, 0.06, 0.06, mats.body, 0, 1.7, 0.16, 'head'); // visor strip
    const armL = box(0.16, 0.62, 0.18, mats.dark, -0.44, 1.14, 0, 'arm');
    const armR = box(0.16, 0.62, 0.18, mats.dark, 0.44, 1.14, 0, 'arm');
    armL.geometry.translate(0, -0.2, 0); armL.position.y = 1.34 * s;
    armR.geometry.translate(0, -0.2, 0); armR.position.y = 1.34 * s;
    const legL = box(0.2, 0.78, 0.22, mats.dark, -0.17, 0.39, 0, 'leg');
    const legR = box(0.2, 0.78, 0.22, mats.dark, 0.17, 0.39, 0, 'leg');
    legL.geometry.translate(0, -0.39, 0); legL.position.y = 0.78 * s;
    legR.geometry.translate(0, -0.39, 0); legR.position.y = 0.78 * s;
    // backpack core (bright when about to fire)
    const core = box(0.3, 0.3, 0.12, mats.body, 0, 1.2, -0.26, 'core');

    // health bar
    const hbBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8 * s, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.8, depthWrite: false })
    );
    hbBg.position.set(0, 2.05 * s, 0);
    const hbFg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8 * s, 0.07),
      new THREE.MeshBasicMaterial({ color: cfg.emissive, transparent: true, opacity: 0.95, depthWrite: false })
    );
    hbFg.position.set(0, 2.05 * s, 0.002);
    g.add(hbBg, hbFg);

    g.position.copy(pos);
    this.scene.add(g);

    const enemy = {
      type, cfg, group: g, torso, head, armL, armR, legL, legR, core, hbBg, hbFg,
      hp: cfg.hp, maxHp: cfg.hp,
      pos: g.position, yaw: 0,
      attackT: 0, windup: -1, shotT: 1.5 + Math.random() * 1.5,
      walkT: Math.random() * 10, flashT: 0,
      alive: true, dying: false, deadT: 0,
      hitMeshes: [torso, head, armL, armR, legL, legR],
    };
    for (const m of enemy.hitMeshes) m.userData.enemy = enemy;
    head.userData.head = true;

    this.fx.spawnBurst(pos.clone().setY(1), cfg.emissive);
    this.enemies.push(enemy);
    return enemy;
  }

  get aliveCount() { return this.enemies.length; }

  /* ---------------- damage / death ---------------- */
  damage(enemy, dmg, dir, point, headshot, hooks) {
    if (!enemy.alive) return;
    enemy.hp -= dmg;
    enemy.flashT = 0.09;
    this.fx.sparks(point, headshot ? 14 : 8, headshot ? 0xffd23e : enemy.cfg.emissive);
    if (enemy.hp <= 0) this._die(enemy, dir, headshot, hooks);
    else this.audio.hit(headshot);
  }

  _die(enemy, dir, headshot, hooks) {
    enemy.alive = false;
    enemy.dying = true;
    enemy.deadT = 0;
    enemy.hbBg.visible = enemy.hbFg.visible = false;
    this.audio.kill();

    // physics corpse: single dynamic box, impulse at chest height
    const s = enemy.cfg.scale;
    const body = new CANNON.Body({
      mass: 65 * s,
      shape: new CANNON.Box(new CANNON.Vec3(0.32 * s, 0.85 * s, 0.26 * s)),
      position: new CANNON.Vec3(enemy.pos.x, 0.85 * s, enemy.pos.z),
      angularDamping: 0.25, linearDamping: 0.15,
    });
    const k = 6.5;
    body.velocity.set(dir.x * k * (headshot ? 1.4 : 1), 3.4, dir.z * k * (headshot ? 1.4 : 1));
    body.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    this.world.pworld.addBody(body);
    enemy.corpseBody = body;
    enemy.corpseOffset = new CANNON.Vec3(0, 0.85 * s, 0);
    this.corpses.push(enemy);
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);

    this.fx.sparks(enemy.pos.clone().setY(1.2 * s), enemy.cfg.emissive, 26);
    this.fx.smoke(enemy.pos.clone().setY(1 * s), 6);
    hooks.onKill(enemy, headshot);
  }

  killAll(hooks) {
    for (const e of [...this.enemies]) this._die(e, new THREE.Vector3(0, 0.4, 0), false, hooks);
  }

  /* ---------------- hitscan against enemies + barrels + world ---------------- */
  raycast(origin, dir, far) {
    let best = null;

    // enemies
    const meshes = [];
    for (const e of this.enemies) meshes.push(...e.hitMeshes);
    _ray.set(origin, dir);
    _ray.far = far;
    const hits = _ray.intersectObjects(meshes, false);
    if (hits.length) {
      const h = hits[0];
      best = { kind: 'enemy', point: h.point, dist: h.distance, enemy: h.object.userData.enemy, headshot: !!h.object.userData.head };
    }

    // barrels
    const bMeshes = [];
    for (const b of this.world.barrels) if (b.alive) bMeshes.push(b.mesh);
    const bhits = bMeshes.length ? _ray.intersectObjects(bMeshes, false) : [];
    if (bhits.length && (!best || bhits[0].distance < best.dist)) {
      best = { kind: 'barrel', point: bhits[0].point, dist: bhits[0].distance, barrel: this.world.barrels.find(b => b.mesh === bhits[0].object) };
    }

    // world: static AABBs + arena walls + floor
    let wallT = Infinity;
    for (const b of this.world.staticAABBs) {
      const t = rayVsAABB(origin, dir, b.min, b.max);
      if (t < wallT) wallT = t;
    }
    if (dir.y < -1e-6) wallT = Math.min(wallT, -origin.y / dir.y);
    // simple slab test against arena walls
    const lim = ARENA + 0.5;
    if (Math.abs(dir.x) > 1e-6) {
      const t = ((dir.x > 0 ? lim : -lim) - origin.x) / dir.x;
      if (t > 0 && t < wallT) wallT = t;
    }
    if (Math.abs(dir.z) > 1e-6) {
      const t = ((dir.z > 0 ? lim : -lim) - origin.z) / dir.z;
      if (t > 0 && t < wallT) wallT = t;
    }
    if (wallT < far && (!best || wallT < best.dist)) {
      best = { kind: 'world', dist: wallT, point: origin.clone().addScaledVector(dir, wallT) };
    }
    return best;
  }

  /* ---------------- projectiles (spitters) ---------------- */
  fireOrb(from, targetPos) {
    const mesh = new THREE.Mesh(this._orbGeo, this._orbMat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._orbGlow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    glow.scale.set(0.9, 0.9, 0.9);
    mesh.add(glow);
    const light = new THREE.PointLight(0x33ccff, 8, 7, 2);
    mesh.add(light);
    mesh.position.copy(from);
    this.scene.add(mesh);

    const dir = _v1.copy(targetPos).sub(from).normalize();
    this.orbs.push({
      mesh, light,
      vel: new THREE.Vector3(dir.x * 14, dir.y * 14 + 0.6, dir.z * 14),
      life: 5,
    });
    this.audio.enemyShot();
  }

  /* ---------------- update ---------------- */
  update(dt, playerPos, playerAlive, hooks) {
    const now = performance.now() / 1000;

    /* alive enemies */
    for (const e of this.enemies) {
      const s = e.cfg.scale;
      e.flashT -= dt;
      const flash = e.flashT > 0;
      e.torso.material.emissiveIntensity = flash ? 4 : 1.5;

      const toPlayer = _v1.set(playerPos.x - e.pos.x, 0, playerPos.z - e.pos.z);
      const dist = toPlayer.length();
      toPlayer.normalize();

      // face the player (with a little lag)
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      let dy = targetYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += dy * Math.min(1, dt * 8);

      let moveSpeed = 0;
      const cfg = e.cfg;

      if (playerAlive) {
        if (cfg.ranged) {
          // hold a firing band
          if (dist > 15) moveSpeed = cfg.speed;
          else if (dist < 8) { toPlayer.multiplyScalar(-1); moveSpeed = cfg.speed * 0.8; }
          else {
            // strafe
            _v2.set(-toPlayer.z, 0, toPlayer.x);
            toPlayer.copy(_v2);
            moveSpeed = cfg.speed * 0.45;
          }
          e.shotT -= dt;
          e.core.material.emissiveIntensity = e.shotT < 0.5 ? 4 : 1.5;
          if (e.shotT <= 0 && dist < 24) {
            e.shotT = 2.3 + Math.random() * 0.8;
            const from = e.pos.clone().setY(1.3 * s);
            const aim = playerPos.clone().setY(playerPos.y + 1.3);
            aim.x += (Math.random() - 0.5) * 1.2;
            aim.y += (Math.random() - 0.5) * 0.6;
            this.fireOrb(from, aim);
          }
        } else {
          if (dist > cfg.attackRange * 0.9) moveSpeed = cfg.speed;
        }

        // melee attack state machine
        e.attackT -= dt;
        if (!cfg.ranged && e.windup < 0 && dist < cfg.attackRange && e.attackT <= 0) {
          e.windup = 0;
        }
        if (e.windup >= 0) {
          e.windup += dt;
          moveSpeed = 0;
          const lunge = Math.sin(Math.min(e.windup / 0.32, 1) * Math.PI);
          e.armL.rotation.x = -2.2 * lunge;
          e.armR.rotation.x = -2.2 * lunge;
          if (e.windup > 0.32) {
            if (dist < cfg.attackRange + 0.5 && playerAlive) {
              hooks.onPlayerHit(e.cfg.dmg);
            }
            this.fx.slash(e.pos.clone().setY(1.2 * s));
            e.windup = -1;
            e.attackT = 1.15;
          }
        }
      }

      /* separation from other enemies */
      for (const o of this.enemies) {
        if (o === e) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        const minD = 1.1 * s;
        if (d2 < minD * minD && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          toPlayer.x += (dx / d) * (minD - d) * 0.8;
          toPlayer.z += (dz / d) * (minD - d) * 0.8;
        }
      }
      if (toPlayer.lengthSq() > 0) toPlayer.normalize();

      // integrate + collide vs static boxes
      e.pos.x += toPlayer.x * moveSpeed * dt;
      e.pos.z += toPlayer.z * moveSpeed * dt;
      const ex = 0.45 * s;
      this._colliders = this.world.collidersFor(e.pos, this._colliders);
      for (const b of this._colliders) {
        if (b.body || b.barrel) continue; // only static geometry blocks pathing
        if (e.pos.x + ex <= b.min.x || e.pos.x - ex >= b.max.x ||
            e.pos.z + ex <= b.min.z || e.pos.z - ex >= b.max.z) continue;
        if (b.max.y < 0.4 || b.min.y > 1.8 * s) continue;
        // push out along smallest penetration
        const pxl = e.pos.x + ex - b.min.x, pxr = b.max.x - (e.pos.x - ex);
        const pzl = e.pos.z + ex - b.min.z, pzr = b.max.z - (e.pos.z - ex);
        const m = Math.min(pxl, pxr, pzl, pzr);
        if (m === pxl) e.pos.x = b.min.x - ex;
        else if (m === pxr) e.pos.x = b.max.x + ex;
        else if (m === pzl) e.pos.z = b.min.z - ex;
        else e.pos.z = b.max.z + ex;
      }
      const elim = ARENA - 1 - ex;
      e.pos.x = Math.max(-elim, Math.min(elim, e.pos.x));
      e.pos.z = Math.max(-elim, Math.min(elim, e.pos.z));

      // animation
      e.walkT += dt * (2 + moveSpeed * 1.6);
      const sw = moveSpeed > 0.1 ? Math.sin(e.walkT * 3) * 0.55 : 0;
      e.legL.rotation.x = sw;
      e.legR.rotation.x = -sw;
      if (e.windup < 0) {
        e.armL.rotation.x = -sw * 0.7;
        e.armR.rotation.x = sw * 0.7;
      }
      e.group.rotation.y = e.yaw;
      // slight hover-bob
      e.group.position.y = Math.abs(Math.sin(e.walkT * 1.5)) * 0.05 * (moveSpeed > 0.1 ? 1 : 0.3);

      // health bar faces camera & updates
      const frac = Math.max(e.hp / e.maxHp, 0);
      e.hbFg.scale.x = frac;
      e.hbFg.position.x = -(1 - frac) * 0.4 * s;
      e.hbBg.lookAt(hooks.cameraPos());
      e.hbFg.lookAt(hooks.cameraPos());
    }

    /* corpses */
    for (const e of [...this.corpses]) {
      e.deadT += dt;
      const b = e.corpseBody;
      _v1.set(e.corpseOffset.x, e.corpseOffset.y, e.corpseOffset.z);
      _v1.applyQuaternion(_q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
      e.group.position.set(b.position.x - _v1.x, b.position.y - _v1.y, b.position.z - _v1.z);
      e.group.quaternion.copy(_q);
      const fade = e.deadT > 2.6 ? Math.max(0, 1 - (e.deadT - 2.6) / 0.9) : 1;
      e.group.scale.setScalar(e.cfg.scale * (0.35 + 0.65 * fade));
      if (e.deadT > 3.5) {
        this.world.pworld.removeBody(b);
        this.scene.remove(e.group);
        this.corpses.splice(this.corpses.indexOf(e), 1);
      }
    }

    /* plasma orbs */
    for (const o of [...this.orbs]) {
      o.life -= dt;
      o.vel.y -= 2.2 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      const p = o.mesh.position;
      let boom = o.life <= 0 || p.y < 0.05 || Math.abs(p.x) > ARENA || Math.abs(p.z) > ARENA;
      if (playerAlive) {
        const d = _v1.set(playerPos.x, playerPos.y + 1.2, playerPos.z).distanceTo(p);
        if (d < 0.85) {
          hooks.onPlayerHit(12);
          boom = true;
        }
      }
      if (boom) {
        this.fx.sparks(p, 12, 0x55d8ff);
        this.scene.remove(o.mesh);
        this.orbs.splice(this.orbs.indexOf(o), 1);
      }
    }
  }
}
