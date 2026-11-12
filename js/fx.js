// Pooled visual effects: sparks, smoke, tracers, spawn portals, explosions.
import * as THREE from 'three';
import { makeGlowSprite, makeSmokeSprite } from './textures.js';

const MAX_SPARKS = 500;
const MAX_SMOKE = 220;
const MAX_TRACERS = 40;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this._tmp = new THREE.Vector3();
    this._buildSparks();
    this._buildSmoke();
    this._buildTracers();
    this._buildLights();
  }

  /* ---------------- GPU point sprites with per-particle CPU sim ---------------- */
  _buildSparks() {
    const geo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, map: makeGlowSprite(),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      sizeAttenuation: true,
    });
    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);
    this.sparkPool = []; // {i, vel, life, maxLife, r,g,b, grav}
    this.sparkFree = [];
    for (let i = MAX_SPARKS - 1; i >= 0; i--) {
      this.sparkFree.push(i);
      this.sparkPos[i * 3 + 1] = -999;
    }
  }

  sparksBurst(pos, count, colorHex, speed = 6, spread = 1) {
    const c = new THREE.Color(colorHex);
    for (let n = 0; n < count; n++) {
      if (!this.sparkFree.length) break;
      const i = this.sparkFree.pop();
      const life = 0.3 + Math.random() * 0.45;
      this.sparkPool.push({
        i,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * speed * spread,
          Math.random() * speed * 0.9,
          (Math.random() - 0.5) * speed * spread
        ),
        life, maxLife: life,
        r: c.r, g: c.g, b: c.b,
        grav: 14,
      });
      this.sparkPos[i * 3] = pos.x;
      this.sparkPos[i * 3 + 1] = pos.y;
      this.sparkPos[i * 3 + 2] = pos.z;
    }
  }

  sparks(pos, count, color) { this.sparksBurst(pos, count, color, 7, 1); }

  _buildSmoke() {
    const geo = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(MAX_SMOKE * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.1, map: makeSmokeSprite(), transparent: true, opacity: 0.28,
      depthWrite: false, color: 0x8a8f98, sizeAttenuation: true,
    });
    this.smokePoints = new THREE.Points(geo, mat);
    this.smokePoints.frustumCulled = false;
    this.scene.add(this.smokePoints);
    this.smokePool = [];
    this.smokeFree = [];
    for (let i = MAX_SMOKE - 1; i >= 0; i--) {
      this.smokeFree.push(i);
      this.smokePos[i * 3 + 1] = -999;
    }
  }

  smokePuff(pos, count = 4, rise = 1.2) {
    for (let n = 0; n < count; n++) {
      if (!this.smokeFree.length) break;
      const i = this.smokeFree.pop();
      const life = 1.2 + Math.random() * 1.4;
      this.smokePool.push({
        i,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, rise * (0.6 + Math.random() * 0.8), (Math.random() - 0.5) * 1.2),
        life, maxLife: life,
      });
      this.smokePos[i * 3] = pos.x + (Math.random() - 0.5) * 0.5;
      this.smokePos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.5;
      this.smokePos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.5;
    }
  }

  smoke(pos, count = 4) { this.smokePuff(pos, count); }

  /* ---------------- tracers ---------------- */
  _buildTracers() {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2); // extend along -Z
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xaef2ff, blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this._tracerIdx = 0;
  }

  tracer(from, to) {
    const t = this.tracers[this._tracerIdx];
    this._tracerIdx = (this._tracerIdx + 1) % MAX_TRACERS;
    const m = t.mesh;
    m.position.copy(from);
    const len = from.distanceTo(to);
    m.scale.set(1, 1, len);
    m.lookAt(to);
    m.visible = true;
    m.material.opacity = 0.85;
    t.life = 0.09;
  }

  /* ---------------- reusable flash lights ---------------- */
  _buildLights() {
    this.boomLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa050, 0, 30, 2);
      this.scene.add(l);
      this.boomLights.push({ light: l, life: 0, maxLife: 1 });
    }
  }

  _flashLight(pos, color, intensity, duration, dist = 30) {
    let slot = this.boomLights.find(s => s.life <= 0);
    if (!slot) slot = this.boomLights[0];
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.light.distance = dist;
    slot.peak = intensity;
    slot.life = duration;
    slot.maxLife = duration;
  }

  /* ---------------- composite effects ---------------- */
  spawnBurst(pos, colorHex) {
    this.sparksBurst(pos, 22, colorHex, 5, 1.2);
    this._flashLight(pos, colorHex, 26, 0.35, 12);
  }

  slash(pos) {
    this.sparksBurst(pos, 10, 0xff5a4e, 5, 1.4);
  }

  explosion(pos) {
    // fireball flash
    this.sparksBurst(pos, 60, 0xffc060, 16, 1.3);
    this.sparksBurst(pos, 30, 0xff5a1e, 10, 1);
    this.sparksBurst(pos, 20, 0xfff0a0, 22, 0.6);
    this.smokePuff(pos, 14, 2.4);
    this._flashLight(pos, 0xffa050, 320, 0.5, 34);
    // shockwave ring
    if (!this._ringGeo) {
      this._ringGeo = new THREE.RingGeometry(0.1, 1, 40);
      this._ringGeo.rotateX(-Math.PI / 2);
    }
    const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffcf90, blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.position.copy(pos).y = Math.max(pos.y, 0.12);
    this.scene.add(ring);
    const t0 = performance.now();
    const expand = () => {
      const t = (performance.now() - t0) / 450;
      if (t >= 1) { this.scene.remove(ring); ring.material.dispose(); return; }
      ring.scale.setScalar(1 + t * 14);
      ring.material.opacity = 0.9 * (1 - t);
      requestAnimationFrame(expand);
    };
    expand();
  }

  /* ---------------- per-frame update ---------------- */
  update(dt) {
    // sparks
    for (let n = this.sparkPool.length - 1; n >= 0; n--) {
      const s = this.sparkPool[n];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkPos[s.i * 3 + 1] = -999;
        this.sparkFree.push(s.i);
        this.sparkPool.splice(n, 1);
        continue;
      }
      s.vel.y -= s.grav * dt;
      this.sparkPos[s.i * 3] += s.vel.x * dt;
      this.sparkPos[s.i * 3 + 1] += s.vel.y * dt;
      this.sparkPos[s.i * 3 + 2] += s.vel.z * dt;
      if (this.sparkPos[s.i * 3 + 1] < 0.02 && s.vel.y < 0) {
        this.sparkPos[s.i * 3 + 1] = 0.02;
        s.vel.y *= -0.4;
        s.vel.x *= 0.7; s.vel.z *= 0.7;
      }
      const f = s.life / s.maxLife;
      this.sparkCol[s.i * 3] = s.r * f * 2;
      this.sparkCol[s.i * 3 + 1] = s.g * f * 2;
      this.sparkCol[s.i * 3 + 2] = s.b * f * 2;
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this.sparkPoints.geometry.attributes.color.needsUpdate = true;

    // smoke
    for (let n = this.smokePool.length - 1; n >= 0; n--) {
      const s = this.smokePool[n];
      s.life -= dt;
      if (s.life <= 0) {
        this.smokePos[s.i * 3 + 1] = -999;
        this.smokeFree.push(s.i);
        this.smokePool.splice(n, 1);
        continue;
      }
      this.smokePos[s.i * 3] += s.vel.x * dt;
      this.smokePos[s.i * 3 + 1] += s.vel.y * dt;
      this.smokePos[s.i * 3 + 2] += s.vel.z * dt;
      s.vel.multiplyScalar(1 - dt * 0.8);
    }
    this.smokePoints.geometry.attributes.position.needsUpdate = true;

    // tracers
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }

    // flash lights
    for (const s of this.boomLights) {
      if (s.life > 0) {
        s.life -= dt;
        s.light.intensity = Math.max(0, s.life / s.maxLife) * s.peak;
      }
    }
  }
}
