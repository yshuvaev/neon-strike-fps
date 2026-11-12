// Arena construction + cannon-es physics world.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { makeFloor, makeWall, makeCrate, makeBarrel, makeSky } from './textures.js';

export const ARENA = 30;          // half-extent of the arena floor
export const WALL_H = 7;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.staticAABBs = [];   // {min:Vector3, max:Vector3} for player/enemy kinematic collision
    this.crates = [];
    this.barrels = [];
    this.time = 0;

    this._initPhysics();
    this._buildLights();
    this._buildSky();
    this._buildArena();
    this._buildProps();
  }

  /* ---------------- physics ---------------- */
  _initPhysics() {
    this.pworld = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.pworld.broadphase = new CANNON.SAPBroadphase(this.pworld);
    this.pworld.allowSleep = true;
    this.pworld.defaultContactMaterial.friction = 0.4;

    this.matGround = new CANNON.Material('ground');
    this.matBox = new CANNON.Material('box');
    this.pworld.addContactMaterial(new CANNON.ContactMaterial(this.matGround, this.matBox, {
      friction: 0.55, restitution: 0.25,
    }));
    this.pworld.addContactMaterial(new CANNON.ContactMaterial(this.matBox, this.matBox, {
      friction: 0.5, restitution: 0.2,
    }));

    // physics floor
    const floorBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: this.matGround,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.pworld.addBody(floorBody);
  }

  addStaticBox(cx, cy, cz, hx, hy, hz) {
    this.staticAABBs.push({
      min: new THREE.Vector3(cx - hx, cy - hy, cz - hz),
      max: new THREE.Vector3(cx + hx, cy + hy, cz + hz),
    });
  }

  /* ---------------- lights & sky ---------------- */
  _buildLights() {
    this.scene.fog = new THREE.FogExp2(0x0a0e18, 0.016);

    const hemi = new THREE.HemisphereLight(0x4a5f8a, 0x1a1410, 1.35);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0x9fb8ff, 2.3);
    moon.position.set(-24, 38, -14);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -38; moon.shadow.camera.right = 38;
    moon.shadow.camera.top = 38; moon.shadow.camera.bottom = -38;
    moon.shadow.camera.far = 110;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    this.scene.add(moon);
    this.moon = moon;

    // warm sodium fill from opposite side, no shadows
    const fill = new THREE.DirectionalLight(0xff9a5a, 0.35);
    fill.position.set(20, 18, 24);
    this.scene.add(fill);
  }

  _buildSky() {
    const skyTex = makeSky();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(240, 32, 20),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.rotation.y = Math.PI * 0.3;
    this.scene.add(sky);

    // faint ground haze plane beyond the walls
    const haze = new THREE.Mesh(
      new THREE.CircleGeometry(220, 40),
      new THREE.MeshBasicMaterial({ color: 0x0a1020, fog: false })
    );
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = -0.5;
    this.scene.add(haze);
  }

  /* ---------------- arena geometry ---------------- */
  _buildArena() {
    // floor
    const f = makeFloor();
    f.map.repeat.set(11, 11); f.normalMap.repeat.set(11, 11);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshStandardMaterial({
        map: f.map, normalMap: f.normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.82, metalness: 0.55,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // walls
    const w = makeWall();
    w.map.repeat.set(6, 1); w.normalMap.repeat.set(6, 1);
    const wallMat = new THREE.MeshStandardMaterial({
      map: w.map, normalMap: w.normalMap,
      roughness: 0.75, metalness: 0.5,
    });
    const wallGeo = new THREE.BoxGeometry(ARENA * 2 + 2, WALL_H, 1);
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      const d = ARENA + 0.5;
      wall.position.set(0, WALL_H / 2, 0);
      if (i === 0) wall.position.z = -d;
      if (i === 1) wall.position.z = d;
      if (i === 2) { wall.position.x = -d; wall.rotation.y = Math.PI / 2; }
      if (i === 3) { wall.position.x = d; wall.rotation.y = Math.PI / 2; }
      wall.castShadow = true; wall.receiveShadow = true;
      this.scene.add(wall);
    }
    // kinematic bounds are implied by ARENA; pillars/cover below get real AABBs

    // glowing trim strips along the walls (feeds the bloom pass)
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f14, emissive: 0x2ddfa5, emissiveIntensity: 1.3,
      roughness: 0.4, metalness: 0.2,
    });
    const trimMat2 = trimMat.clone(); trimMat2.emissive = new THREE.Color(0x1e6aff); trimMat2.emissiveIntensity = 1.0;
    const trimGeo = new THREE.BoxGeometry(ARENA * 2 - 2, 0.14, 0.14);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(trimGeo, i % 2 ? trimMat2 : trimMat);
      const d = ARENA - 0.15;
      if (i === 0) { t.position.set(0, 3.4, -d); }
      if (i === 1) { t.position.set(0, 3.4, d); }
      if (i === 2) { t.position.set(-d, 3.4, 0); t.rotation.y = Math.PI / 2; }
      if (i === 3) { t.position.set(d, 3.4, 0); t.rotation.y = Math.PI / 2; }
      this.scene.add(t);
    }

    // perimeter light posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: 0xffc890, emissiveIntensity: 3.2, roughness: 0.3,
    });
    for (const [px, pz] of [[-22, -22], [22, -22], [-22, 22], [22, 22]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 5.4, 8), postMat);
      post.position.set(px, 2.7, pz);
      post.castShadow = true;
      this.scene.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), lampMat);
      lamp.position.set(px, 5.5, pz);
      this.scene.add(lamp);
      const pl = new THREE.PointLight(0xffb070, 18, 26, 2);
      pl.position.set(px, 5.2, pz);
      this.scene.add(pl);
    }

    // central pillars
    const pillarMat = new THREE.MeshStandardMaterial({
      map: w.map, roughness: 0.7, metalness: 0.55,
    });
    const pillarGlow = new THREE.MeshStandardMaterial({
      color: 0x0a0f14, emissive: 0xff5a4e, emissiveIntensity: 2.0, roughness: 0.4,
    });
    const pillarPos = [[-11, -11], [11, -11], [-11, 11], [11, 11], [0, -18], [0, 18]];
    for (const [px, pz] of pillarPos) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, WALL_H, 2.4), pillarMat);
      p.position.set(px, WALL_H / 2, pz);
      p.castShadow = true; p.receiveShadow = true;
      this.scene.add(p);
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 2.5), pillarGlow);
      band.position.set(px, 2.6, pz);
      this.scene.add(band);
      this.addStaticBox(px, WALL_H / 2, pz, 1.2, WALL_H / 2, 1.2);
    }

    // elevated platforms with step stairs (verticality)
    const platMat = new THREE.MeshStandardMaterial({
      map: w.map, roughness: 0.8, metalness: 0.5,
    });
    const platforms = [
      { x: -20, z: 0, w: 7, d: 7, h: 1.4 },
      { x: 20, z: 0, w: 7, d: 7, h: 1.4 },
      { x: 0, z: 0, w: 5, d: 5, h: 0.7 },
    ];
    for (const pl of platforms) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pl.w, pl.h, pl.d), platMat);
      m.position.set(pl.x, pl.h / 2, pl.z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.addStaticBox(pl.x, pl.h / 2, pl.z, pl.w / 2, pl.h / 2, pl.d / 2);
      // stairs on the arena-center side
      const dirX = pl.x === 0 ? 1 : -Math.sign(pl.x);
      const steps = 4;
      for (let s = 1; s <= steps; s++) {
        const sh = pl.h * (1 - s / (steps + 0.5));
        const sx = pl.x + dirX * (pl.w / 2 + 0.6 * s);
        const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, sh, 3), platMat);
        st.position.set(sx, sh / 2, pl.z);
        st.castShadow = true; st.receiveShadow = true;
        this.scene.add(st);
        this.addStaticBox(sx, sh / 2, pl.z, 0.6, sh / 2, 1.5);
      }
      // edge trim glow
      const et = new THREE.Mesh(new THREE.BoxGeometry(pl.w + 0.1, 0.08, pl.d + 0.1), trimMat);
      et.position.set(pl.x, pl.h + 0.02, pl.z);
      this.scene.add(et);
    }

    // spawn gates (enemy entry points)
    this.gates = [
      new THREE.Vector3(0, 0, -ARENA + 2.5),
      new THREE.Vector3(0, 0, ARENA - 2.5),
      new THREE.Vector3(-ARENA + 2.5, 0, 0),
      new THREE.Vector3(ARENA - 2.5, 0, 0),
    ];
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f14, emissive: 0xff2a6a, emissiveIntensity: 2.6, roughness: 0.4,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.8 });
    for (const gpos of this.gates) {
      const grp = new THREE.Group();
      const horiz = Math.abs(gpos.x) > Math.abs(gpos.z);
      const w2 = 4, h = 4.4;
      const frameGeo = new THREE.BoxGeometry(0.5, h, 0.5);
      const f1 = new THREE.Mesh(frameGeo, frameMat); f1.position.set(-w2 / 2, h / 2, 0);
      const f2 = new THREE.Mesh(frameGeo, frameMat); f2.position.set(w2 / 2, h / 2, 0);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w2 + 0.5, 0.5, 0.5), frameMat);
      top.position.set(0, h, 0);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(w2 - 0.4, h - 0.4), gateMat);
      glow.position.set(0, h / 2, 0);
      grp.add(f1, f2, top, glow);
      grp.position.copy(gpos);
      if (horiz) grp.rotation.y = Math.PI / 2;
      grp.children.forEach((m) => { m.castShadow = true; });
      glow.castShadow = false;
      this.scene.add(grp);
    }
  }

  /* ---------------- dynamic props ---------------- */
  _buildProps() {
    const ct = makeCrate();
    const crateMat = new THREE.MeshStandardMaterial({
      map: ct.map, normalMap: ct.normalMap,
      roughness: 0.85, metalness: 0.25,
    });
    const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const crateSpots = [
      [-6, 0, -8], [-6, 1.15, -8], [-4.8, 0, -8.4], [7, 0, 6], [7, 1.15, 6],
      [14, 0, -12], [-14, 0, 12], [6, 0, -16], [-16, 0, -4], [16, 0, 16],
      [-8, 0, 14], [12, 0, 2], [-2, 0, 12], [2, 0, -12], [18, 0, -6], [-18, 0, 18, 0],
    ];
    for (const [cx, cy, cz] of crateSpots) {
      const mesh = new THREE.Mesh(crateGeo, crateMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const body = new CANNON.Body({
        mass: 9,
        shape: new CANNON.Box(new CANNON.Vec3(0.575, 0.575, 0.575)),
        material: this.matBox,
        position: new CANNON.Vec3(cx, cy + 0.575, cz),
        linearDamping: 0.6, angularDamping: 0.7,
      });
      body.sleepSpeedLimit = 0.4;
      this.pworld.addBody(body);
      this.scene.add(mesh);
      const crate = { mesh, body, half: new THREE.Vector3(0.575, 0.575, 0.575), awake: 0 };
      body.addEventListener('collide', () => { crate.awake = 2; });
      this.crates.push(crate);
    }

    const bt = makeBarrel();
    const barrelMat = new THREE.MeshStandardMaterial({
      map: bt.map, normalMap: bt.normalMap,
      roughness: 0.6, metalness: 0.4,
    });
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 18);
    const barrelSpots = [
      [4, 0, 3], [-12, 0, 6], [10, 0, -8], [-4, 0, 18], [16, 0, 8],
      [-18, 0, -14], [1, 0, -5], [-9, 0, -16], [22, 0, 14, 0],
    ];
    for (const [bx, , bz] of barrelSpots) {
      const mesh = new THREE.Mesh(barrelGeo, barrelMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const body = new CANNON.Body({
        mass: 14,
        shape: new CANNON.Cylinder(0.42, 0.42, 1.15, 10),
        material: this.matBox,
        position: new CANNON.Vec3(bx, 0.575, bz),
        linearDamping: 0.5, angularDamping: 0.6,
      });
      this.pworld.addBody(body);
      this.scene.add(mesh);
      this.barrels.push({ mesh, body, hp: 30, alive: true, fuse: -1 });
    }
  }

  /* ---------------- runtime ---------------- */
  update(dt, onBarrelBoom) {
    this.time += dt;
    this.pworld.step(1 / 60, dt, 3);

    for (const c of this.crates) {
      c.mesh.position.copy(c.body.position);
      c.mesh.quaternion.copy(c.body.quaternion);
      if (c.body.position.y < -5) { // fell out of world somehow — reset
        c.body.position.set(0, 3, 0);
        c.body.velocity.setZero();
      }
    }

    for (const b of this.barrels) {
      if (!b.alive) continue;
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
      // wobble when the fuse is lit
      if (b.fuse >= 0) {
        b.fuse -= dt;
        const s = 1 + Math.sin(this.time * 60) * 0.05;
        b.mesh.scale.set(s, 1, s);
        if (b.fuse <= 0) {
          b.alive = false;
          b.mesh.visible = false;
          b.body.removeShape(b.body.shapes[0]);
          b.body.sleep();
          onBarrelBoom(b.body.position.clone());
        }
      }
    }
  }

  hitBarrel(barrel, dmg) {
    if (!barrel.alive || barrel.fuse >= 0) return false;
    barrel.hp -= dmg;
    if (barrel.hp <= 0) { barrel.fuse = 0.12; return true; }
    return false;
  }

  // explode at a point: push physics props, chain other barrels (returns chained barrels)
  explode(pos, radius = 6.5) {
    const p = new CANNON.Vec3(pos.x, pos.y, pos.z);
    const chained = [];
    const apply = (body, k) => {
      const d = body.position.vsub(p);
      const dist = Math.max(d.length(), 0.5);
      if (dist > radius) return;
      d.normalize();
      const power = k * (1 - dist / radius);
      body.wakeUp();
      body.applyImpulse(new CANNON.Vec3(d.x * power, d.y * power + power * 0.55, d.z * power));
      body.angularVelocity.x += (Math.random() - 0.5) * power * 0.12;
      body.angularVelocity.z += (Math.random() - 0.5) * power * 0.12;
    };
    for (const c of this.crates) apply(c.body, 26);
    for (const b of this.barrels) {
      if (!b.alive) continue;
      const dist = b.body.position.distanceTo(p);
      apply(b.body, 30);
      if (dist < radius && b.fuse < 0) { b.fuse = 0.25 + Math.random() * 0.35; chained.push(b); }
    }
    return chained;
  }

  // AABB list for kinematic characters: static boxes + (approx) dynamic prop boxes
  collidersFor(pos, out) {
    out.length = 0;
    for (const b of this.staticAABBs) {
      if (pos.x > b.min.x - 3 && pos.x < b.max.x + 3 &&
          pos.z > b.min.z - 3 && pos.z < b.max.z + 3) out.push(b);
    }
    for (const c of this.crates) {
      const p = c.body.position;
      if (Math.abs(pos.x - p.x) > 4 || Math.abs(pos.z - p.z) > 4) continue;
      const h = c.half;
      out.push({
        min: new THREE.Vector3(p.x - h.x, p.y - h.y, p.z - h.z),
        max: new THREE.Vector3(p.x + h.x, p.y + h.y, p.z + h.z),
        body: c.body,
      });
    }
    for (const b of this.barrels) {
      if (!b.alive) continue;
      const p = b.body.position;
      if (Math.abs(pos.x - p.x) > 4 || Math.abs(pos.z - p.z) > 4) continue;
      out.push({
        min: new THREE.Vector3(p.x - 0.45, p.y - 0.6, p.z - 0.45),
        max: new THREE.Vector3(p.x + 0.45, p.y + 0.6, p.z + 0.45),
        body: b.body, barrel: b,
      });
    }
    return out;
  }
}
