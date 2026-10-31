import * as THREE from 'three';
import { clamp, damp, lerp, randRange } from './utils.js';
import { WEAPONS, buildWeapon, createMuzzleFlash } from './weapons.js';

const EYE = 1.66;

export class Player {
  constructor(scene, camera, world, audio, effects, hud) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.effects = effects;
    this.hud = hud;

    this.position = new THREE.Vector3(world.playerSpawn.x, world.playerSpawn.y, world.playerSpawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = 0.0;
    this.pitch = 0.0;
    this.eye = EYE;
    this.crouchEye = 1.15;
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 50;
    this.maxArmor = 100;
    this.grounded = true;
    this.isMoving = false;
    this.isSprinting = false;
    this.crouching = false;
    this.alive = true;
    this.sensitivity = 1;
    this.enabled = false;
    this.fovBase = 72;
    this.fovAds = 52;

    this.weapons = {
      rifle: { ...WEAPONS.rifle, mag: WEAPONS.rifle.magSize, reserve: WEAPONS.rifle.reserve, model: null },
      smg: { ...WEAPONS.smg, mag: WEAPONS.smg.magSize, reserve: WEAPONS.smg.reserve, model: null }
    };
    this.order = ['rifle', 'smg'];
    this.currentIndex = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.ads = false;
    this.adsT = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.viewKick = 0;
    this.shake = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepTimer = 0;
    this.lastDamageTime = 99;
    this.timeSinceDamage = 99;
    this.stats = { shots: 0, hits: 0, kills: 0, damage: 0 };
    this.weaponSwitching = 0;
    this.hitPoint = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 300;
    this._muzzleWorld = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._lastPos = this.position.clone();

    // view model
    this.viewRoot = new THREE.Group();
    camera.add(this.viewRoot);
    scene.add(camera);
    this.currentModel = null;
    this._buildViewModels();

    this.muzzleFlash = createMuzzleFlash();
    scene.add(this.muzzleFlash.sprite);
    this.muzzleLight = new THREE.PointLight(0xffa75a, 0, 7, 2);
    scene.add(this.muzzleLight);
    this.flashTimer = 0;

    // pickups
    this.pickups = [];
    this._buildPickups();
    this.nearbyPickup = null;

    // landing / menu camera support
    this.spawn = this.position.clone();
  }

  _buildViewModels() {
    for (const key of this.order) {
      const model = buildWeapon(key);
      model.visible = false;
      model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      model.userData.base = key;
      this.weapons[key].model = model;
      this.viewRoot.add(model);
    }
    this.currentModel = this.weapons[this.order[0]].model;
    this.currentModel.visible = true;

    this.hipPos = new THREE.Vector3(0.245, -0.26, -0.48);
    this.adsPos = new THREE.Vector3(0.0, -0.095, -0.36);
    this.viewRoot.position.copy(this.hipPos);
    this.viewRoot.rotation.set(0.015, -0.04, 0);
    this.viewRoot.scale.setScalar(0.7);
  }

  _buildPickups() {
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, 'rgba(255,220,150,0.5)');
      g.addColorStop(1, 'rgba(255,160,50,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const colors = { ammo: 0xffb24d, med: 0x53e08f, armor: 0x50b9ff };
    for (const spot of this.world.lootSpots) {
      const type = spot.type;
      const group = new THREE.Group();
      const color = colors[type];
      const boxMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.35 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1c2223, roughness: 0.7, metalness: 0.3 });
      let mesh;
      if (type === 'med') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), new THREE.MeshStandardMaterial({ color: 0xe8ebe7, roughness: 0.55 }));
        const crossMat = new THREE.MeshStandardMaterial({ color: 0xff4d3d, emissive: 0x5a0a05, emissiveIntensity: 0.8 });
        group.add(mesh);
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.43), crossMat);
        c1.position.z = 0.001; group.add(c1);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.43), crossMat);
        c2.position.z = 0.001; group.add(c2);
      } else if (type === 'armor') {
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), boxMat);
        group.add(mesh);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 5, 18), dark);
        ring.rotation.x = Math.PI / 2; group.add(ring);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.3), boxMat);
        group.add(mesh);
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.32), dark);
        b1.position.y = 0.14; group.add(b1);
        const b2 = b1.clone(); b2.position.y = -0.14; group.add(b2);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      glow.scale.setScalar(1.15);
      glow.position.y = -0.15;
      group.add(glow);
      group.position.set(spot.x, spot.y + 0.45, spot.z);
      group.userData = { type, taken: false, baseY: spot.y + 0.45, phase: Math.random() * 6 };
      this.scene.add(group);
      this.pickups.push(group);
    }
  }

  reset() {
    this.position.copy(this.spawn);
    this.position.y = this.world.heightAt(this.spawn.x, this.spawn.z);
    this.velocity.set(0, 0, 0);
    this.yaw = this.world.playerSpawn.yaw ?? 0.15;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.armor = 50;
    this.alive = true;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.adsT = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.stats = { shots: 0, hits: 0, kills: 0, damage: 0 };
    for (const key of this.order) {
      const w = this.weapons[key];
      w.mag = w.magSize; w.reserve = WEAPONS[key].reserve;
    }
    this.currentIndex = 0;
    this._selectModel();
    this.viewRoot.visible = true;
    for (const p of this.pickups) {
      p.visible = true;
      p.userData.taken = false;
    }
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();
    this.timeSinceDamage = 99;
    this.lastDamageTime = 99;
  }

  get weapon() { return this.weapons[this.order[this.currentIndex]]; }

  _selectModel() {
    for (const key of this.order) this.weapons[key].model.visible = false;
    const m = this.weapon.model;
    m.visible = true;
    this.currentModel = m;
    m.userData.magGroup.rotation.x = 0;
  }

  look(dx, dy, sensitivity) {
    if (!this.alive) return;
    const s = 0.0022 * sensitivity * (this.adsT > 0.5 ? 0.72 : 1);
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -1.42, 1.42);
  }

  update(dt, input, time) {
    if (!this.enabled) return;
    this.timeSinceDamage += dt;
    if (this.alive && this.timeSinceDamage > 6 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 7 * dt);
    }

    const forward = this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (input.forward) move.add(forward);
    if (input.back) move.sub(forward);
    if (input.right) move.add(right);
    if (input.left) move.sub(right);
    const wantsMove = move.lengthSq() > 0.001;
    if (wantsMove) move.normalize();

    this.crouching = input.crouch;
    this.isSprinting = input.sprint && !this.crouching && wantsMove && !this.ads;
    const targetSpeed = this.crouching ? 2.6 : this.isSprinting ? 8.0 : 5.1;
    const accel = this.grounded ? 12 : 3.5;
    const targetVX = move.x * targetSpeed;
    const targetVZ = move.z * targetSpeed;
    this.velocity.x = damp(this.velocity.x, targetVX, accel, dt);
    this.velocity.z = damp(this.velocity.z, targetVZ, accel, dt);

    if (input.jump && this.grounded && !this.crouching) {
      this.velocity.y = 7.2;
      this.grounded = false;
      this.audio.jump();
      input.jump = false;
    }
    this.velocity.y -= 21 * dt;

    const oldX = this.position.x, oldZ = this.position.z;
    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;

    // circular colliders
    for (const c of this.world.colliders) {
      const dx = nx - c.x, dz = nz - c.z;
      const d2 = dx * dx + dz * dz;
      const min = c.r + 0.38;
      if (d2 < min * min && d2 > 0.000001) {
        const d = Math.sqrt(d2);
        nx = c.x + (dx / d) * min;
        nz = c.z + (dz / d) * min;
      }
    }
    // keep player on the island
    if (this.world.heightAt(nx, nz) < -1.2) {
      const a = Math.atan2(-nz, -nx);
      nx = Math.cos(a) * 128;
      nz = Math.sin(a) * 128;
    }
    this.position.x = nx;
    this.position.z = nz;
    this.position.y += this.velocity.y * dt;

    const ground = this.world.heightAt(this.position.x, this.position.z);
    if (this.position.y <= ground) {
      if (!this.grounded) this.audio.land();
      const fallSpeed = -this.velocity.y;
      if (fallSpeed > 9) { this.shake = Math.min(0.5, fallSpeed * 0.02); }
      this.position.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    const realSpeed = Math.hypot(this.position.x - oldX, this.position.z - oldZ) / Math.max(dt, 0.0001);
    this.isMoving = realSpeed > 0.4;

    // footsteps
    if (this.grounded && this.isMoving) {
      this.stepTimer -= dt * (this.isSprinting ? 1.65 : 1.15);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        this.audio.step(this.isSprinting);
      }
      this.bobPhase += dt * (this.isSprinting ? 13 : 9.2);
      this.bobAmount = damp(this.bobAmount, this.crouching ? 0.3 : this.isSprinting ? 1 : 0.7, 6, dt);
    } else {
      this.bobAmount = damp(this.bobAmount, 0, 8, dt);
      this.bobPhase += dt * 1.2;
    }

    // ADS / FOV
    this.ads = input.aim && !this.reloading && this.alive;
    this.adsT = damp(this.adsT, this.ads ? 1 : 0, 13, dt);
    const targetFov = lerp(this.fovBase, this.fovAds, this.adsT);
    this.camera.fov = damp(this.camera.fov, targetFov, 10, dt);
    this.camera.updateProjectionMatrix();

    // weapon timers
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }
    if (this.weaponSwitching > 0) this.weaponSwitching -= dt;

    // shooting
    if (input.fire && this.alive && !this.reloading && this.weaponSwitching <= 0) {
      const w = this.weapon;
      this.fireInterval = 60 / w.rpm;
      if (this.fireCooldown <= 0 && w.mag > 0) {
        this._shoot(time);
      } else if (w.mag <= 0 && !this.reloading) {
        this.startReload();
      }
    }
    if (input.reloadJust) {
      this.startReload();
      input.reloadJust = false;
    }
    if (input.swapJust) {
      this.switchWeapon(this.currentIndex === 0 ? 1 : 0);
      input.swapJust = false;
    }
    if (input.weapon1Just) { this.switchWeapon(0); input.weapon1Just = false; }
    if (input.weapon2Just) { this.switchWeapon(1); input.weapon2Just = false; }
    if (input.interactJust) { this.interact(); input.interactJust = false; }

    // recoil recovery
    this.recoilPitch = damp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 9, dt);
    this.viewKick = damp(this.viewKick, 0, 14, dt);
    this.shake = damp(this.shake, 0, 6, dt);

    // camera transform
    const bobY = Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.026 * this.bobAmount;
    const eyeTarget = this.crouching ? this.crouchEye : EYE;
    this.eye = damp(this.eye, eyeTarget, 12, dt);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.02;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.02;
    this.camera.position.set(this.position.x + bobX * 0.35, this.position.y + this.eye + bobY, this.position.z);
    this._euler.set(this.pitch + this.recoilPitch + this.viewKick * 0.1 + shakeY, this.yaw + this.recoilYaw + shakeX, Math.sin(this.bobPhase) * 0.004 * this.bobAmount);
    this.camera.rotation.copy(this._euler);

    // weapon viewmodel
    const hip = this.hipPos;
    const ads = this.adsPos;
    const targetX = lerp(hip.x, ads.x, this.adsT);
    const targetY = lerp(hip.y, ads.y, this.adsT);
    const targetZ = lerp(hip.z, ads.z, this.adsT);
    const swayX = Math.cos(this.bobPhase) * 0.012 * this.bobAmount;
    const swayY = Math.sin(this.bobPhase * 2) * 0.009 * this.bobAmount;
    const switchDrop = this.weaponSwitching > 0 ? this.weaponSwitching * 0.9 : 0;
    const reloadDrop = this.reloading ? Math.sin(clamp(this.reloadTimer / this.weapon.reloadTime, 0, 1) * Math.PI) * 0.12 : 0;
    this.viewRoot.position.x = damp(this.viewRoot.position.x, targetX + swayX * (1 - this.adsT), 16, dt);
    this.viewRoot.position.y = damp(this.viewRoot.position.y, targetY + swayY * (1 - this.adsT) - switchDrop - reloadDrop, 16, dt);
    this.viewRoot.position.z = damp(this.viewRoot.position.z, targetZ + this.viewKick * 0.12, 18, dt);
    this.viewRoot.rotation.x = damp(this.viewRoot.rotation.x, this.viewKick * 1.2 + (this.adsT ? 0 : 0.015), 14, dt);
    this.viewRoot.rotation.y = damp(this.viewRoot.rotation.y, lerp(-0.045, 0, this.adsT), 12, dt);
    this.viewRoot.rotation.z = damp(this.viewRoot.rotation.z, lerp(0.01, 0, this.adsT) + swayX * 0.3, 12, dt);
    if (this.reloading) {
      const t = this.reloadTimer / this.weapon.reloadTime;
      this.currentModel.userData.magGroup.rotation.x = Math.sin(t * Math.PI) * 0.5;
      this.currentModel.userData.magGroup.position.y = -Math.sin(t * Math.PI) * 0.12;
    } else if (this.currentModel) {
      this.currentModel.userData.magGroup.rotation.x = damp(this.currentModel.userData.magGroup.rotation.x, 0, 10, dt);
      this.currentModel.userData.magGroup.position.y = damp(this.currentModel.userData.magGroup.position.y, 0, 10, dt);
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.muzzleFlash.sprite.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    // pickups
    this.nearbyPickup = null;
    let best = 2.2;
    for (const p of this.pickups) {
      if (p.userData.taken) continue;
      p.rotation.y += dt * 1.6;
      p.position.y = p.userData.baseY + Math.sin(time * 1.8 + p.userData.phase) * 0.08;
      p.children[0].rotation.y += dt * 0.7;
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (d < best) { best = d; this.nearbyPickup = p; }
    }

    this.updateHud();
  }

  _shoot(time) {
    const w = this.weapon;
    w.mag--;
    this.fireCooldown = 60 / w.rpm;
    this.stats.shots++;
    this.flashTimer = 0.045;
    this.muzzleFlash.sprite.visible = true;
    this.muzzleFlash.sprite.material.rotation = Math.random() * 6.28;
    this.muzzleFlash.sprite.scale.setScalar(0.26 + Math.random() * 0.16);
    this.muzzleLight.intensity = 3.2;
    this.currentModel.userData.muzzle.getWorldPosition(this._muzzleWorld);
    this.muzzleLight.position.copy(this._muzzleWorld);
    this.muzzleFlash.sprite.position.copy(this._muzzleWorld).add(new THREE.Vector3(0, 0.02, 0));
    this.audio.shot(w.sound);

    // spread
    const movingPenalty = this.isMoving ? w.moveSpread : 0;
    const spread = lerp(w.spread + movingPenalty, w.adsSpread, this.adsT) * (this.crouching ? 0.8 : 1);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this._raycaster.set(this.camera.position.clone(), dir);
    this._raycaster.far = w.range;

    let hitPoint = null;
    let enemyHit = null;
    const enemyIntersect = this.enemyManager?.raycast(this._raycaster);
    const worldHits = this._raycaster.intersectObjects(this.world.collisionMeshes, true);
    let worldHit = null;
    for (const h of worldHits) {
      if (h.distance < 0.35) continue;
      worldHit = h; break;
    }
    if (enemyIntersect && (!worldHit || enemyIntersect.distance < worldHit.distance)) {
      enemyHit = enemyIntersect;
      hitPoint = enemyIntersect.point;
    } else if (worldHit) {
      hitPoint = worldHit.point;
    }
    if (!hitPoint) hitPoint = this.camera.position.clone().addScaledVector(dir, w.range);

    this.effects.tracer(this._muzzleWorld, hitPoint);
    this.effects.muzzleSmoke(this._muzzleWorld, dir);
    if (enemyHit) {
      const part = enemyHit.object.userData.part;
      const dmg = w.damage * (part === 'head' ? 1.0 : 1.0);
      const killed = enemyHit.object.userData.enemy.hit(dmg, part, hitPoint);
      this.stats.hits++;
      this.stats.damage += dmg;
      this.effects.blood(hitPoint, dir);
      this.hud?.hitmarker(part === 'head');
      this.hud?.damageNumber(hitPoint, Math.round(dmg * (part === 'head' ? w.headMult : 1)), part === 'head', killed);
      this.audio.hitmarker(part === 'head');
      if (killed) {
        this.stats.kills++;
        this.audio.kill();
        this.onKill?.(enemyHit.object.userData.enemy);
      }
    } else {
      const normal = worldHit?.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
      if (worldHit?.face) normal.transformDirection(worldHit.object.matrixWorld);
      this.effects.impact(hitPoint, normal, 'world');
    }

    // shell + recoil
    const shellPos = this.currentModel.userData.muzzle.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0.2, 0.2).applyQuaternion(this.camera.quaternion);
    shellPos.addScaledVector(right, -0.18);
    this.effects.shell(shellPos, right.multiplyScalar(1.4 + Math.random()));
    const recoilMul = this.adsT ? 0.72 : 1;
    this.recoilPitch += w.recoil * recoilMul * (0.8 + Math.random() * 0.4);
    this.recoilYaw += (Math.random() - 0.5) * w.recoil * 0.7 * recoilMul;
    this.viewKick += 0.06;
    this.shake = Math.max(this.shake, 0.12);

    // auto reload
    if (w.mag <= 0) this.startReload();
  }

  startReload() {
    if (this.reloading || !this.alive) return;
    const w = this.weapon;
    if (w.mag >= w.magSize || w.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = w.reloadTime;
    this.audio.reload();
  }

  _finishReload() {
    const w = this.weapon;
    const need = w.magSize - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
    this.reloading = false;
    this.reloadTimer = 0;
  }

  switchWeapon(index) {
    if (index === this.currentIndex || !this.alive) return;
    this.currentIndex = index;
    this.weaponSwitching = 0.28;
    this.reloading = false;
    this.reloadTimer = 0;
    this._selectModel();
    this.audio.equip();
  }

  interact() {
    if (this.nearbyPickup && !this.nearbyPickup.userData.taken) {
      const p = this.nearbyPickup;
      const type = p.userData.type;
      if (type === 'med') {
        this.heal(45);
        this.hud?.toast('KIT MÉDICO', '+45 VIDA');
      } else if (type === 'armor') {
        this.armor = Math.min(this.maxArmor, this.armor + 50);
        this.hud?.toast('COLETE', '+50 BLINDAGEM');
      } else {
        const w = this.weapon;
        w.reserve = Math.min(999, w.reserve + 60);
        this.hud?.toast('MUNIÇÃO', `+60 ${w.short}`);
      }
      this.audio.pickup();
      p.userData.taken = true;
      p.visible = false;
      this.nearbyPickup = null;
    }
  }

  damage(amount, fromPos) {
    if (!this.alive) return;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.58);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.timeSinceDamage = 0;
    this.shake = Math.max(this.shake, 0.35);
    this.audio.hurt();
    this.hud?.damageFlash(fromPos, this.position, this.yaw);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.onDeath?.();
    }
  }

  zoneDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.timeSinceDamage = 0;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.onDeath?.();
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addAmmo(amount) {
    for (const key of this.order) {
      this.weapons[key].reserve = Math.min(999, this.weapons[key].reserve + amount);
    }
  }

  updateHud() {
    if (!this.hud) return;
    this.hud.setHealth(this.health, this.maxHealth, this.armor, this.maxArmor);
    const w = this.weapon;
    this.hud.setWeapon(w, this.currentIndex, this.reloading, this.reloadTimer);
    this.hud.setCrosshair(this.adsT, this.isMoving, this.isSprinting, this.recoilPitch);
    this.hud.setPrompt(this.nearbyPickup, this.nearbyPickup?.userData.type);
    this.hud.setPosition(this.position, this.yaw);
  }
}
