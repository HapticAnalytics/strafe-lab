// Rendering reads sim state and never changes it. The raycast here only reports what the crosshair is over;
// Milestone 1 replaces it with analytic per-event hit tests in sim/.
import * as THREE from "three";
import { mulberry32 } from "../core/rng";
import { layoutFor, type Display } from "../core/display";
import { DEG, hfov43FromScale, vfovFrom43 } from "../core/units";
import { EYE } from "../sim/constants";
import { type Mover } from "../sim/mover";
import { enemyChest, type Vec3 } from "../sim/geometry";

interface EnemyObj extends THREE.Group {
  userData: { body: THREE.Mesh; head: THREE.Mesh; bodyMat: THREE.MeshLambertMaterial };
}

export class RangeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  private raycaster = new THREE.Raycaster();
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 1.45, 16), bodyMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), headMat);
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

  place(i: number, m: Mover, theta: number, dist: number): Vec3 {
    const e = this.enemies[i], { body, head } = e.userData;
    const c = enemyChest(m, theta, dist);
    const fx = -Math.sin(theta), fz = -Math.cos(theta), rx = Math.cos(theta), rz = -Math.sin(theta);
    e.position.set(fx * dist + rx * m.x, m.y, fz * dist + rz * m.x);
    body.scale.y = m.h; body.position.y = 0.725 * m.h; head.position.y = 1.45 * m.h + 0.16;
    e.lookAt(0, m.y, 0);
    e.visible = true;
    return c;
  }

  /** What the crosshair is over, for the given enemy indices. */
  aim(yaw: number, pitch: number, which: number[]): { index: number; head: boolean } | null {
    this.camera.rotation.set(pitch, yaw, 0);
    this.scene.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const objs: THREE.Object3D[] = [];
    which.forEach(i => { const e = this.enemies[i]; if (e.visible) objs.push(e.userData.body, e.userData.head); });
    const hit = this.raycaster.intersectObjects(objs, false);
    if (!hit.length) return null;
    const o = hit[0].object;
    const index = which.find(i => this.enemies[i].userData.body === o || this.enemies[i].userData.head === o)!;
    return { index, head: o === this.enemies[index].userData.head };
  }

  highlight(i: number, on: boolean): void { this.enemies[i].userData.bodyMat.emissive.setHex(on ? 0x6a2508 : 0x2a0e04); }

  render(yaw: number, pitch: number): void {
    this.camera.rotation.set(pitch, yaw, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

export { DEG };
