import { clamp } from './utils.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.el = {
      hud: $('hud'),
      compassStrip: $('compassStrip'),
      zoneTimer: $('zoneTimer'),
      zoneState: $('zoneState'),
      aliveNum: $('aliveNum'),
      killCount: $('killCount'),
      minimap: $('minimap'),
      minimapCoords: $('minimapCoords'),
      healthBar: $('healthBar'),
      healthText: $('healthText'),
      armorBar: $('armorBar'),
      armorText: $('armorText'),
      weaponName: $('weaponName'),
      weaponMode: $('fireMode'),
      ammoMag: $('ammoMag'),
      ammoReserve: $('ammoReserve'),
      magPips: $('magPips'),
      slot1: $('slot1'),
      slot2: $('slot2'),
      killfeed: $('killfeed'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      toast: $('toast'),
      prompt: $('pickupPrompt'),
      promptText: $('pickupText'),
      damageNumbers: $('damageNumbers'),
      damageDirs: $('damageDirs'),
      danger: $('dangerVignette'),
      zoneWarning: $('zoneWarning'),
      fireMode: $('fireMode'),
      debug: $('debug'),
      lockHint: $('lockHint')
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.minimapSize = 240;
    this.zone = null;
    this.toastTimer = 0;
    this.toasts = [];
    this.lastHealth = 100;
    this.lastAmmo = 30;
    this._buildCompass();
    this._drawBriefMap();
    this.playerPos = { x: 0, z: 0 };
    this.playerYaw = 0;
    this.enemies = [];
    this.time = 0;
  }

  _buildCompass() {
    const strip = this.el.compassStrip;
    strip.innerHTML = '';
    const labels = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    for (let i = 0; i < 80; i++) {
      const deg = ((i * 11.25) - 180 + 360) % 360;
      const tick = document.createElement('span');
      const norm = Math.round(deg * 100) / 100;
      const key = Math.round(norm / 45) * 45 % 360;
      const isMajor = Math.abs(norm - key) < 0.1 || Math.abs(norm - 360) < 0.1;
      tick.className = 'compass-tick' + (isMajor ? ' major' : '');
      tick.dataset.deg = deg;
      tick.innerHTML = `<em>${isMajor ? (labels[key] ?? '') : ''}</em><i></i>`;
      strip.appendChild(tick);
    }
    strip.style.transform = 'translateX(-17px)';
    this.compassEls = [...strip.children];
    const style = document.createElement('style');
    style.textContent = '.compass-tick em{font-style:normal;font-size:9px;line-height:1;color:inherit}';
    document.head.appendChild(style);
  }

  _drawBriefMap() {
    const canvas = document.getElementById('briefMap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.world.mapCanvas, 0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,170,60,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(56,224,207,0.7)';
    ctx.beginPath(); ctx.arc(s * 0.42, s * 0.38, s * 0.15, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const poi of this.world.pois) {
      const x = (poi.x / this.world.mapExtent + 0.5) * s;
      const z = (poi.z / this.world.mapExtent + 0.5) * s;
      ctx.fillRect(x - 2, z - 2, 4, 4);
    }
    // drop route
    ctx.strokeStyle = 'rgba(255,210,120,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s * 0.48, s * 0.9);
    ctx.bezierCurveTo(s * 0.55, s * 0.7, s * 0.45, s * 0.45, s * 0.62, s * 0.18);
    ctx.stroke();
    ctx.fillStyle = '#ffb24d';
    ctx.beginPath(); ctx.arc(s * 0.48, s * 0.9, 4, 0, Math.PI * 2); ctx.fill();
  }

  show() { this.el.hud.hidden = false; }
  hide() { this.el.hud.hidden = true; }

  setZone(zone) { this.zone = zone; }

  setAlive(n, total) {
    this.el.aliveNum.textContent = String(n).padStart(2, '0');
  }

  setKills(n) { this.el.killCount.textContent = n; }

  setZoneUi(timeLeft, closing) {
    const m = Math.floor(Math.max(0, timeLeft) / 60);
    const s = Math.floor(Math.max(0, timeLeft) % 60);
    this.el.zoneTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    this.el.zoneState.textContent = closing ? 'FECHANDO' : 'ESTÁVEL';
    this.el.zoneState.classList.toggle('closing', !!closing);
  }

  setHealth(hp, maxHp, armor, maxArmor) {
    const pct = clamp(hp / maxHp, 0, 1) * 100;
    this.el.healthBar.style.width = `${pct}%`;
    this.el.healthText.textContent = Math.ceil(hp);
    this.el.armorBar.style.width = `${clamp(armor / maxArmor, 0, 1) * 100}%`;
    this.el.armorText.textContent = Math.ceil(armor);
    this.el.healthBar.parentElement.classList.toggle('low', hp < 30);
  }

  setWeapon(w, index, reloading, reloadTimer) {
    this.el.weaponName.textContent = reloading ? 'RECARREGANDO…' : w.name;
    this.el.fireMode.textContent = w.mode;
    this.el.ammoMag.textContent = w.mag;
    this.el.ammoReserve.textContent = w.reserve;
    this.el.ammoMag.style.color = w.mag <= Math.ceil(w.magSize * 0.25) ? '#ff5a3c' : '';
    this.el.slot1.classList.toggle('active', index === 0);
    this.el.slot2.classList.toggle('active', index === 1);
    if (this.el.magPips.childElementCount !== w.magSize) {
      this.el.magPips.innerHTML = '';
      for (let i = 0; i < w.magSize; i++) this.el.magPips.appendChild(document.createElement('i'));
    }
    if (this.lastAmmo !== w.mag) {
      [...this.el.magPips.children].forEach((pip, i) => pip.classList.toggle('empty', i >= w.mag));
      this.lastAmmo = w.mag;
    }
  }

  setCrosshair(adsT, moving, sprinting, recoil) {
    const spread = 7 + (moving ? 4 : 0) + (sprinting ? 8 : 0) + Math.min(18, recoil * 900);
    this.el.crosshair.style.setProperty('--spread', `${spread}px`);
    this.el.crosshair.classList.toggle('hidden', adsT > 0.6);
  }

  setPrompt(pickup, type) {
    if (pickup) {
      const label = type === 'med' ? 'KIT MÉDICO' : type === 'armor' ? 'COLETE' : 'MUNIÇÃO';
      this.el.promptText.textContent = `SAQUEAR ${label}`;
      this.el.prompt.classList.add('show');
    } else {
      this.el.prompt.classList.remove('show');
    }
  }

  setPosition(pos, yaw) {
    this.playerPos.x = pos.x; this.playerPos.z = pos.z;
    this.playerYaw = yaw;
    this.el.minimapCoords.textContent = `X ${String(Math.round(pos.x)).padStart(3, '0')} · Z ${String(Math.round(pos.z)).padStart(3, '0')}`;
  }

  setCompass(yaw) {
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const offset = -((heading + 180) / 11.25) * 34 - 17;
    this.el.compassStrip.style.transform = `translateX(${offset}px)`;
  }

  setEnemies(list) { this.enemies = list; }

  hitmarker(head) {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    el.classList.toggle('head', !!head);
    void el.offsetWidth;
    el.classList.add('show');
  }

  damageNumber(worldPos, amount, head, killed) {
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'dmg-num' + (head ? ' head' : '') + (killed ? ' kill' : '');
    el.textContent = killed ? 'ELIMINADO' : String(amount);
    el.style.left = `${x + (Math.random() - 0.5) * 24}px`;
    el.style.top = `${y + (Math.random() - 0.5) * 14}px`;
    this.el.damageNumbers.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  damagedFrom(fromPos) {
    if (!fromPos) return;
    const dx = fromPos.x - this.playerPos.x;
    const dz = fromPos.z - this.playerPos.z;
    const bearing = Math.atan2(dx, dz);
    const deg = (bearing - this.playerYaw - Math.PI) * 180 / Math.PI;
    const el = document.createElement('div');
    el.className = 'dir-mark';
    el.style.setProperty('--rot', `${deg.toFixed(1)}deg`);
    this.el.damageDirs.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  damageFlash(fromPos, playerPos, yaw) {
    this.damagedFrom(fromPos);
    const v = this.el.danger;
    v.classList.add('hit');
    setTimeout(() => v.classList.remove('hit'), 110);
  }

  killfeed(killer, victim, weapon, head = false, you = false) {
    const el = document.createElement('div');
    el.className = 'feed-item' + (head ? ' head' : '');
    el.innerHTML = `<span class="${you ? 'you' : ''}">${killer}</span><span class="gun">[${weapon}]</span><span>${victim}</span>`;
    this.el.killfeed.appendChild(el);
    while (this.el.killfeed.childElementCount > 5) this.el.killfeed.firstElementChild.remove();
    setTimeout(() => el.remove(), 6500);
  }

  toast(title, sub) {
    const line = document.createElement('div');
    line.className = 'toast-line';
    line.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.el.toast.appendChild(line);
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
      setTimeout(() => line.remove(), 300);
    }, 1900);
    while (this.el.toast.childElementCount > 2) this.el.toast.firstElementChild.remove();
  }

  zoneWarning(show) {
    this.el.zoneWarning.classList.toggle('show', show);
  }

  lockHint(show) {
    this.el.lockHint.classList.toggle('show', show);
  }

  update(time, dt) {
    this.time = time;
    this.setCompass(this.playerYaw);
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.ctx;
    const s = this.minimapSize;
    const size = s;
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.world.mapCanvas, 0, 0, s, s);

    const toMap = (x, z) => [((x / this.world.mapExtent + 0.5) * s), ((z / this.world.mapExtent + 0.5) * s)];

    // zone
    if (this.zone) {
      const [zx, zy] = toMap(this.zone.center.x, this.zone.center.z);
      const zr = (this.zone.radius / this.world.mapExtent) * s;
      ctx.fillStyle = 'rgba(7,10,12,0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, s, s);
      ctx.arc(zx, zy, zr, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,164,60,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(zx, zy, zr, 0, Math.PI * 2); ctx.stroke();
      if (this.zone.nextRadius && this.zone.nextRadius < this.zone.radius) {
        ctx.strokeStyle = 'rgba(84,215,255,0.75)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(zx, zy, (this.zone.nextRadius / this.world.mapExtent) * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // POIs
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '700 8px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    for (const poi of this.world.pois) {
      const [x, y] = toMap(poi.x, poi.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // enemies (only nearby — radar range)
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.group.position.x - this.playerPos.x;
      const dz = e.group.position.z - this.playerPos.z;
      if (dx * dx + dz * dz > 60 * 60) continue;
      const [x, y] = toMap(e.group.position.x, e.group.position.z);
      ctx.fillStyle = '#ff4a38';
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,74,56,0.3)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
    }

    // player arrow
    const [px, py] = toMap(this.playerPos.x, this.playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-this.playerYaw);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // view cone
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-this.playerYaw);
    const grad = ctx.createLinearGradient(0, 0, 0, -46);
    grad.addColorStop(0, 'rgba(255,210,120,0.22)');
    grad.addColorStop(1, 'rgba(255,210,120,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}
