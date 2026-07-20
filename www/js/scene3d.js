// OBELISK — the 3D stage: monolith with four live canvas faces, mirror floor,
// starfield, bloom, spin choreography, clear-burst particles.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CV_W, CV_H } from './render2d.js';

// Box material slot -> face index mapping. Box order: [+x,-x,+y,-y,+z,-z].
// Face k fronts the camera when obeliskGroup.rotation.y === k * PI/2:
//   k=0 -> +z (slot 4), k=1 -> -x (slot 1), k=2 -> -z (slot 5), k=3 -> +x (slot 0)
const FACE_SLOT = [4, 1, 5, 0];

const OB_W = 2.15;
const OB_H = OB_W * (CV_H / CV_W); // keep texture aspect true

function easeSpin(t) {
  // easeInOutCubic with a whisper of overshoot at the end
  const c = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return c + Math.sin(t * Math.PI) * 0.045 * Math.sin(t * 6.0);
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
    this.shake = 0;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.#buildObelisk(faceCanvases);
    this.#buildFloor();
    this.#buildStars();
    this.#buildLights();
    this.#buildParticles();

    // spin state
    this.rotY = 0;
    this.spinFrom = 0;
    this.spinTo = 0;
    this.spinT = 1;          // 1 = idle
    this.spinDur = 0.72;
    this.idleMode = true;    // title screen: slow rotation

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
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
    for (let k = 0; k < 4; k++) {
      mats[FACE_SLOT[k]] = new THREE.MeshBasicMaterial({ map: this.textures[k] });
    }
    const geo = new THREE.BoxGeometry(OB_W, OB_H, OB_W);
    this.obelisk = new THREE.Mesh(geo, mats);
    this.group.add(this.obelisk);

    // glowing edge frame
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x88f4ff });
    this.edgeMat = edgeMat;
    const r = 0.035, w = OB_W / 2, h = OB_H / 2;
    const frame = new THREE.Group();
    const pillar = new THREE.BoxGeometry(r, OB_H + r * 2, r);
    const railX = new THREE.BoxGeometry(OB_W + r * 2, r, r);
    const railZ = new THREE.BoxGeometry(r, r, OB_W + r * 2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const m = new THREE.Mesh(pillar, edgeMat);
      m.position.set(sx * w, 0, sz * w);
      frame.add(m);
    }
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const m = new THREE.Mesh(railX, edgeMat);
        m.position.set(0, sy * h, sz * w);
        frame.add(m);
      }
      for (const sx of [1, -1]) {
        const m = new THREE.Mesh(railZ, edgeMat);
        m.position.set(sx * w, sy * h, 0);
        frame.add(m);
      }
    }
    this.group.add(frame);

    // apex pyramid cap + base plinth
    const capGeo = new THREE.ConeGeometry(OB_W * 0.78, 0.6, 4);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0a0e1c, roughness: 0.2, metalness: 0.9, emissive: 0x111a33, emissiveIntensity: 0.6 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = h + 0.3;
    this.group.add(cap);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), edgeMat);
    tip.position.y = h + 0.66;
    this.group.add(tip);
    this.tip = tip;

    this.group.position.y = 0.35;
  }

  #buildFloor() {
    const mirror = new Reflector(new THREE.CircleGeometry(30, 64), {
      clipBias: 0.003,
      textureWidth: 2048,
      textureHeight: 2048,
      color: 0x1c2434,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -OB_H / 2 - 0.02 + 0.35;
    this.scene.add(mirror);

    // dark translucent scrim so the mirror reads as polished obsidian
    const scrim = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshBasicMaterial({ color: 0x02030a, transparent: true, opacity: 0.62 })
    );
    scrim.rotation.x = -Math.PI / 2;
    scrim.position.y = mirror.position.y + 0.005;
    this.scene.add(scrim);

    // faint concentric glow ring under the obelisk
    const ringTex = this.#ringTexture();
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = mirror.position.y + 0.012;
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
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = 'rgba(120,220,255,0.22)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(256, 256, 150, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(120,220,255,0.10)';
    c.beginPath(); c.arc(256, 256, 205, 0, Math.PI * 2); c.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  #buildStars() {
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const tint = [new THREE.Color(0x9fd8ff), new THREE.Color(0xffffff), new THREE.Color(0xcdb4ff), new THREE.Color(0xffd9a0)];
    for (let i = 0; i < N; i++) {
      const rad = 26 + Math.random() * 60;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(rad * Math.cos(ph)) * 0.75 - 4;
      pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
      const cc = tint[(Math.random() * tint.length) | 0];
      const b = 0.35 + Math.random() * 0.65;
      col[i * 3] = cc.r * b; col[i * 3 + 1] = cc.g * b; col[i * 3 + 2] = cc.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
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
    const MAX = 900;
    this.pMax = MAX;
    this.pAlive = 0;
    this.pPos = new Float32Array(MAX * 3);
    this.pVel = new Float32Array(MAX * 3);
    this.pLife = new Float32Array(MAX);
    this.pCol = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.pMesh = new THREE.Points(geo, mat);
    this.pMesh.frustumCulled = false;
    this.scene.add(this.pMesh);
  }

  // Burst at a cleared row: rowY01 = 0 (top of well) .. 1 (bottom), in front-face space.
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

  // Kick off the eased spin to face k (0..3).
  spinToFace(k) {
    this.spinFrom = this.rotY;
    // shortest sane path, always at least a quarter turn, spin direction random-ish
    let target = k * Math.PI / 2;
    while (target <= this.spinFrom - Math.PI) target += Math.PI * 2;
    while (target > this.spinFrom + Math.PI) target -= Math.PI * 2;
    if (Math.abs(target - this.spinFrom) < 0.01) target += Math.PI * 2 * (Math.random() < 0.5 ? 1 : -1) * 0.5;
    this.spinTo = target;
    this.spinT = 0;
  }

  setAccent(hex) {
    this.edgeMat.color.set(hex);
    this.accentLight.color.set(hex);
    this.ring.material.color.set(hex).multiplyScalar(1.0);
  }

  kick(strength = 0.5) { this.shake = Math.min(1.2, this.shake + strength); }

  markFaceDirty(k) { this.textures[k].needsUpdate = true; }

  get spinning() { return this.spinT < 1; }

  update(dt, now) {
    // spin / idle rotation
    if (this.idleMode) {
      this.rotY += dt * 0.25;
    } else if (this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / this.spinDur);
      this.rotY = this.spinFrom + (this.spinTo - this.spinFrom) * easeSpin(this.spinT);
    }
    this.group.rotation.y = this.rotY;

    // spin lean: tilt into the turn
    const spinVel = this.spinT < 1 ? Math.sin(this.spinT * Math.PI) * Math.sign(this.spinTo - this.spinFrom) : 0;
    this.group.rotation.z += ((spinVel * -0.06) - this.group.rotation.z) * Math.min(1, dt * 8);

    // gentle hover
    this.group.position.y = 0.35 + Math.sin(now / 2400) * 0.045;
    this.tip.rotation.y += dt * 1.2;

    // stars drift
    this.stars.rotation.y += dt * 0.004;

    // camera float + shake
    this.shake = Math.max(0, this.shake - dt * 3.2);
    const s = this.shake * this.shake * 0.09;
    this.camera.position.set(
      this.camBase.x + Math.sin(now / 3100) * 0.16 + (Math.random() - 0.5) * s,
      this.camBase.y + Math.sin(now / 4300) * 0.1 + (Math.random() - 0.5) * s,
      this.camBase.z + (Math.random() - 0.5) * s * 0.5
    );
    this.camera.lookAt(this.camTarget);

    this.#stepParticles(dt);
    this.composer.render();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole obelisk in frame on narrow windows
    this.camBase.z = w / h < 1.15 ? 10.6 : 8.4;
    this.camera.updateProjectionMatrix();
  }
}
