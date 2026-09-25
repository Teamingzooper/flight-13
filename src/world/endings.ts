import * as THREE from 'three';
import { destinationOf, grid, isPilot, roleNameIn, type GameResult, type PlayerSummary, type PlayerView } from '../engine';
import { captainName } from '../tv/format';
import { cabinAudio } from './audio';
import { BULKHEAD_Z, FLIGHT_DECK, eyePosition } from './layout';
import type { LightMode } from './lighting';
import type { Actor, People } from './scene/people';
import { TARMAC_LENGTH, TarmacSet } from './sets/tarmac';
import type { WindowView } from './windows';

/**
 * How Flight 13 ends, seen through your own eyes before the end screen:
 * - arrest: the passengers caught every saboteur. Landing, then the police come aboard and walk the
 *   restrained saboteurs off (they see it from where they stand; everyone else watches from their seat).
 * - escape: saboteurs were still free when the plane landed. They sprint off; the plane goes up behind
 *   them in slow motion, names over their heads. Passengers see them run past... and then the blast.
 * - hijack: the saboteurs took over (or the Pilot is gone). Pistols out, heads down. Their leader hammers on
 *   the flight deck door until it gives and holds the Pilot at gunpoint (a rogue Pilot opens it for him),
 *   and the plane banks away.
 * - ghost: nobody is left. A slow drift down the empty cabin.
 */
export type EndingKind = 'arrest' | 'escape' | 'hijack' | 'ghost';

export function endingFor(result: GameResult): EndingKind {
  switch (result.reason) {
    case 'eliminated':
      return 'arrest';
    case 'landed':
      return 'escape';
    case 'parity':
    case 'pilot':
      return 'hijack';
    case 'no_survivors':
      return 'ghost';
  }
}

export interface EndingContext {
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  camera: THREE.PerspectiveCamera;
  people: People;
  windows: WindowView;
  faces: ReadonlyMap<string, string> | null;
  showRunway: () => void;
  /** Hold the flight deck door open or shut (null gives it back to whoever walks through). */
  setCockpitDoor: (open: boolean | null) => void;
  setLights: (mode: LightMode) => void;
  masksDown: () => void;
  explode: (at: THREE.Vector3) => void;
  shake: (amount: number) => void;
  flash: (amount: number) => void;
  /** The picture's darkness, 0..1, easing there over `seconds`. */
  fade: (black: number, seconds: number) => void;
  caption: (text: string, who?: string) => void;
  /** Draw another set (the tarmac) instead of the cabin, or the cabin again (null). */
  showSet: (scene: THREE.Scene | null, camera?: THREE.Camera) => void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const span = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));
const FRONT_EXIT = new THREE.Vector3(0, 0, BULKHEAD_Z - 1.1);
const AISLE_FRONT = new THREE.Vector3(0, 0, BULKHEAD_Z + 0.15);
/** In the galley, facing the flight deck door; and the doorway itself, at head height. */
const DECK_OUTSIDE = new THREE.Vector3(0, 0, FLIGHT_DECK.doorZ + 0.5);
const DECK_DOORWAY = new THREE.Vector3(0, 1.45, FLIGHT_DECK.doorZ);

/** Police uniform: navy shirt and trousers, a dark cap. */
const COP_LOOKS = [
  { body: 2, skin: 1, hair: 7, hairColor: 0, top: 8, topStyle: 0, bottom: 3 },
  { body: 1, skin: 4, hair: 7, hairColor: 0, top: 8, topStyle: 0, bottom: 3 },
  { body: 2, skin: 6, hair: 7, hairColor: 0, top: 8, topStyle: 0, bottom: 3 },
  { body: 1, skin: 2, hair: 7, hairColor: 0, top: 8, topStyle: 0, bottom: 3 },
];

interface Beat {
  at: number;
  fn: () => void;
  done?: boolean;
}

/** Plays one ending; `done` once the end screen should show. */
export class EndingDirector {
  readonly kind: EndingKind;
  done = false;
  /** Length, updated as the plan firms up (walks take as long as they take). */
  length: number;
  private readonly beats: Beat[] = [];
  private readonly tags = document.createElement('div');
  private readonly tagEls = new Map<string, HTMLDivElement>();
  private readonly eye = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly smoothEye = new THREE.Vector3();
  private readonly smoothTarget = new THREE.Vector3();
  private readonly you: PlayerSummary | null;
  private readonly players: PlayerSummary[];
  private readonly city: string;
  private roll = 0;
  private started = false;
  /** Who everyone looks at right now. */
  private interest: (() => THREE.Vector3 | null) | null = null;
  /** Your camera, from the scene's point of view (set per ending). */
  private cameraFn: (t: number) => void = () => undefined;
  private tarmac: TarmacSet | null = null;
  private tarmacFrom = -1;
  private landingFrom = -1;
  private bankFrom = -1;
  private tagged = new Set<string>();

  constructor(
    private readonly ctx: EndingContext,
    private readonly game: PlayerView,
  ) {
    this.kind = endingFor(game.result!);
    this.players = game.players;
    this.you = game.players.find((p) => p.id === game.you?.id) ?? null;
    this.city = destinationOf(game.settings).city;
    this.tags.className = 'world-tags';
    // Under the black between shots.
    ctx.container.insertBefore(this.tags, ctx.container.querySelector('.world-fade'));
    this.length = 12;
    switch (this.kind) {
      case 'arrest':
        this.planArrest();
        break;
      case 'escape':
        this.planEscape();
        break;
      case 'hijack':
        this.planHijack();
        break;
      case 'ghost':
        this.planGhost();
        break;
    }
  }

  /** How far the plane is banked (radians, right wing down): the flight deck shows it through the windscreen. */
  get bank(): number {
    return this.roll;
  }

  /** `t`: seconds since the ending began. */
  update(t: number, dt: number, time: number): void {
    if (!this.started) {
      this.started = true;
      this.snapCamera();
    }
    for (const beat of this.beats) {
      if (!beat.done && t >= beat.at) {
        beat.done = true;
        beat.fn();
      }
    }
    // The landing, from the windows: descending, touching down, braking.
    if (this.landingFrom >= 0) {
      const l = t - this.landingFrom;
      this.ctx.windows.lift = 0.45 * (1 - span(l, 0, 3.2));
      this.ctx.windows.speed = l < 3.2 ? 1.25 : 1.25 * Math.max(0, 1 - (l - 3.2) / 2.4);
      if (l > 3.2 && l < 4.2) this.ctx.shake(0.004);
    }
    // Gazes: everyone still in their seat watches whatever is happening.
    const focus = this.interest?.() ?? null;
    for (const p of this.players) {
      const actor = this.ctx.people.actor(p.id);
      if (!actor || p.id === this.you?.id) continue;
      // (The Pilot is behind his door: he looks where the hijack tells him to.)
      if (p.status === 'dead' || grid.isCockpit(p.seat)) continue;
      if (!actor.walking && !actor.armed) actor.gaze = focus;
    }
    if (this.tarmac && t >= this.tarmacFrom) {
      this.tarmac.show(t - this.tarmacFrom, time);
      this.placeTags(this.tarmac.heads(), this.tarmac.camera);
      return;
    }
    this.cameraFn(t);
    // Smooth the eye, add the bank (hijack), and place the name tags.
    const k = 1 - Math.exp(-dt * 7);
    this.smoothEye.lerp(this.eye, k);
    this.smoothTarget.lerp(this.target, 1 - Math.exp(-dt * 5));
    const cam = this.ctx.camera;
    cam.position.copy(this.smoothEye);
    cam.lookAt(this.smoothTarget);
    if (this.bankFrom >= 0) this.roll = 0.32 * span(t - this.bankFrom, 0, 2.2);
    // The cabin tilts with the bank; on the flight deck it is the horizon outside that tilts (see bank).
    if (this.roll && cam.position.z > FLIGHT_DECK.doorZ) cam.rotateZ(this.roll);
    this.placeTags(
      [...this.tagged].flatMap((id) => {
        const actor = this.ctx.people.actor(id);
        // Gone through the curtain at the front: off the plane.
        const aboard = actor && !actor.hidden && actor.root.position.z > BULKHEAD_Z - 0.2;
        return aboard ? [{ id, at: actor.eyes().add(new THREE.Vector3(0, 0.42, 0)) }] : [];
      }),
      cam,
    );
  }

  dispose(): void {
    this.tags.remove();
    this.tarmac?.dispose();
    this.tarmac = null;
    this.ctx.showSet(null);
  }

  // ---------- Shared pieces ----------

  private at(seconds: number, fn: () => void): void {
    this.beats.push({ at: seconds, fn });
  }

  private actor(id: string): Actor | undefined {
    return this.ctx.people.actor(id);
  }

  private label(p: PlayerSummary): string {
    return `${p.name}${p.role ? ` · ${roleNameIn(p.role, this.game.settings)}` : ''}`;
  }

  /** Where your eyes are when the ending starts: your seat, your spot in the galley, or the tower's. */
  private homeEye(): THREE.Vector3 {
    const you = this.you;
    if (you?.seat) {
      const e = eyePosition(you.seat);
      return new THREE.Vector3(e.x, e.y, e.z);
    }
    const spot = you ? this.actor(you.id)?.restSpot : null;
    if (spot) return new THREE.Vector3(spot.x, 1.58, spot.z - 0.02);
    return new THREE.Vector3(0, 1.85, BULKHEAD_Z + 0.35);
  }

  /** On the flight deck: out through the windscreen. Seated: toward the nearest window, a little ahead. Standing: up the aisle. */
  private restTarget(eye: THREE.Vector3): THREE.Vector3 {
    if (eye.z < FLIGHT_DECK.doorZ) return new THREE.Vector3(eye.x * 0.5, eye.y - 0.12, eye.z - 3);
    if (this.you?.seat) return new THREE.Vector3(Math.sign(eye.x || 1) * 3, 1.05, eye.z - 1.4);
    return new THREE.Vector3(eye.x * 0.5, eye.y - 0.1, eye.z - 4);
  }

  private snapCamera(): void {
    const eye = this.homeEye();
    this.eye.copy(eye);
    this.target.copy(this.restTarget(eye));
    this.cameraFn(0);
    this.smoothEye.copy(this.eye);
    this.smoothTarget.copy(this.target);
  }

  /** Watch from where you are: at your seat (or spot), looking at `focus` when there is one (not from behind the flight deck door). */
  private watch(lookAtWindowUntil = -1): (t: number) => void {
    const home = this.homeEye();
    const onDeck = home.z < FLIGHT_DECK.doorZ;
    return (t) => {
      this.eye.copy(home);
      const focus = t >= lookAtWindowUntil && !onDeck ? this.interest?.() : null;
      this.target.copy(focus ?? this.restTarget(home));
    };
  }

  /** Ride along in your own actor's head, looking where it is going (or at `focus`). */
  private ride(actor: Actor, look: () => THREE.Vector3 | null = () => null): (t: number) => void {
    return () => {
      actor.eyes(this.eye);
      const custom = look();
      if (custom) {
        this.target.copy(custom);
        return;
      }
      const heading = actor.root.rotation.y;
      this.target.set(this.eye.x - Math.sin(heading) * 3, this.eye.y - 0.15, this.eye.z - Math.cos(heading) * 3);
    };
  }

  /** Fade in, descend, touch down, brake; the captain welcomes everyone to the destination. */
  private planLanding(welcome: string): number {
    const ctx = this.ctx;
    this.at(0, () => {
      // Nobody goes up to the flight deck in these endings.
      ctx.setCockpitDoor(false);
      ctx.fade(1, 0.6);
      cabinAudio.setEngine(0.55, 1);
    });
    this.at(0.6, () => {
      ctx.showRunway();
      this.landingFrom = 0.4;
      ctx.fade(0, 0.7);
    });
    this.at(0.9, () => ctx.caption('Cabin crew, seats for landing.'));
    this.at(3.6, () => {
      ctx.shake(0.05);
      cabinAudio.thunk();
      cabinAudio.rumble(1.2);
      cabinAudio.setEngine(1.1, 0.4);
    });
    this.at(5.0, () => cabinAudio.setEngine(0.2, 2));
    this.at(5.8, () => {
      cabinAudio.ding();
      ctx.caption(welcome);
    });
    return 6.3;
  }

  // ---------- Arrest ----------

  private planArrest(): void {
    const ctx = this.ctx;
    const ready = this.planLanding(`Welcome to ${this.city}. Police are boarding the aircraft. Please stay in your seats.`);
    const prisoners = this.players.filter((p) => p.team === 'saboteurs' && p.status === 'restrained').slice(0, COP_LOOKS.length);
    this.cameraFn = this.watch(ready);
    const walk = 2.1;
    const escort = 1.8;
    let end = ready + 4;
    // One officer per restrained saboteur (or two to look around if there is nobody to take).
    const count = Math.max(prisoners.length, prisoners.length ? 0 : 2);
    const lead: { actor: Actor | null } = { actor: null };
    for (let i = 0; i < count; i++) {
      const prisoner = prisoners[i] ?? null;
      const pActor = prisoner ? this.actor(prisoner.id) : undefined;
      const spot = pActor?.restSpot?.clone() ?? new THREE.Vector3(0, 0, BULKHEAD_Z + 1.5 + i);
      // Aboard through the front door into the galley (short of the flight deck door).
      const start = new THREE.Vector3(i % 2 ? 0.45 : -0.45, 0, BULKHEAD_Z - 0.9 - Math.floor(i / 2) * 0.5);
      const reach = new THREE.Vector3(spot.x * 0.6, 0, spot.z - 0.6);
      const inward = start.distanceTo(AISLE_FRONT) + AISLE_FRONT.distanceTo(new THREE.Vector3(0, 0, reach.z)) + Math.abs(reach.x);
      const setOff = ready + 0.2 + i * 0.6;
      const arrive = setOff + inward / walk;
      const out = [new THREE.Vector3(0, 0, spot.z - 0.9), AISLE_FRONT.clone(), FRONT_EXIT.clone()];
      const outLength = spot.distanceTo(out[0]) + out[0].distanceTo(AISLE_FRONT) + AISLE_FRONT.distanceTo(FRONT_EXIT);
      const leave = arrive + 0.6 + i * 0.3;
      const gone = leave + outLength / escort;
      end = Math.max(end, prisoner ? gone + 0.9 : arrive + 2);
      this.at(setOff, () => {
        const cop = ctx.people.extra(`cop${i}`, COP_LOOKS[i], start);
        if (!cop) return;
        if (i === 0) {
          lead.actor = cop;
          this.interest = () => lead.actor?.eyes() ?? null;
          cabinAudio.clunk();
        }
        cop.walkAlong([AISLE_FRONT.clone(), new THREE.Vector3(0, 0, reach.z), reach], inward / walk);
      });
      if (!prisoner || !pActor) continue;
      this.at(arrive, () => {
        const cop = this.actor(`cop${i}`);
        if (cop) cop.gaze = pActor.eyes();
      });
      // The prisoner is walked up the aisle and off the plane, the officer a step behind.
      this.at(leave, () => {
        pActor.walkAlong(out, outLength / escort);
        const cop = this.actor(`cop${i}`);
        if (cop) cop.gaze = null;
        if (i === 0) this.interest = () => pActor.eyes();
        if (prisoner.id === this.you?.id) this.cameraFn = this.ride(pActor);
      });
      // The officer a step behind.
      this.at(leave + 0.5, () => this.actor(`cop${i}`)?.walkAlong(out.map((p) => p.clone().add(new THREE.Vector3(0.05, 0, 0.1))), outLength / escort));
    }
    if (count === 2 && prisoners.length === 0) this.at(ready + 3, () => ctx.caption('Nobody left for us to take. Enjoy your stay.', 'Police'));
    this.finish(end);
  }

  // ---------- Escape ----------

  private planEscape(): void {
    const ctx = this.ctx;
    const ready = this.planLanding(`Welcome to ${this.city}. Please remain seated until the seatbelt sign is off.`);
    const runners = this.players.filter((p) => p.team === 'saboteurs' && p.status === 'alive' && p.seat);
    this.cameraFn = this.watch(ready);
    const speed = 3.3;
    let last = ready;
    const youRun = runners.some((p) => p.id === this.you?.id);
    runners.forEach((p, i) => {
      const actor = this.actor(p.id);
      if (!actor || !p.seat) return;
      const seat = eyePosition(p.seat);
      const path = [new THREE.Vector3(seat.x * 0.4, 0, seat.z), new THREE.Vector3(0, 0, seat.z - 0.4), AISLE_FRONT.clone(), FRONT_EXIT.clone()];
      const length = Math.abs(seat.x) + Math.max(0.5, seat.z - AISLE_FRONT.z) + 2;
      const go = ready + 0.35 + i * 0.3;
      const seconds = length / speed + 0.3;
      last = Math.max(last, go + seconds);
      this.at(go, () => {
        actor.walkAlong(path, seconds, true);
        this.tagged.add(p.id);
        this.setTag(p.id, this.label(p));
        if (i === 0) this.interest = () => actor.eyes();
        if (p.id === this.you?.id) this.cameraFn = this.ride(actor);
      });
    });
    this.at(ready + 0.3, () => cabinAudio.chime());
    if (youRun) {
      // Out of the door, and the rest is outside.
      const me = runners.find((p) => p.id === this.you?.id)!;
      const seat = eyePosition(me.seat!);
      const out = ready + 0.35 + runners.indexOf(me) * 0.3 + (Math.abs(seat.x) + Math.max(0.5, seat.z - AISLE_FRONT.z) + 1.2) / speed;
      this.at(out, () => ctx.fade(1, 0.35));
      this.at(out + 0.4, () => {
        this.tarmac = new TarmacSet(ctx.renderer, this.game, runners.map((p) => p.id), ctx.faces);
        this.tarmac.resize(ctx.container.clientWidth, ctx.container.clientHeight);
        this.tarmacFrom = out + 0.4;
        this.tagged.clear();
        for (const p of runners) this.setTag(p.id, this.label(p));
        ctx.showSet(this.tarmac.scene, this.tarmac.camera);
        ctx.fade(0, 0.4);
      });
      this.finish(out + 0.4 + TARMAC_LENGTH);
      return;
    }
    // Still aboard when it goes off.
    const blast = last + 1.4;
    this.at(blast - 0.8, () => (this.interest = () => new THREE.Vector3(0, 1.3, BULKHEAD_Z - 0.5)));
    this.at(blast, () => {
      ctx.explode(new THREE.Vector3(0, 0.4, BULKHEAD_Z + 0.4));
      ctx.flash(1);
      ctx.shake(0.2);
      cabinAudio.boom(1);
    });
    this.at(blast + 0.35, () => ctx.fade(1, 0.35));
    this.finish(blast + 1.1);
  }

  // ---------- Hijack ----------

  private planHijack(): void {
    const ctx = this.ctx;
    // The Pilot flies from behind the flight deck door; a rogue Pilot is on their side and lets them in.
    const pilot = this.players.find((p) => !!p.role && isPilot(p.role) && p.status === 'alive' && grid.isCockpit(p.seat)) ?? null;
    const rogue = pilot?.team === 'saboteurs';
    const gunmen = this.players.filter((p) => p.team === 'saboteurs' && p.status === 'alive' && p.seat && p.id !== pilot?.id);
    const leader = gunmen[0] ?? null;
    const leaderActor = leader ? this.actor(leader.id) : undefined;
    const pilotActor = pilot ? this.actor(pilot.id) : undefined;
    const you = this.you;
    const youGunman = gunmen.some((g) => g.id === you?.id);
    const youPilot = !!pilot && you?.id === pilot.id;
    const youHostage = !!you && you.status === 'alive' && !youGunman && !youPilot && you.team !== 'saboteurs';

    this.at(0, () => {
      ctx.setLights('blackout');
      ctx.setCockpitDoor(false);
      for (let i = 0; i < 3; i++) setTimeout(() => cabinAudio.beep(0.5 + i * 0.2), i * 220);
    });
    // Up out of their seats, pistols out, into the aisle.
    gunmen.forEach((g, i) => {
      const actor = this.actor(g.id);
      if (!actor || !g.seat) return;
      const seat = eyePosition(g.seat);
      this.at(0.3 + i * 0.15, () => {
        actor.armed = true;
        actor.walkAlong([new THREE.Vector3(seat.x * 0.35, 0, seat.z - 0.2), new THREE.Vector3(0, 0, seat.z - 0.25)], 1.1);
        actor.pointAt = new THREE.Vector3(0, 1.1, seat.z - 3);
      });
    });
    if (leader) this.at(0.9, () => ctx.caption('Everybody down! Heads down! Nobody moves!', leader.name));
    this.interest = () => (leaderActor ? leaderActor.eyes() : null);
    // Everyone in the cabin braces.
    this.at(1.2, () => {
      for (const p of this.players) {
        // (Your own ducking is the camera's job: your arms would be all you could see.)
        if (p.status !== 'alive' || !p.seat || grid.isCockpit(p.seat) || gunmen.includes(p) || p.id === you?.id) continue;
        const actor = this.actor(p.id);
        if (actor) actor.duck = true;
      }
    });

    // The leader goes up to the flight deck door.
    let bank = 7.5;
    /** When the leader is through the door (from then on, the Pilot is who he watches). */
    let inside = Infinity;
    /** A rogue Pilot waiting at the door to let them in. */
    let waiting = Infinity;
    if (leaderActor && leader?.seat) {
      const from = eyePosition(leader.seat);
      const toDoor = (Math.max(0.5, from.z - AISLE_FRONT.z) + AISLE_FRONT.distanceTo(DECK_OUTSIDE)) / 1.5 + 0.4;
      const setOff = 2.6;
      const arrive = setOff + toDoor;
      this.at(setOff, () => {
        leaderActor.walkAlong([AISLE_FRONT.clone(), DECK_OUTSIDE.clone()], toDoor);
        leaderActor.pointAt = DECK_DOORWAY.clone();
      });
      if (pilot && pilotActor && !rogue) {
        // Locked out: he hammers on the door until it gives, and holds the Pilot at gunpoint.
        this.at(arrive, () => (pilotActor.gaze = DECK_DOORWAY.clone()));
        for (const at of [0.1, 0.55, 1.0]) {
          this.at(arrive + at, () => {
            cabinAudio.thud(1.2);
            ctx.shake(0.012);
          });
        }
        this.at(arrive + 0.3, () => ctx.caption('Open this door!', leader.name));
        this.at(arrive + 1.5, () => ctx.caption('This door stays shut.', captainName(pilot.name)));
        for (const at of [2.4, 2.8]) {
          this.at(arrive + at, () => {
            cabinAudio.thud(1.7);
            ctx.shake(0.02);
          });
        }
        const burst = arrive + 3.2;
        this.at(burst, () => {
          ctx.setCockpitDoor(true);
          cabinAudio.thud(2.2);
          cabinAudio.clunk();
          ctx.shake(0.05);
        });
        inside = burst + 0.2;
        this.at(inside, () => {
          // Between the seatbacks, the pistol at the Pilot's head.
          leaderActor.walkAlong([new THREE.Vector3(0, 0, FLIGHT_DECK.doorZ - 0.4), new THREE.Vector3(0.02, 0, FLIGHT_DECK.seatZ + 0.5)], 1.1);
          leaderActor.pointAt = pilotActor.eyes();
          leaderActor.gaze = pilotActor.eyes();
        });
        this.at(inside + 1.1, () => {
          // (Not your own: your arms would fill the picture.)
          if (!youPilot) pilotActor.handsUp = true;
          pilotActor.gaze = leaderActor.eyes();
          ctx.caption('Hands where I can see them. You fly where I say.', leader.name);
        });
        bank = inside + 3.2;
      } else if (pilot && pilotActor) {
        // A rogue Pilot: he gets up, opens the door for them, and goes back to fly the plane away.
        const getUp = 1.8;
        // Beside the door (it swings in on the other side), out of the leader's way.
        const byDoor = new THREE.Vector3(0.42, 0, FLIGHT_DECK.doorZ - 0.45);
        this.at(getUp, () => pilotActor.walkAlong([new THREE.Vector3(-0.1, 0, FLIGHT_DECK.seatZ + 0.45), byDoor], 1.6));
        waiting = getUp + 1.6;
        const open = Math.max(getUp + 1.7, arrive - 0.3);
        this.at(open, () => {
          ctx.setCockpitDoor(true);
          cabinAudio.clunk();
        });
        this.at(open + 0.3, () => ctx.caption('Right on schedule. Come on in.', captainName(pilot.name)));
        inside = Math.max(open, arrive) + 0.2;
        this.at(inside, () => {
          // Just inside, guarding the door.
          leaderActor.walkAlong([new THREE.Vector3(0, 0, FLIGHT_DECK.doorZ - 0.25)], 0.8);
          leaderActor.pointAt = null;
          pilotActor.gaze = leaderActor.eyes();
        });
        this.at(inside + 0.6, () => {
          pilotActor.gaze = null;
          pilotActor.standing = false;
          pilotActor.place(pilot.seat!, true);
        });
        bank = inside + 3.4;
      } else {
        // Nobody left to fly it: the door gives at the first shove and he takes the controls himself.
        this.at(arrive + 0.2, () => {
          cabinAudio.thud(1.8);
          ctx.setCockpitDoor(true);
          ctx.shake(0.03);
        });
        inside = arrive + 0.4;
        this.at(inside, () => {
          leaderActor.walkAlong([new THREE.Vector3(0, 0, FLIGHT_DECK.doorZ - 0.4), new THREE.Vector3(0, 0, FLIGHT_DECK.seatZ + 0.55)], 1.3);
          leaderActor.pointAt = null;
        });
        bank = inside + 2.2;
      }
    }
    this.at(bank, () => {
      this.bankFrom = bank;
      ctx.shake(0.03);
      cabinAudio.setEngine(1.2, 1.5);
      cabinAudio.rumble(1);
      if (leader) ctx.caption('This plane belongs to us now. Sit tight.', leader.name);
    });

    // Your eyes.
    if (you && youGunman) {
      const mine = this.actor(you.id)!;
      let now = 0;
      const ride = this.ride(mine, () => (mine === leaderActor && pilotActor && now >= inside ? pilotActor.eyes() : null));
      this.cameraFn = (t) => {
        now = t;
        ride(t);
      };
    } else if (youPilot && pilotActor && rogue) {
      // Up to let them in (watching the door, then the leader), and back to the controls.
      let now = 0;
      const ride = this.ride(pilotActor, () => (now < waiting || now >= inside + 0.6 ? null : now >= inside ? (leaderActor?.eyes() ?? DECK_DOORWAY) : DECK_DOORWAY));
      this.cameraFn = (t) => {
        now = t;
        ride(t);
      };
    } else if (youPilot && pilot) {
      // At the controls: the windscreen, then the door behind you, then the gun; back to flying once it banks.
      const home = this.homeEye();
      // Turning round in the seat, you lean out past the headrest.
      const leaning = home.clone().add(new THREE.Vector3(0.12, 0.1, 0.02));
      this.cameraFn = (t) => {
        const turned = t >= bank + 0.4 ? null : t >= inside ? leaderActor?.eyes() : t >= inside - 3.4 ? DECK_DOORWAY : null;
        this.eye.copy(turned ? leaning : home);
        this.target.copy(turned ?? this.restTarget(home));
      };
    } else if (youHostage && you.seat) {
      // Heads down behind the seat in front, then a peek over it.
      const home = this.homeEye();
      this.cameraFn = (t) => {
        const down = span(t, 1.1, 1.7) * (1 - span(t, 3.0, 3.8) * 0.75);
        this.eye.copy(home).add(new THREE.Vector3(0, -0.32 * down, -0.12 * down));
        const focus = this.interest?.() ?? this.restTarget(home);
        this.target.copy(focus).lerp(home.clone().add(new THREE.Vector3(0, -1.2, -0.5)), down);
      };
    } else {
      this.cameraFn = this.watch();
    }
    this.finish(bank + 2.8);
  }

  // ---------- Nobody left ----------

  private planGhost(): void {
    const ctx = this.ctx;
    const start = this.homeEye();
    const rows = Math.max(1, this.game.cabin.rows);
    const endZ = (rows - 1) * 0.82 + 0.6;
    this.at(0, () => {
      ctx.masksDown();
      ctx.setLights('blackout');
    });
    this.at(1.2, () => ctx.caption('Flight 13 flies on through the dark. Nobody is left to land it.', 'Flight 13'));
    this.cameraFn = (t) => {
      const k = span(t, 0, 7.5);
      const rise = span(t, 0, 1.6);
      this.eye.set(start.x * (1 - rise), start.y + (2.05 - start.y) * rise, THREE.MathUtils.lerp(start.z, endZ, k * 0.9));
      this.target.set(0, 0.9, this.eye.z + 2.5);
    };
    this.finish(8.6);
  }

  // ---------- Endings end ----------

  private finish(at: number): void {
    this.length = at + 0.9;
    this.at(at, () => this.ctx.fade(1, 0.8));
    this.at(at + 0.9, () => (this.done = true));
  }

  private setTag(id: string, text: string): void {
    let el = this.tagEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'name-tag';
      this.tags.appendChild(el);
      this.tagEls.set(id, el);
    }
    el.textContent = text;
  }

  private placeTags(heads: { id: string; at: THREE.Vector3 }[], camera: THREE.Camera): void {
    const width = this.ctx.container.clientWidth;
    const height = this.ctx.container.clientHeight;
    const shown = new Set<string>();
    for (const { id, at } of heads) {
      const el = this.tagEls.get(id);
      if (!el) continue;
      const p = at.clone().project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
      shown.add(id);
      el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.tagEls) el.hidden = !shown.has(id);
  }
}
