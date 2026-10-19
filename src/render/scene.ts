// Rendering reads sim state and never changes it. No hit testing happens here (see sim/hit.ts).
import * as THREE from "three";
import { mulberry32 } from "../core/rng";
import { layoutFor, type Display } from "../core/display";
import { hfov43FromScale, vfovFrom43 } from "../core/units";
import { BODY_RADIUS, EYE } from "../sim/constants";
import type { Vec3 } from "../sim/geometry";
import { BODY_HEIGHT, HEAD_OFFSET, HEAD_RADIUS } from "../sim/hit";

interface EnemyObj extends THREE.Group {
  userData: { body: THREE.Mesh; head: THREE.Mesh; bodyMat: THREE.MeshLambertMaterial };
}

export class RangeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  private enemies: EnemyObj[];
  private fovScale = 1.4675;
  private display: Display = { aspect: null, scaling: "stretched" };
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const bg = 0x1d232c;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 45, 130);
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, EYE, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x2a2420, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1e0, 0.7);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x2a313b }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(400, 200, 0x46505e, 0x353d48);
    grid.position.y = 0.01;
    this.scene.add(grid);
    const r = mulberry32(99), boxMat = new THREE.MeshLambertMaterial({ color: 0x48525f });
    for (let i = 0; i < 38; i++) {
      const a = r() * Math.PI * 2, d = 28 + r() * 40, w = 2 + r() * 6, h = 1.5 + r() * 7;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2 + r() * 5), boxMat);
      b.position.set(Math.sin(a) * d, h / 2, Math.cos(a) * d);
      b.rotation.y = r() * 3;
      this.scene.add(b);
    }
    this.enemies = [this.makeEnemy(0xff7a3d), this.makeEnemy(0xff9a4d)];
    addEventListener("resize", () => this.resize());
  }

  private makeEnemy(color: number): EnemyObj {
    const bodyMat = new THREE.MeshLambertMaterial({ color, emissive: 0x2a0e04 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffd2b8, emissive: 0x2a0e04 });
    const g = new THREE.Group() as EnemyObj;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 24), bodyMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 20, 14), headMat);
    g.add(body, head);
    g.userData = { body, head, bodyMat };
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  setView(fovScale: number, display: Display): void { this.fovScale = fovScale; this.display = display; this.resize(); }

  resize(): void {
    const L = layoutFor(this.display, innerWidth, innerHeight), v = L.viewport;
    this.renderer.setSize(v.w, v.h, false);
    this.canvas.style.position = "absolute";
    this.canvas.style.left = `${v.x}px`; this.canvas.style.top = `${v.y}px`;
    this.canvas.style.width = `${v.w}px`; this.canvas.style.height = `${v.h}px`;
    // Stretched: camera uses the game aspect while the canvas fills the monitor, so the image is widened exactly like the game.
    this.camera.aspect = L.cameraAspect;
    this.camera.fov = vfovFrom43(hfov43FromScale(this.fovScale)); // vertical FOV (Hor+)
    this.camera.updateProjectionMatrix();
  }

  hideEnemies(): void { this.enemies.forEach(e => (e.visible = false)); }
  hide(i: number): void { this.enemies[i].visible = false; }

  /** Draw enemy i with its feet at `feet` and stance scale h (both straight from the sim). */
  place(i: number, feet: Vec3, h: number): void {
    const e = this.enemies[i], { body, head } = e.userData;
    e.position.set(feet.x, feet.y, feet.z);
    body.scale.y = h; body.position.y = (BODY_HEIGHT / 2) * h; head.position.y = BODY_HEIGHT * h + HEAD_OFFSET;
    e.lookAt(0, feet.y, 0);
    e.visible = true;
  }

  highlight(i: number, on: boolean): void { this.enemies[i].userData.bodyMat.emissive.setHex(on ? 0x6a2508 : 0x2a0e04); }

  render(yaw: number, pitch: number): void {
    this.camera.rotation.set(pitch, yaw, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

