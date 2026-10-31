import * as THREE from 'three';
import { clamp, damp, randRange, mulberry32, lerp } from './utils.js';
import { radialTexture } from './utils.js';

const BOT_NAMES = [
  'FANTASMA', 'CACIQUE', 'TIGRE', 'CORVO', 'LOBO', 'SOMBRA', 'REI', 'VULCÃO',
  'TEMPESTADE', 'JAGUAR', 'FALCÃO', 'BRUXO', 'METEORO', 'TITÃ', 'ORION', 'SERPENTE'
];

const skinTones = [0x8a5c3f, 0x6d452c, 0xa9744f, 0x513322];
const shirtColors = [0x4a5138, 0x3d4433, 0x585440, 0x343d34, 0x5b4b36];
const helmetColors = [0x2b2e2a, 0x3b3d32, 0x262a26];

function glowSprite() {
  return radialTexture(64, 'rgba(255,240,200,1)', 'rgba(255,180,70,0.85)', 'rgba(255,120,20,0)');
}

export class EnemyManager {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.rng = mulberry32(9911);
    this.enemies = [];
    this.hitMeshes = [];
    this.flashTex = glowSprite();
    this.total = 0;
    this.onKill = null;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
  }

  spawn(count, player) {
    const points = [...this.world.spawnPoints];
    const near = [
      { x: 58, z: 38 }, { x: 10, z: 40 }, { x: 46, z: 18 }
    ];
    // Sort so bots start spread around the player, not on top of them.
    let pi = 0;
    for (let i = 0; i < count; i++) {
      let pt = points[pi % points.length];
      pi++;
      if (i < near.length) {
        pt = near[i];
      } else {
        for (let tries = 0; tries < 12; tries++) {
          const cand = points[Math.floor(this.rng() * points.length)];
          const d = Math.hypot(cand.x - player.position.x, cand.z - player.position.z);
          if (d > 32 && this.world.heightAt(cand.x, cand.z) > 2) { pt = cand; break; }
        }
      }
      let x = pt.x + randRange(this.rng, -2.5, 2.5);
      let z = pt.z + randRange(this.rng, -2.5, 2.5);
      if (this.world.heightAt(x, z) < 1.5) { x = pt.x * 0.9; z = pt.z * 0.9; }
      const e = new Enemy(this, x, z, i);
      this.enemies.push(e);
      this.scene.add(e.group);
      this.hitMeshes.push(...e.hitMeshes);
    }
    this.total = count;
  }

  get alive() {
    return this.enemies.filter(e => !e.dead).length;
  }

  update(dt, player, time) {
    for (const e of this.enemies) e.update(dt, player, time);
  }

  raycast(raycaster) {
    const hits = raycaster.intersectObjects(this.hitMeshes, false);
    for (const h of hits) {
      const owner = h.object.userData.enemy;
      if (owner && !owner.dead) return h;
    }
    return null;
  }

  reset() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.dispose();
    }
    this.enemies.length = 0;
    this.hitMeshes.length = 0;
  }
}

class Enemy {
  constructor(manager, x, z, index) {
    this.manager = manager;
    this.world = manager.world;
    this.effects = manager.effects;
    this.audio = manager.audio;
    this.rng = mulberry32(5000 + index * 7717);
    this.name = BOT_NAMES[index % BOT_NAMES.length];
    this.maxHp = 100;
    this.hp = 100;
    this.armor = index % 3 === 0 ? 20 : 0;
    this.dead = false;
    this.deathT = 0;
    this.speed = 2.5 + this.rng() * 0.7;
    this.range = 24 + this.rng() * 16;
    this.fireTimer = 1 + this.rng() * 2;
    this.burst = 0;
    this.burstTimer = 0;
    this.reloadTimer = 0;
    this.shotsInMag = 18 + Math.floor(this.rng() * 10);
    this.strafe = this.rng() > 0.5 ? 1 : -1;
    this.strafeTimer = 1 + this.rng() * 2;
    this.state = 'patrol';
    this.target = new THREE.Vector3(x, 0, z);
    this.lastSeen = new THREE.Vector3(x, 0, z);
    this.losTimer = this.rng() * 0.3;
    this.hasLos = false;
    this.walkPhase = this.rng() * 6;
    this.flashTimer = 0;
    this.aimPitch = 0;
    this.hitMeshes = [];
    this.disposed = false;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    this.group = new THREE.Group();
    this.group.position.set(x, this.world.heightAt(x, z), z);
    this.group.rotation.y = this.rng() * Math.PI * 2;
    this._build();
  }

  _build() {
    const rng = this.rng;
    const skin = new THREE.MeshStandardMaterial({ color: skinTones[Math.floor(rng() * skinTones.length)], roughness: 0.75 });
    const shirt = new THREE.MeshStandardMaterial({ color: shirtColors[Math.floor(rng() * shirtColors.length)], roughness: 0.9 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x31362e, roughness: 0.95 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x22261f, roughness: 0.82 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmetColors[Math.floor(rng() * helmetColors.length)], roughness: 0.65, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5, emissive: 0x4a1600, emissiveIntensity: 0.8 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x191b1d, roughness: 0.5, metalness: 0.7 });

    const root = new THREE.Group();
    this.bodyRoot = root;
    this.group.add(root);

    // legs
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.36, 3, 7), pants);
      thigh.position.y = -0.23; leg.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 3, 7), pants);
      shin.position.y = -0.66; leg.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.28), vest);
      boot.position.set(0, -0.87, 0.05); leg.add(boot);
      leg.position.set(sx * 0.12, 0.9, 0);
      root.add(leg);
    }

    // torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.34, 4, 9), shirt);
    torso.position.y = 1.22;
    torso.scale.set(1.08, 1, 0.72);
    root.add(torso);
    const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.28), vest);
    vestMesh.position.set(0, 1.24, 0.01);
    root.add(vestMesh);
    for (let i = 0; i < 3; i++) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.07), vest);
      pouch.position.set(-0.13 + i * 0.13, 1.09, 0.17);
      root.add(pouch);
    }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.07, 0.26), vest);
    belt.position.y = 0.98; root.add(belt);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), accent);
    shoulder.position.set(0.25, 1.4, 0); root.add(shoulder);

    // arms
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]]) {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 3, 6), shirt);
      upper.position.y = -0.16; arm.add(upper);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 3, 6), skin);
      fore.position.y = -0.44; arm.add(fore);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.11), vest);
      glove.position.y = -0.6; arm.add(glove);
      arm.position.set(sx * 0.29, 1.38, 0);
      root.add(arm);
    }

    // head
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), skin);
    skull.scale.set(0.95, 1.05, 1);
    this.head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.position.y = 0.035;
    this.head.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.025, 0.13), helmetMat);
    brim.position.set(0, 0.04, 0.11); this.head.add(brim);
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.03), new THREE.MeshStandardMaterial({ color: 0x101514, roughness: 0.3, metalness: 0.3 }));
    goggles.position.set(0, 0.01, 0.12); this.head.add(goggles);
    this.head.position.y = 1.58;
    root.add(this.head);

    // rifle
    this.gun = new THREE.Group();
    const gbody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.42), gunMat);
    this.gun.add(gbody);
    const gbarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 7), gunMat);
    gbarrel.rotation.x = Math.PI / 2; gbarrel.position.set(0, 0.01, -0.34); this.gun.add(gbarrel);
    const gmag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), gunMat);
    gmag.position.set(0, -0.1, -0.02); gmag.rotation.x = 0.18; this.gun.add(gmag);
    const gstock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.16), gunMat);
    gstock.position.set(0, -0.005, 0.26); this.gun.add(gstock);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), accent);
    sight.position.set(0, 0.06, -0.05); this.gun.add(sight);
    this.gun.position.set(0.16, 1.24, 0.12);
    this.gun.rotation.y = -0.1;
    root.add(this.gun);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, -0.54);
    this.gun.add(this.muzzle);

    // aim arms
    this.armR.rotation.set(1.15, 0.1, 0.18);
    this.armL.rotation.set(1.3, 0, -0.5);

    // hit boxes (invisible, reliable)
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.4), hitMat);
    bodyHit.position.y = 1.2;
    const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), hitMat);
    headHit.position.y = 1.61;
    for (const [mesh, part] of [[bodyHit, 'body'], [headHit, 'head']]) {
      mesh.userData.enemy = this;
      mesh.userData.part = part;
      root.add(mesh);
      this.hitMeshes.push(mesh);
    }

    // muzzle flash sprite
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.manager.flashTex, color: 0xffc27a, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.flash.scale.setScalar(0.7);
    this.flash.visible = false;
    this.muzzle.add(this.flash);

    // health bar sprite
    this.healthCanvas = document.createElement('canvas');
    this.healthCanvas.width = 64; this.healthCanvas.height = 10;
    this.healthTex = new THREE.CanvasTexture(this.healthCanvas);
    this.healthSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.healthTex, transparent: true, depthWrite: false, depthTest: false }));
    this.healthSprite.scale.set(1.1, 0.14, 1);
    this.healthSprite.position.y = 2.15;
    this.healthSprite.visible = false;
    root.add(this.healthSprite);
    this._drawHealth();

    // shadow flag
    root.traverse((o) => {
      if (o.isMesh && o.material !== hitMat) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  _drawHealth() {
    const ctx = this.healthCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, 64, 10);
    const pct = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillStyle = pct > 0.55 ? '#63e6a0' : pct > 0.25 ? '#ffc14d' : '#ff4f3d';
    ctx.fillRect(1, 1, 62 * pct, 8);
    this.healthTex.needsUpdate = true;
  }

  _losTo(player) {
    const p = this.group.position;
    const q = player.position;
    // terrain line of sight
    const steps = 10;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = lerp(p.x, q.x, t), z = lerp(p.z, q.z, t);
      const h = this.world.heightAt(x, z);
      const ly = lerp(p.y + 1.5, q.y + 1.4, t);
      if (h > ly + 0.15) return false;
    }
    // prop line of sight (2D circles)
    for (const c of this.world.colliders) {
      if (!c.los) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const fx = p.x - c.x, fz = p.z - c.z;
      const a = dx * dx + dz * dz;
      if (a < 0.0001) continue;
      let t = -(fx * dx + fz * dz) / a;
      t = clamp(t, 0, 1);
      const cx = p.x + dx * t - c.x, cz = p.z + dz * t - c.z;
      if (cx * cx + cz * cz < c.r * c.r * 0.72) return false;
    }
    return true;
  }

  _move(dt, dirX, dirZ, speed) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.001) return;
    dirX /= len; dirZ /= len;
    let nx = this.group.position.x + dirX * speed * dt;
    let nz = this.group.position.z + dirZ * speed * dt;
    if (this.world.heightAt(nx, nz) < 1.2) {
      // steer back to the island centre
      const a = Math.atan2(-this.group.position.z, -this.group.position.x);
      nx = this.group.position.x + Math.cos(a) * speed * dt;
      nz = this.group.position.z + Math.sin(a) * speed * dt;
    }
    // collision slide
    for (const c of this.world.colliders) {
      const dx = nx - c.x, dz = nz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.35;
      if (d < min && d > 0.0001) {
        nx = c.x + (dx / d) * min;
        nz = c.z + (dz / d) * min;
      }
    }
    this.group.position.x = nx;
    this.group.position.z = nz;
    this.group.position.y = this.world.heightAt(nx, nz);
  }

  _shoot(player) {
    const dist = this.group.position.distanceTo(player.position);
    const from = this._v1;
    this.muzzle.getWorldPosition(from);
    const target = this._v2;
    target.copy(player.position);
    target.y += 1.35;
    const moving = player.isMoving;
    const difficulty = this.manager.rng;
    const acc = clamp(1 - dist / 75, 0.25, 1) * (moving ? 0.72 : 1) * 0.82;
    const hit = difficulty() < acc * 0.62;
    const spread = hit ? 0.06 : 1.1 + difficulty() * 2.2;
    target.x += (difficulty() - 0.5) * spread;
    target.y += (difficulty() - 0.5) * spread * 0.7;
    target.z += (difficulty() - 0.5) * spread;
    this.effects.tracer(from, target, 0xffb066);
    this.flash.visible = true;
    this.flash.material.rotation = difficulty() * 6;
    this.flashTimer = 0.05;
    this.audio.enemyShot(dist);
    if (hit) {
      const dmg = 7 + difficulty() * 5;
      player.damage(dmg, this.group.position.clone());
    }
  }

  hit(damage, part, point) {
    if (this.dead) return false;
    let dmg = damage;
    if (part === 'head') dmg *= 2.15;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.55);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.healthSprite.visible = true;
    this._drawHealth();
    this.state = 'engage';
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    this.hp = 0;
    this.healthSprite.visible = false;
    this.flash.visible = false;
    this.manager.onKill?.(this);
  }

  update(dt, player, time) {
    if (this.dead) {
      this.deathT += dt;
      const t = clamp(this.deathT / 0.65, 0, 1);
      this.bodyRoot.rotation.x = -t * Math.PI / 2;
      this.bodyRoot.position.y = t * -0.18;
      if (this.deathT > 7 && !this.disposed) {
        this.disposed = true;
        this.group.visible = false;
      }
      return;
    }

    const p = this.group.position;
    const dx = player.position.x - p.x;
    const dz = player.position.z - p.z;
    const dist = Math.hypot(dx, dz);
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.22 + this.rng() * 0.2;
      this.hasLos = dist < 85 && this._losTo(player);
    }

    // face player when engaged
    const targetYaw = Math.atan2(-dx, -dz);
    if (dist < 70 || this.state === 'engage') {
      let d = targetYaw - this.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.group.rotation.y += d * Math.min(1, dt * (this.state === 'engage' ? 5 : 2));
    }

    if (this.hasLos && dist < 68) {
      this.state = 'engage';
      this.lastSeen.set(player.position.x, player.position.y, player.position.z);
      // maintain combat distance and strafe
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 1.2 + this.rng() * 2.4;
        this.strafe *= -1;
      }
      const forward = dist > this.range + 6 ? 1 : dist < this.range - 9 ? -0.6 : 0;
      const moveX = (dx / dist) * forward + (-dz / dist) * this.strafe * 0.75;
      const moveZ = (dz / dist) * forward + (dx / dist) * this.strafe * 0.75;
      this._move(dt, moveX, moveZ, this.speed * (forward !== 0 ? 1 : 0.75));
      // aiming
      this.armR.rotation.x = damp(this.armR.rotation.x, 1.32 + clamp((player.position.y - p.y) * 0.04, -0.2, 0.3), 8, dt);
      // fire control
      this.fireTimer -= dt;
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
      } else if (this.burst > 0) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          this.burstTimer = 0.13;
          this.burst--;
          this.shotsInMag--;
          this._shoot(player);
          if (this.burst <= 0) this.fireTimer = 0.5 + this.rng() * 1.15;
          if (this.shotsInMag <= 0) { this.reloadTimer = 2.1; this.shotsInMag = 18 + Math.floor(this.rng() * 10); }
        }
      } else if (this.fireTimer <= 0) {
        this.burst = 2 + Math.floor(this.rng() * 4);
        this.burstTimer = 0;
      }
    } else {
      // advance toward last seen position, otherwise wander
      const goal = this.state === 'engage' ? this.lastSeen : this.target;
      const gx = goal.x - p.x, gz = goal.z - p.z;
      const gd = Math.hypot(gx, gz);
      if (gd > 2.5) {
        this._move(dt, gx, gz, this.speed * 0.92);
      } else if (this.state !== 'engage') {
        // pick a new patrol target
        const a = this.rng() * Math.PI * 2, r = 20 + this.rng() * 50;
        this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      if (this.state === 'engage' && !this.hasLos) this.fireTimer = Math.max(this.fireTimer, 0.35);
    }

    // walk animation
    const moved = this.state !== 'engage' || dist > this.range + 6 || dist < this.range - 9;
    if (moved) {
      this.walkPhase += dt * (this.state === 'engage' ? 7 : 5.5);
      const swing = Math.sin(this.walkPhase) * 0.55;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      if (!this.hasLos) {
        this.armL.rotation.x = -swing * 0.5;
        this.armR.rotation.x = 0.25 + swing * 0.5;
      }
    } else {
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 8, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 8, dt);
    }
    this.head.rotation.x = damp(this.head.rotation.x, -clamp((player.position.y - p.y) * 0.05, -0.2, 0.3), 6, dt);
    // subtle idle breathing
    this.bodyRoot.position.y = Math.sin(time * 1.7 + this.walkPhase) * 0.012;
    this.gun.position.y = 1.24 + Math.sin(time * 1.7 + this.walkPhase) * 0.01;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash.visible = false;
    }
    if (this.healthSprite.visible && this.hp >= this.maxHp) this.healthSprite.visible = false;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
    this.healthTex?.dispose();
  }
}

export { BOT_NAMES };
