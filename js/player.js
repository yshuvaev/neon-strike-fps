// First-person kinematic character controller + hitscan weapon + viewmodel.
import * as THREE from 'three';
import { makeGun, makeGlowSprite } from './textures.js';
import { ARENA } from './world.js';

const EYE = 1.62;
const RADIUS = 0.42;
const HEIGHT = 1.8;
const WALK = 6.2;
const SPRINT = 9.4;
const ACCEL = 42;
const AIR_ACCEL = 10;
const GRAV = 24;
const JUMP = 8.2;

const MAG = 30;
const RELOAD_T = 1.15;
const FIRE_DT = 0.098;
const DMG = 34;

export class Player {
  constructor(camera, world, audio, fx) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.fx = fx;

    this.pos = new THREE.Vector3(0, 0, 12);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;   // face the arena center
    this.pitch = 0;
    this.onGround = false;
    this.health = 100;
    this.maxHealth = 100;
    this.lastHurt = -10;
    this.alive = true;

    this.ammo = MAG;
    this.reloadT = -1;
    this.fireT = 0;
    this.recoil = 0;
    this.bobT = 0;

    this.keys = new Set();
    this._colliders = [];

    this._buildViewmodel();
  }

  _buildViewmodel() {
    const g = makeGun();
    const mat = new THREE.MeshStandardMaterial({
      map: g.map, normalMap: g.normalMap, roughness: 0.55, metalness: 0.7,
      fog: false,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.8, fog: false });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0a0f14, emissive: 0x78ffd6, emissiveIntensity: 1.1, fog: false,
    });

    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.52), mat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.4);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), dark);
    muzzle.position.set(0, 0.03, -0.56);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.11), dark);
    grip.position.set(0, -0.16, 0.14);
    grip.rotation.x = 0.3;
    const mag2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.09), dark);
    mag2.position.set(0, -0.15, -0.08);
    mag2.rotation.x = -0.15;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), glow);
    sight.position.set(0, 0.115, -0.1);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.03, 0.2), glow);
    cell.position.set(0, -0.02, 0.05);
    gun.add(body, barrel, muzzle, grip, mag2, sight, cell);
    gun.position.set(0.26, -0.24, -0.5);
    this.camera.add(gun);
    this.gun = gun;

    // muzzle flash sprite + light
    const flashTex = makeGlowSprite();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xffd9a0, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.flash.scale.set(0.22, 0.22, 0.22);
    this.flash.position.set(0, 0.03, -0.62);
    gun.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 9, 2);
    gun.add(this.flashLight);
    this.flashLight.position.set(0, 0.05, -0.7);

    // tracer pool origin
    this.muzzleWorld = new THREE.Vector3();
  }

  bind(dom, hooks) {
    this.hooks = hooks;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.tryReload();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement === dom && e.button === 0) this.firing = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
  }

  tryReload() {
    if (!this.alive || this.reloadT >= 0 || this.ammo === MAG) return;
    this.reloadT = 0;
    this.audio.reload();
  }

  get eyeY() { return this.pos.y + EYE; }

  hurt(dmg, hooks) {
    if (!this.alive) return;
    this.health -= dmg;
    this.lastHurt = performance.now() / 1000;
    this.audio.hurt();
    hooks.onPlayerHurt();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      hooks.onPlayerDeath();
    }
  }

  update(dt, enemies) {
    if (!this.alive) return;

    const now = performance.now() / 1000;
    const regenDelay = 4.5;
    if (now - this.lastHurt > regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 9 * dt);
    }

    /* ---- movement ---- */
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? SPRINT : WALK;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (this.keys.has('KeyW')) wish.add(fwd);
    if (this.keys.has('KeyS')) wish.sub(fwd);
    if (this.keys.has('KeyD')) wish.add(right);
    if (this.keys.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = this.onGround ? ACCEL : AIR_ACCEL;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt / speed * 4);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt / speed * 4);

    if (this.onGround && this.keys.has('Space')) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    this.vel.y -= GRAV * dt;

    // integrate + resolve per axis against AABBs
    this._colliders = this.world.collidersFor(this.pos, this._colliders);
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
    this._moveAxis('y', this.vel.y * dt, true);

    // arena walls
    const lim = ARENA - 0.7 - RADIUS;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // push dynamic props when walking into them
    const pushDir = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const pushLen = pushDir.length();
    if (pushLen > 1) {
      pushDir.normalize();
      for (const c of this._colliders) {
        if (!c.body) continue;
        const dx = this.pos.x - c.body.position.x;
        const dz = this.pos.z - c.body.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.4 && d > 0.001) {
          c.body.wakeUp();
          c.body.applyImpulse(new (c.body.position.constructor)(
            pushDir.x * pushLen * 0.9 * (1.4 - d),
            0,
            pushDir.z * pushLen * 0.9 * (1.4 - d)
          ));
        }
      }
    }

    /* ---- camera ---- */
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && planarSpeed > 0.5) this.bobT += dt * (sprint ? 11.5 : 8.5);
    const bob = this.onGround ? Math.sin(this.bobT) * 0.035 * Math.min(1, planarSpeed / WALK) : 0;

    this.camera.position.set(this.pos.x, this.eyeY + bob, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    /* ---- weapon ---- */
    this.fireT -= dt;
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      if (this.reloadT >= RELOAD_T) {
        this.reloadT = -1;
        this.ammo = MAG;
        this.hooks.onAmmoChange();
      }
    }
    if (this.firing && this.reloadT < 0 && this.fireT <= 0) {
      if (this.ammo > 0) this._shoot(enemies);
      else { this.audio.dryFire(); this.tryReload(); }
    }

    // recoil recovery + gun pose
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const reloadDip = this.reloadT >= 0 ? Math.sin(Math.min(1, this.reloadT / RELOAD_T) * Math.PI) * 0.18 : 0;
    this.gun.position.set(
      0.26 + Math.cos(this.bobT * 0.5) * 0.006,
      -0.24 + Math.abs(bob) * 0.6 - reloadDip,
      -0.5 + this.recoil * 0.09
    );
    this.gun.rotation.set(this.recoil * 0.35 + reloadDip * 1.6, 0, 0);
    this.pitch += this.recoil * dt * 1.1;

    // muzzle flash decay
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 18);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 900);
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    this.pos[axis] += delta;
    const min = new THREE.Vector3(this.pos.x - RADIUS, this.pos.y, this.pos.z - RADIUS);
    const max = new THREE.Vector3(this.pos.x + RADIUS, this.pos.y + HEIGHT, this.pos.z + RADIUS);

    for (const b of this._colliders) {
      if (max.x <= b.min.x || min.x >= b.max.x ||
          max.y <= b.min.y || min.y >= b.max.y ||
          max.z <= b.min.z || min.z >= b.max.z) continue;

      if (axis === 'y') {
        if (delta < 0) {
          this.pos.y = b.max.y;
          this.vel.y = 0;
          this.onGround = true;
        } else {
          this.pos.y = b.min.y - HEIGHT;
          this.vel.y = 0;
        }
      } else {
        const bmin = b.min[axis], bmax = b.max[axis];
        if (delta > 0) this.pos[axis] = bmin - RADIUS;
        else this.pos[axis] = bmax + RADIUS;
        this.vel[axis] = 0;
      }
      min.set(this.pos.x - RADIUS, this.pos.y, this.pos.z - RADIUS);
      max.set(this.pos.x + RADIUS, this.pos.y + HEIGHT, this.pos.z + RADIUS);
    }
    if (axis === 'y' && delta < 0) this.onGround = true;
  }

  _shoot(enemies) {
    this.fireT = FIRE_DT;
    this.ammo--;
    this.recoil = Math.min(1.6, this.recoil + 0.55);
    this.audio.shoot();
    this.hooks.onAmmoChange();
    this.hooks.onFire();

    // muzzle flash
    this.flash.material.opacity = 1;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flashLight.intensity = 60 + Math.random() * 30;

    // hitscan
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const spread = 0.006 + this.recoil * 0.004;
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    const origin = new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
    const hit = enemies.raycast(origin, dir, 120);

    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 120);
    this.muzzleWorld.set(0.26, -0.2, -1.1).applyMatrix4(this.camera.matrixWorld);
    this.fx.tracer(this.muzzleWorld, end);

    if (hit) {
      if (hit.kind === 'enemy') {
        enemies.damage(hit.enemy, DMG * (hit.headshot ? 2.2 : 1), dir, hit.point, hit.headshot, this.hooks);
      } else if (hit.kind === 'barrel') {
        this.fx.sparks(hit.point, 8, 0xffc060);
        if (this.world.hitBarrel(hit.barrel, DMG)) this.hooks.onBarrelIgnite();
      } else {
        this.fx.sparks(hit.point, 6, 0x9fd8ff);
      }
    }
  }
}
