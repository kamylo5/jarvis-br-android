import * as THREE from 'three';
import { radialTexture } from './utils.js';

function decalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 20);
  g.addColorStop(0, 'rgba(8,7,6,0.95)');
  g.addColorStop(0.5, 'rgba(14,12,10,0.75)');
  g.addColorStop(1, 'rgba(20,18,15,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(32, 32, 21, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(10,9,8,0.6)'; ctx.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, l = 4 + Math.random() * 13;
    ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.tracers = [];
    this.decals = [];
    this.shells = [];
    this.pool = [];
    this.maxParticles = 120;

    this.smokeTex = radialTexture(96, 'rgba(255,240,220,0.9)', 'rgba(210,190,160,0.4)', 'rgba(190,170,140,0)');
    this.sparkTex = radialTexture(64, 'rgba(255,255,240,1)', 'rgba(255,190,90,0.8)', 'rgba(255,120,20,0)');
    this.bloodTex = radialTexture(64, 'rgba(255,90,70,1)', 'rgba(160,20,10,0.65)', 'rgba(90,0,0,0)');
    this.decalTex = decalTexture();

    for (let i = 0; i < this.maxParticles; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, transparent: true, depthWrite: false,
        blending: THREE.NormalBlending, opacity: 0
      }));
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
  }

  _getSprite(map, blending = THREE.NormalBlending) {
    let s = this.pool.find(p => !p.visible);
    if (!s) {
      s = this.pool.reduce((a, b) => (a.material.opacity <= b.material.opacity ? a : b));
    }
    s.visible = true;
    s.material.map = map;
    s.material.blending = blending;
    s.material.opacity = 1;
    s.material.rotation = 0;
    return s;
  }

  particle(pos, vel, { map = this.smokeTex, color = 0xffffff, size = 0.3, life = 0.5, gravity = 0, drag = 1, fade = 1, blending = THREE.NormalBlending, grow = 0, spin = 0 } = {}) {
    const s = this._getSprite(map, blending);
    s.position.copy(pos);
    s.material.color.setHex(color);
    s.material.opacity = 1;
    s.scale.setScalar(size);
    s.visible = true;
    this.particles.push({
      sprite: s, vel: vel.clone(), life, maxLife: life, gravity, drag, fade, grow, spin
    });
  }

  muzzleSmoke(pos, dir) {
    for (let i = 0; i < 2; i++) {
      const v = dir.clone().multiplyScalar(0.6 + Math.random() * 1.2);
      v.x += (Math.random() - 0.5) * 0.4; v.y += 0.25 + Math.random() * 0.4; v.z += (Math.random() - 0.5) * 0.4;
      this.particle(pos, v, { size: 0.16 + Math.random() * 0.12, life: 0.35 + Math.random() * 0.3, gravity: 0.7, drag: 0.1, grow: 0.9, color: 0xd8d2c6 });
    }
  }

  impact(point, normal, kind = 'world') {
    // sparks
    for (let i = 0; i < 5; i++) {
      const v = normal.clone().multiplyScalar(1.5 + Math.random() * 2.5);
      v.x += (Math.random() - 0.5) * 2.4; v.y += (Math.random() - 0.5) * 2.4 + 0.6; v.z += (Math.random() - 0.5) * 2.4;
      this.particle(point, v, { map: this.sparkTex, color: 0xffc06a, size: 0.055 + Math.random() * 0.04, life: 0.25 + Math.random() * 0.3, gravity: 7, drag: 0.4, blending: THREE.AdditiveBlending });
    }
    // dust puff
    for (let i = 0; i < 2; i++) {
      const v = normal.clone().multiplyScalar(0.7);
      v.x += (Math.random() - 0.5) * 0.8; v.y += 0.3 + Math.random() * 0.4; v.z += (Math.random() - 0.5) * 0.8;
      this.particle(point, v, { map: this.smokeTex, color: kind === 'metal' ? 0xb9b3a6 : 0xcfc3a8, size: 0.16, life: 0.45, gravity: 0.5, drag: 0.2, grow: 0.7 });
    }
    // bullet hole
    if (this.decals.length > 55) {
      const old = this.decals.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.dispose();
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshBasicMaterial({
      map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.9
    }));
    m.position.copy(point).addScaledVector(normal, 0.006);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI);
    this.scene.add(m);
    this.decals.push({ mesh: m, life: 26 });
  }

  blood(point, dir) {
    for (let i = 0; i < 7; i++) {
      const v = dir.clone().multiplyScalar(1.2 + Math.random() * 1.8);
      v.x += (Math.random() - 0.5) * 2.2; v.y += (Math.random() - 0.5) * 1.8 + 0.5; v.z += (Math.random() - 0.5) * 2.2;
      this.particle(point, v, { map: this.bloodTex, color: 0xb01d12, size: 0.08 + Math.random() * 0.09, life: 0.35 + Math.random() * 0.25, gravity: 6, drag: 0.6 });
    }
    this.particle(point, dir.clone().multiplyScalar(0.5), { map: this.bloodTex, color: 0x7a0d08, size: 0.24, life: 0.35, grow: 1.4, gravity: 0.6 });
  }

  tracer(from, to, color = 0xffd08a) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.075, maxLife: 0.075 });
  }

  shell(pos, vel) {
    if (this.shells.length > 24) {
      const old = this.shells.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.dispose();
    }
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6), new THREE.MeshStandardMaterial({ color: 0xc9a052, metalness: 0.8, roughness: 0.35 }));
    mesh.position.copy(pos);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(mesh);
    this.shells.push({ mesh, vel: vel.clone(), life: 2.4, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        p.sprite.material.opacity = 0;
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - Math.min(0.95, p.drag * dt * 3));
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      p.sprite.material.opacity = Math.pow(t, p.fade);
      if (p.grow) p.sprite.scale.setScalar(p.sprite.scale.x + p.grow * dt);
      if (p.spin) p.sprite.material.rotation += p.spin * dt;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.line.material.opacity = Math.max(0, tr.life / tr.maxLife) * 0.9;
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 3) d.mesh.material.opacity = Math.max(0, d.life / 3) * 0.9;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.decals.splice(i, 1);
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      if (s.mesh.position.y < 0.02) { s.mesh.position.y = 0.02; s.vel.y *= -0.35; s.vel.x *= 0.7; s.vel.z *= 0.7; }
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shells.splice(i, 1);
      }
    }
  }
}
