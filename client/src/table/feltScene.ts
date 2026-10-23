import { chipColor, type ChipSize } from '../ui/towers.js';
import { drawOrder, type Pose, visualAngle } from '../ui/toy.js';
import { pile, type Thrown } from './betChips.js';
import type { FeltShape, FeltWorld } from './feltWorld.js';

const SVG = 'http://www.w3.org/2000/svg';
/** How long a chip takes to fly in from the tray, and back to it. */
const IN_MS = 320;
const BACK_MS = 260;
/** The felt's top band holds the total; chips stay below it. */
const HEADROOM = 66;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a chip going in starts; `v`, in pixels per frame, marks one let go over the felt that keeps its speed. */
export interface Origin extends Point {
  v?: Point;
}

/** Positions in the scene's own coordinates, read when needed since the drawer can scroll and reflow. */
export interface Geometry {
  felt(): Box;
  /** Where a chip of this value comes from and goes back to: its tray stack, or below the felt. */
  source(value: number): Point;
}

interface Flight {
  from: Pose;
  to: Pose;
  lift: number;
  start: number;
  ms: number;
  turn: number;
}

interface Chip {
  value: number;
  node: SVGUseElement;
  flight: Flight | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function along(f: Flight, now: number): { pose: Pose; done: boolean } {
  const t = clamp((now - f.start) / f.ms, 0, 1);
  return {
    pose: {
      x: f.from.x + (f.to.x - f.from.x) * t,
      y: f.from.y + (f.to.y - f.from.y) * t - Math.sin(Math.PI * t) * f.lift,
      angle: f.from.angle + f.turn * t,
    },
    done: t >= 1,
  };
}

/**
 * The chips of a bet, drawn into an SVG layer that spans the felt and the
 * tray: flights between them, the felt's physics once loaded, and neat
 * stacks without it.
 */
export class FeltScene {
  private chips = new Map<number, Chip>();
  private order: number[] = [];
  private leaving: { node: SVGUseElement; flight: Flight }[] = [];
  private held: { node: SVGUseElement; x: number; y: number; vx: number; vy: number; at: number } | null = null;
  private world: FeltWorld | null = null;
  private make: ((s: FeltShape) => FeltWorld) | null = null;
  private raf = 0;
  private last = 0;
  private rand = Math.random;

  constructor(
    private layer: SVGGElement,
    private geo: Geometry,
    private size: ChipSize,
    private motion: boolean,
  ) {}

  private shape(): FeltShape {
    const f = this.geo.felt();
    const inset = this.size.ry + 2;
    return { left: f.left + inset, right: f.right - inset, top: f.top + HEADROOM, ground: f.bottom - 8 - this.size.ry, size: this.size };
  }

  /** Hands the chips to physics, where they tumble from where they sit. */
  setWorld(make: (s: FeltShape) => FeltWorld): void {
    if (!this.motion) return;
    this.make = make;
    this.rebuild();
  }

  /** Builds the physics again for the felt's current size, the chips restacked. */
  rebuild(): void {
    if (!this.make) return;
    this.world?.destroy();
    this.world = this.make(this.shape());
    const still = this.stillPoses();
    for (const [id, c] of this.chips) if (!c.flight) this.world.add(id, still.get(id)!, 0, 0, 0);
    this.wake();
  }

  /** Makes the drawn chips match the bet: new ones fly in from their origin, gone ones fly back. */
  sync(thrown: readonly Thrown[], origins: ReadonlyMap<number, Origin>): void {
    const ids = new Set(thrown.map((c) => c.id));
    const now = performance.now();
    for (const [id, c] of this.chips) {
      if (ids.has(id)) continue;
      const from = this.poseOf(id, c, now);
      this.chips.delete(id);
      this.world?.remove(id);
      if (!this.motion) c.node.remove();
      else this.leaving.push({ node: c.node, flight: { from, to: { ...this.geo.source(c.value), angle: 0 }, lift: 40, start: now, ms: BACK_MS, turn: -visualAngle(from.angle) } });
    }
    for (const c of thrown) if (!this.chips.has(c.id)) this.enter(c, origins.get(c.id), now);
    this.order = thrown.map((c) => c.id);
    this.wake();
  }

  private node(value: number): SVGUseElement {
    const u = document.createElementNS(SVG, 'use');
    u.setAttribute('href', `#bet-chip-${chipColor(value)}`);
    this.layer.appendChild(u);
    return u;
  }

  private enter(c: Thrown, origin: Origin | undefined, now: number): void {
    const chip: Chip = { value: c.value, node: this.node(c.value), flight: null };
    this.chips.set(c.id, chip);
    if (!this.motion) return;
    const o: Origin = origin ?? this.geo.source(c.value);
    const s = this.shape();
    if (o.v && this.world) {
      this.world.add(c.id, { x: o.x, y: o.y, angle: 0 }, o.v.x, o.v.y, o.v.x * 0.02);
      return;
    }
    const half = this.size.w / 2;
    const to = { x: clamp(o.x + (this.rand() - 0.5) * 60, s.left + half, s.right - half), y: s.top + 10 + this.rand() * 24, angle: 0 };
    chip.flight = { from: { x: o.x, y: o.y, angle: 0 }, to, lift: 46, start: now, ms: IN_MS, turn: (this.rand() < 0.5 ? -1 : 1) * Math.PI * (1 + this.rand()) };
  }

  private stillPoses(): Map<number, Pose> {
    const f = this.geo.felt();
    const ids = this.order.filter((id) => this.chips.has(id));
    const at = pile(
      ids.map((id) => this.chips.get(id)!.value),
      (f.left + f.right) / 2,
      this.shape().ground,
      this.size,
    );
    return new Map(ids.map((id, i) => [id, { ...at[i], angle: 0 }]));
  }

  private poseOf(id: number, c: Chip, now: number, still?: Map<number, Pose>): Pose {
    if (c.flight) return along(c.flight, now).pose;
    const p = this.world?.pose(id);
    if (p) return p;
    return (still ?? this.stillPoses()).get(id) ?? { x: 0, y: 0, angle: 0 };
  }

  /** Picks up a chip of this value at a point, held under the pointer. */
  hold(value: number, p: Point, at: number): void {
    this.held?.node.remove();
    this.held = { node: this.node(value), x: p.x, y: p.y, vx: 0, vy: 0, at };
    this.wake();
  }

  drag(p: Point, at: number): void {
    const h = this.held;
    if (!h) return;
    const dt = Math.max(1, at - h.at);
    const k = 0.5;
    h.vx = h.vx * (1 - k) + ((p.x - h.x) / dt) * (1000 / 60) * k;
    h.vy = h.vy * (1 - k) + ((p.y - h.y) / dt) * (1000 / 60) * k;
    h.x = p.x;
    h.y = p.y;
    h.at = at;
    this.wake();
  }

  /** Lets go of the held chip: where it was, and its speed in pixels per frame. */
  letGo(): (Point & { v: Point }) | null {
    const h = this.held;
    if (!h) return null;
    h.node.remove();
    this.held = null;
    return { x: h.x, y: h.y, v: { x: h.vx, y: h.vy } };
  }

  /** Whether a point is over the felt, where a chip let go goes in. */
  overFelt(p: Point): boolean {
    const f = this.geo.felt();
    return p.x >= f.left && p.x <= f.right && p.y >= f.top && p.y <= f.bottom;
  }

  /** Sends a chip that never went in back to its stack. */
  back(value: number, p: Point): void {
    const now = performance.now();
    this.leaving.push({ node: this.node(value), flight: { from: { ...p, angle: 0 }, to: { ...this.geo.source(value), angle: 0 }, lift: 20, start: now, ms: BACK_MS, turn: 0 } });
    this.wake();
  }

  private wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.world?.advance(dt);

    for (const [id, c] of this.chips) {
      const f = c.flight;
      if (!f) continue;
      const { pose, done } = along(f, now);
      if (!done) continue;
      c.flight = null;
      this.world?.add(id, pose, ((f.to.x - f.from.x) / f.ms) * 5, 2.5, (this.rand() - 0.5) * 0.2);
    }

    const still = this.stillPoses();
    const ids = [...this.chips.keys()];
    const poses = ids.map((id) => this.poseOf(id, this.chips.get(id)!, now, still));
    for (const k of drawOrder(poses, -1)) {
      const c = this.chips.get(ids[k])!;
      place(c.node, poses[k]);
      this.layer.appendChild(c.node);
    }
    this.leaving = this.leaving.filter(({ node, flight }) => {
      const { pose, done } = along(flight, now);
      place(node, pose);
      node.style.opacity = String(clamp(1.6 - 1.6 * ((now - flight.start) / flight.ms), 0, 1));
      this.layer.appendChild(node);
      if (done) node.remove();
      return !done;
    });
    if (this.held) {
      const h = this.held;
      place(h.node, { x: h.x, y: h.y, angle: clamp(h.vx * 0.04, -0.4, 0.4) });
      this.layer.appendChild(h.node);
    }

    const flying = [...this.chips.values()].some((c) => c.flight);
    if (flying || this.leaving.length || this.held || (this.world && !this.world.resting())) this.raf = requestAnimationFrame(this.frame);
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.world?.destroy();
    this.layer.replaceChildren();
    this.chips.clear();
    this.leaving = [];
    this.held = null;
  }
}

function place(node: SVGUseElement, p: Pose): void {
  node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${((visualAngle(p.angle) * 180) / Math.PI).toFixed(2)})`);
}
