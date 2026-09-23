import * as THREE from 'three';
import { BOTTOM, HAIR_COLOR, SKIN, TOP } from '../../app/Avatar';
import type { PlayerSummary, SeatId } from '../../engine';
import { seatPose } from '../layout';

/** Placeholder seated mannequin (Milestone 4 replaces it with animated characters). */
class Figure {
  readonly root = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private path: THREE.CatmullRomCurve3 | null = null;
  private pathT = 0;
  private pathLength = 1;
  seat: SeatId | null = null;
  dead = false;

  constructor(player: PlayerSummary) {
    const mat = (color: string, roughness = 0.8) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness });
      this.materials.push(m);
      return m;
    };
    const top = mat(TOP[player.look.top] ?? TOP[0]);
    const skin = mat(SKIN[player.look.skin] ?? SKIN[0], 0.6);
    const hair = mat(HAIR_COLOR[player.look.hairColor] ?? HAIR_COLOR[0], 0.9);
    const bottom = mat(BOTTOM[player.look.bottom] ?? BOTTOM[0]);
    const bulk = 1 + (player.look.body - 1) * 0.08;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15 * bulk, 0.3, 6, 12), top);
    torso.position.set(0, 0.2, 0);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin);
    neck.position.set(0, 0.42, 0);
    this.upper.add(torso, neck);
    this.upper.position.set(0, 0.62, 0.1);
    this.upper.rotation.x = 0.12;

    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 16), skin);
    face.scale.set(0.92, 1.08, 1);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.106, 20, 12, 0, Math.PI * 2, 0, Math.PI * (player.look.hair === 3 ? 0.2 : 0.55)), hair);
    hairCap.rotation.x = -0.35;
    hairCap.position.y = 0.012;
    this.head.add(face, hairCap);
    this.head.position.set(0, 0.56, 0);
    this.upper.add(this.head);

    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), bottom);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.set(side * 0.09, 0.56, -0.15);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 8), bottom);
      shin.position.set(side * 0.09, 0.28, -0.36);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), top);
      arm.position.set(side * 0.2, 0.26, -0.02);
      arm.rotation.x = -0.5;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skin);
      hand.position.set(side * 0.2, 0.1, -0.16);
      this.root.add(thigh, shin);
      this.upper.add(arm, hand);
    }
    this.root.add(this.upper);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
  }

  place(seat: SeatId, animate: boolean): void {
    const { x, z } = seatPose(seat);
    if (!animate || !this.seat) {
      this.root.position.set(x, 0, z);
      this.seat = seat;
      this.path = null;
      return;
    }
    const from = this.root.position.clone();
    this.seat = seat;
    this.path = new THREE.CatmullRomCurve3([
      from,
      new THREE.Vector3(Math.sign(from.x) * 0.15, 0.08, from.z),
      new THREE.Vector3(0, 0.1, (from.z + z) / 2),
      new THREE.Vector3(Math.sign(x) * 0.15, 0.08, z),
      new THREE.Vector3(x, 0, z),
    ]);
    this.pathLength = Math.max(0.5, this.path.getLength());
    this.pathT = 0;
  }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    this.upper.rotation.x = dead ? 0.9 : 0.12;
    this.upper.position.z = dead ? 0 : 0.1;
    this.upper.position.y = dead ? 0.56 : 0.62;
    this.head.rotation.set(dead ? 0.5 : 0, 0, dead ? 0.3 : 0);
    for (const m of this.materials) m.color.multiplyScalar(dead ? 0.45 : 1 / 0.45);
  }

  /** Face roughly where they look (Milestone 4 syncs this over the network). */
  look(yaw: number): void {
    this.head.rotation.y = yaw;
  }

  update(dt: number): void {
    if (!this.path) return;
    this.pathT = Math.min(1, this.pathT + (dt * 1.1) / this.pathLength);
    const point = this.path.getPointAt(this.pathT);
    this.root.position.copy(point);
    if (this.pathT >= 1) this.path = null;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** Every other passenger in the cabin. */
export class Passengers {
  readonly group = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private readonly idle = new Map<string, number>();

  sync(players: PlayerSummary[], youId: string | null, animateMoves: boolean): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === youId || !p.seat || p.status === 'restrained') continue;
      seen.add(p.id);
      let figure = this.figures.get(p.id);
      if (!figure) {
        figure = new Figure(p);
        this.figures.set(p.id, figure);
        this.group.add(figure.root);
        this.idle.set(p.id, Math.random() * 10);
      }
      if (figure.seat !== p.seat) figure.place(p.seat, animateMoves);
      figure.setDead(p.status === 'dead');
    }
    for (const [id, figure] of this.figures) {
      if (seen.has(id)) continue;
      this.group.remove(figure.root);
      figure.dispose();
      this.figures.delete(id);
    }
  }

  update(dt: number, time: number): void {
    for (const [id, figure] of this.figures) {
      figure.update(dt);
      if (!figure.dead) figure.look(Math.sin(time * 0.23 + (this.idle.get(id) ?? 0)) * 0.5);
    }
  }
}
