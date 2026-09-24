import * as THREE from 'three';

/**
 * What every window shows. Each glass material gets its own copy of the current view so neighbouring
 * windows are offset; switching views crossfades through dark like a passing cloud.
 */
export class WindowView {
  /** Set by the lighting (night skies are dimmer). */
  brightness = 1;
  /** How fast the view drifts past, in texture widths per second. */
  speed = 0.006;
  /** Extra vertical offset: the ground falls away as the plane climbs. */
  lift = 0;
  private current: THREE.Texture;
  private next: THREE.Texture | null = null;
  private fade = 1;
  private fadeSeconds = 1.2;
  private readonly maps: THREE.Texture[] = [];
  private readonly baseY: number[] = [];

  constructor(
    private readonly glass: THREE.MeshBasicMaterial[],
    initial: THREE.Texture,
  ) {
    this.current = initial;
    glass.forEach((g, i) => {
      this.maps[i] = g.map!;
      this.baseY[i] = g.map!.offset.y;
    });
  }

  /** Crossfade to another view (skipped if it is already showing or on its way). */
  show(texture: THREE.Texture, seconds = 1.2): void {
    if (texture === (this.next ?? this.current)) return;
    if (seconds <= 0) {
      this.next = null;
      this.fade = 1;
      this.current = texture;
      this.apply(texture);
      return;
    }
    this.next = texture;
    this.fade = 0;
    this.fadeSeconds = seconds;
  }

  update(dt: number): void {
    let dip = 1;
    if (this.next) {
      this.fade = Math.min(1, this.fade + dt / this.fadeSeconds);
      if (this.fade >= 0.5 && this.current !== this.next) {
        this.current = this.next;
        this.apply(this.current);
      }
      if (this.fade >= 1) this.next = null;
      dip = Math.abs(1 - 2 * this.fade);
    }
    const shade = this.brightness * (0.12 + 0.88 * dip);
    this.glass.forEach((g, i) => {
      g.color.setScalar(shade);
      const map = this.maps[i];
      map.offset.x += dt * this.speed;
      map.offset.y = this.baseY[i] + this.lift;
    });
  }

  dispose(): void {
    for (const map of this.maps) map.dispose();
  }

  private apply(texture: THREE.Texture): void {
    this.glass.forEach((g, i) => {
      const old = this.maps[i];
      const map = texture.clone();
      map.wrapS = THREE.RepeatWrapping;
      map.offset.x = old ? old.offset.x : i * 0.33;
      map.needsUpdate = true;
      this.baseY[i] = texture.offset.y;
      this.maps[i] = map;
      g.map = map;
      old?.dispose();
    });
  }
}
