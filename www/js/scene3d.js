// OBELISK — the stage: monolith with four live faces, mirror floor, starfield,
// bloom, atmosphere grade, shockwaves, and a trauma-model camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { AtmosphereShader } from './atmosphere.js';
import { CV_W, CV_H } from './render2d.js';

const FACE_SLOT = [4, 1, 5, 0]; // face k -> box material slot
const OB_W = 2.15;
const OB_H = OB_W * (CV_H / CV_W);

function easeSpin(t) {
  const c = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return c + Math.sin(t * Math.PI) * 0.045 * Math.sin(t * 6.0);
}

// Cheap value noise, one continuous stream per seed — smooth shake that
// survives pausing and slow-motion, unlike random().
function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i;
  const h = n => {
    const x = Math.sin((n * 127.1 + seed * 311.7)) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export class Stage {
  constructor(canvas, faceCanvases, faceDefs) {
    this.faceDefs = faceDefs;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02030a, 0.05);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.camBase = new THREE.Vector3(0, 0.55, 8.4);
    this.camera.position.copy(this.camBase);
    this.camTarget = new THREE.Vector3(0, 0.15, 0);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.#buildObelisk(faceCanvases);
    this.#buildFloor();
    this.#buildStars();
    this.#buildLights();
    this.#buildParticles();
    this.#buildShockwaves();
    this.#buildMotes();

    // motion state
    this.rotY = 0; this.spinFrom = 0; this.spinTo = 0; this.spinT = 1;
    this.spinDur = 0.72;
    this.idleMode = true;
    this.trauma = 0;            // 0..1, shake = trauma^2
    this.hitstop = 0;           // seconds of frozen simulation remaining
    this.danger = 0;            // 0..1 smoothed
    this.eclipse = 0;           // 0..1 smoothed
    this.flash = 0;
    this.pulse = 0;
    this.zoom = 0;              // 0..1 dolly-in under pressure
    this.shakeClock = 0;

    // post
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.atmos = new ShaderPass(AtmosphereShader);
    this.composer.addPass(this.atmos);
    this.composer.addPass(new OutputPass());

    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  #buildObelisk(faceCanvases) {
    this.textures = faceCanvases.map(cv => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    });

    const dark = () => new THREE.MeshStandardMaterial({ color: 0x05060d, roughness: 0.35, metalness: 0.85 });
    const mats = [dark(), dark(), dark(), dark(), dark(), dark()];
    for (let k = 0; k < 4; k++) mats[FACE_SLOT[k]] = new THREE.MeshBasicMaterial({ map: this.textures[k] });
    this.obelisk = new THREE.Mesh(new THREE.BoxGeometry(OB_W, OB_H, OB_W), mats);
    this.group.add(this.obelisk);

    this.edgeMat = new THREE.MeshBasicMaterial({ color: 0x88f4ff });
    const r = 0.035, w = OB_W / 2, h = OB_H / 2;
    const frame = new THREE.Group();
    const pillar = new THREE.BoxGeometry(r, OB_H + r * 2, r);
    const railX = new THREE.BoxGeometry(OB_W + r * 2, r, r);
    const railZ = new THREE.BoxGeometry(r, r, OB_W + r * 2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const m = new THREE.Mesh(pillar, this.edgeMat);
      m.position.set(sx * w, 0, sz * w);
      frame.add(m);
    }
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) { const m = new THREE.Mesh(railX, this.edgeMat); m.position.set(0, sy * h, sz * w); frame.add(m); }
      for (const sx of [1, -1]) { const m = new THREE.Mesh(railZ, this.edgeMat); m.position.set(sx * w, sy * h, 0); frame.add(m); }
    }
    this.group.add(frame);

    const capMat = new THREE.MeshStandardMaterial({ color: 0x0a0e1c, roughness: 0.2, metalness: 0.9, emissive: 0x111a33, emissiveIntensity: 0.6 });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(OB_W * 0.78, 0.6, 4), capMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = h + 0.3;
    this.group.add(cap);
    this.tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), this.edgeMat);
    this.tip.position.y = h + 0.66;
    this.group.add(this.tip);

    this.group.position.y = 0.35;
    this.floorY = -OB_H / 2 - 0.02 + 0.35;
  }

  #buildFloor() {
    const mirror = new Reflector(new THREE.CircleGeometry(30, 64), {
      clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x1c2434,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = this.floorY;
    this.scene.add(mirror);

    const scrim = new THREE.Mesh(new THREE.CircleGeometry(30, 64),
      new THREE.MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0.62 }));
    scrim.rotation.x = -Math.PI / 2;
    scrim.position.y = this.floorY + 0.005;
    this.scene.add(scrim);

    const ring = new THREE.Mesh(new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: this.#ringTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = this.floorY + 0.012;
    this.scene.add(ring);
    this.ring = ring;
  }

  #ringTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(256, 256, 60, 256, 256, 250);
    g.addColorStop(0, 'rgba(80,200,255,0.16)');
    g.addColorStop(0.55, 'rgba(60,140,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = 'rgba(120,220,255,0.22)'; c.lineWidth = 3;
    c.beginPath(); c.arc(256, 256, 150, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(120,220,255,0.10)';
    c.beginPath(); c.arc(256, 256, 205, 0, Math.PI * 2); c.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  #buildStars() {
    const N = 2600;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const tint = [new THREE.Color(0x9fd8ff), new THREE.Color(0xffffff), new THREE.Color(0xcdb4ff), new THREE.Color(0xffd9a0)];
    for (let i = 0; i < N; i++) {
      const rad = 26 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(rad * Math.cos(ph)) * 0.75 - 4;
      pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
      const cc = tint[(Math.random() * tint.length) | 0], b = 0.35 + Math.random() * 0.65;
      col[i * 3] = cc.r * b; col[i * 3 + 1] = cc.g * b; col[i * 3 + 2] = cc.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false,
    }));
    this.scene.add(this.stars);
  }

  // Slow dust drifting through the light — sells scale and atmosphere.
  #buildMotes() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    this.moteSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = Math.random() * 9 - 2.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12 + 1;
      this.moteSeed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.035, color: 0x9fd8ff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(this.motes);
  }

  #buildLights() {
    this.scene.add(new THREE.AmbientLight(0x223044, 0.7));
    const key = new THREE.PointLight(0x66aaff, 30, 40);
    key.position.set(5, 6, 6);
    this.scene.add(key);
    this.accentLight = new THREE.PointLight(0x22d3ee, 18, 25);
    this.accentLight.position.set(0, 1, 4.5);
    this.scene.add(this.accentLight);
  }

  #buildParticles() {
    const MAX = 1400;
    this.pMax = MAX; this.pAlive = 0;
    this.pPos = new Float32Array(MAX * 3);
    this.pVel = new Float32Array(MAX * 3);
    this.pLife = new Float32Array(MAX);
    this.pCol = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setDrawRange(0, 0);
    this.pMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.pMesh.frustumCulled = false;
    this.scene.add(this.pMesh);
  }

  // Pool of expanding rings — the shockwave of a sealed course.
  #buildShockwaves() {
    this.waves = [];
    const geo = new THREE.RingGeometry(0.85, 1.0, 96);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.waves.push({ mesh: m, t: 1, dur: 1, scale: 1, vertical: false });
    }
  }

  // A ring that blasts outward. vertical=true rings the obelisk like a hoop
  // travelling down the tower; otherwise it spreads across the floor.
  shockwave(colorHex, strength = 1, y = null, vertical = true) {
    const slot = this.waves.find(w => w.t >= 1) || this.waves[0];
    slot.mesh.material.color.set(colorHex);
    slot.mesh.visible = true;
    slot.t = 0;
    slot.dur = 0.55 + strength * 0.5;
    slot.scale = 2.2 + strength * 5.5;
    slot.vertical = vertical;
    if (vertical) {
      slot.mesh.rotation.set(0, 0, 0);
      slot.mesh.position.set(0, y ?? this.group.position.y, 0);
    } else {
      slot.mesh.rotation.set(-Math.PI / 2, 0, 0);
      slot.mesh.position.set(0, this.floorY + 0.02, 0);
    }
    slot.strength = strength;
  }

  burst(rowY01, colorHex, count = 120) {
    const color = new THREE.Color(colorHex);
    const y = this.group.position.y + OB_H / 2 - 0.12 - rowY01 * (OB_H - 0.3);
    const z = OB_W / 2 + 0.05;
    for (let i = 0; i < count; i++) {
      if (this.pAlive >= this.pMax) break;
      const k = this.pAlive++;
      this.pPos[k * 3] = (Math.random() - 0.5) * OB_W * 0.95;
      this.pPos[k * 3 + 1] = y + (Math.random() - 0.5) * 0.1;
      this.pPos[k * 3 + 2] = z;
      this.pVel[k * 3] = (Math.random() - 0.5) * 2.4;
      this.pVel[k * 3 + 1] = Math.random() * 2.2 + 0.4;
      this.pVel[k * 3 + 2] = Math.random() * 2.6 + 0.6;
      this.pLife[k] = 0.9 + Math.random() * 0.7;
      const w = 0.6 + Math.random() * 0.4;
      this.pCol[k * 3] = color.r * w + (1 - w);
      this.pCol[k * 3 + 1] = color.g * w + (1 - w);
      this.pCol[k * 3 + 2] = color.b * w + (1 - w);
    }
  }

  #stepParticles(dt) {
    let alive = 0;
    for (let i = 0; i < this.pAlive; i++) {
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) continue;
      const j = alive;
      if (j !== i) {
        for (let a = 0; a < 3; a++) {
          this.pPos[j * 3 + a] = this.pPos[i * 3 + a];
          this.pVel[j * 3 + a] = this.pVel[i * 3 + a];
          this.pCol[j * 3 + a] = this.pCol[i * 3 + a];
        }
        this.pLife[j] = this.pLife[i];
      }
      this.pVel[j * 3 + 1] -= 3.2 * dt;
      this.pPos[j * 3] += this.pVel[j * 3] * dt;
      this.pPos[j * 3 + 1] += this.pVel[j * 3 + 1] * dt;
      this.pPos[j * 3 + 2] += this.pVel[j * 3 + 2] * dt;
      alive++;
    }
    this.pAlive = alive;
    this.pMesh.geometry.setDrawRange(0, alive);
    this.pMesh.geometry.attributes.position.needsUpdate = true;
    this.pMesh.geometry.attributes.color.needsUpdate = true;
  }

  // Always land exactly on face k. Re-selecting the face you are already on
  // takes the long way round — a FULL turn (2π), never a half turn, which
  // would leave the camera staring at the opposite face.
  spinToFace(k) {
    this.spinFrom = this.rotY;
    let target = k * Math.PI / 2;
    while (target <= this.spinFrom - Math.PI) target += Math.PI * 2;
    while (target > this.spinFrom + Math.PI) target -= Math.PI * 2;
    if (Math.abs(target - this.spinFrom) < 0.01) {
      target += Math.PI * 2 * (Math.random() < 0.5 ? 1 : -1);
    }
    this.spinTo = target;
    this.spinT = 0;
  }

  // The face the camera is actually looking at, for assertions/debug.
  facingFace() {
    for (let k = 0; k < 4; k++) if (Math.cos(this.rotY - k * Math.PI / 2) > 0.9) return k;
    return -1;
  }

  setAccent(hex) {
    this.edgeMat.color.set(hex);
    this.accentLight.color.set(hex);
    this.ring.material.color.set(hex);
  }

  // Trauma accumulates; shake is trauma^2 so small events barely register and
  // big ones dominate. Callers speak in one shared intensity language.
  kick(amount = 0.3) { this.trauma = Math.min(1, this.trauma + amount); }
  freeze(seconds) { this.hitstop = Math.max(this.hitstop, seconds); }
  impact(amount = 0.5) { this.flash = Math.min(1, this.flash + amount); }
  setDanger(x) { this.dangerTarget = x; }
  setEclipse(on) { this.eclipseTarget = on ? 1 : 0; }
  setPulse(x) { this.pulse = x; }

  markFaceDirty(k) { this.textures[k].needsUpdate = true; }

  visibleFaces() {
    const set = new Set();
    for (let k = 0; k < 4; k++) if (Math.cos(this.rotY - k * Math.PI / 2) > 0.04) set.add(k);
    return set;
  }

  get spinning() { return this.spinT < 1; }
  get frozen() { return this.hitstop > 0; }

  update(dt, now) {
    // hitstop freezes simulation-time motion but never the render loop
    if (this.hitstop > 0) { this.hitstop = Math.max(0, this.hitstop - dt); dt = 0; }

    if (this.idleMode) {
      this.rotY += dt * 0.25;
    } else if (this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / this.spinDur);
      this.rotY = this.spinFrom + (this.spinTo - this.spinFrom) * easeSpin(this.spinT);
    }
    this.group.rotation.y = this.rotY;

    const spinVel = this.spinT < 1 ? Math.sin(this.spinT * Math.PI) * Math.sign(this.spinTo - this.spinFrom) : 0;
    this.group.rotation.z += ((spinVel * -0.06) - this.group.rotation.z) * Math.min(1, dt * 8);

    this.group.position.y = 0.35 + Math.sin(now / 2400) * 0.045 + this.pulse * 0.02;
    this.tip.rotation.y += dt * 1.2;
    this.stars.rotation.y += dt * 0.004;

    // motes drift upward and recycle
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < this.moteSeed.length; i++) {
      let y = mp.array[i * 3 + 1] + dt * (0.12 + (this.moteSeed[i] % 1) * 0.16);
      let x = mp.array[i * 3] + Math.sin(now / 3000 + this.moteSeed[i]) * dt * 0.14;
      if (y > 7) { y = -2.6; }
      mp.array[i * 3 + 1] = y; mp.array[i * 3] = x;
    }
    mp.needsUpdate = true;

    // shockwaves
    for (const w of this.waves) {
      if (w.t >= 1) { if (w.mesh.visible) w.mesh.visible = false; continue; }
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = 1 - Math.pow(1 - w.t, 3);
      const s = 0.4 + e * w.scale;
      w.mesh.scale.set(s, s, s);
      w.mesh.material.opacity = (1 - w.t) * 0.75 * (w.strength ?? 1);
    }

    // smoothed mood
    this.danger += ((this.dangerTarget ?? 0) - this.danger) * Math.min(1, dt * 3);
    this.eclipse += ((this.eclipseTarget ?? 0) - this.eclipse) * Math.min(1, dt * 5);
    this.flash = Math.max(0, this.flash - dt * 3.4);
    this.trauma = Math.max(0, this.trauma - dt * 1.15);

    // camera: trauma-model shake, rotational + slight translational, plus a
    // pressure dolly that leans in when a face is close to overrun
    const shake = this.trauma * this.trauma;
    this.shakeClock += dt * 34;
    const zoomTarget = this.danger * 0.55 + this.eclipse * -0.35;
    this.zoom += (zoomTarget - this.zoom) * Math.min(1, dt * 2.2);

    this.camera.position.set(
      this.camBase.x + Math.sin(now / 3100) * 0.16 + vnoise(this.shakeClock, 1) * shake * 0.22,
      this.camBase.y + Math.sin(now / 4300) * 0.1 + vnoise(this.shakeClock, 2) * shake * 0.22,
      this.camBase.z - this.zoom + vnoise(this.shakeClock, 3) * shake * 0.1
    );
    this.camera.lookAt(this.camTarget);
    this.camera.rotation.z += vnoise(this.shakeClock, 4) * shake * 0.06;

    // grade
    const u = this.atmos.uniforms;
    u.uTime.value = now / 1000;
    u.uAberration.value = 0.0013 + this.danger * 0.004 + shake * 0.012 + this.pulse * 0.0008;
    u.uEclipse.value = this.eclipse;
    u.uDanger.value = this.danger;
    u.uFlash.value = this.flash;
    u.uPulse.value = this.pulse;
    u.uGrain.value = 0.05 + this.danger * 0.03;

    this.bloom.strength = 0.85 + this.pulse * 0.22 + this.eclipse * 0.5 + this.flash * 0.8;
    this.edgeMat.color.offsetHSL(0, 0, 0); // keep material live
    this.accentLight.intensity = 18 + this.pulse * 10 + this.eclipse * 14;

    this.#stepParticles(dt);
    this.composer.render();
  }

  resize() {
    const el = this.renderer.domElement.parentElement;
    const w = el?.clientWidth || window.innerWidth;
    const h = el?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camBase.z = w / h < 1.15 ? 10.6 : 8.4;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.textures.forEach(t => t.dispose());
    this.composer.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
