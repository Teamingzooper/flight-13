/**
 * A value that follows its target like a damped spring: it starts and stops smoothly, and with `zeta` below 1 it
 * overshoots a touch and settles, the way a body does. (Small steps keep it steady through a slow frame.)
 */
export class Spring {
  v = 0;
  constructor(public x = 0) {}

  step(target: number, hz: number, zeta: number, dt: number): number {
    const w = 2 * Math.PI * hz;
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }

  snap(x: number): void {
    this.x = x;
    this.v = 0;
  }
}
