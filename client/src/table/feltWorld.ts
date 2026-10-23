import Matter from 'matter-js';
import { chipBody, chipEngine, walls } from '../ui/chipBodies.js';
import type { ChipSize } from '../ui/towers.js';
import type { Pose } from '../ui/toy.js';

const { Body, Composite, Engine, Sleeping } = Matter;

const STEP = 1000 / 60;
const MAX_SPEED = 18;

/** The felt's physics: chips that went in, keyed by chip id, piling up between the felt's edges. */
export interface FeltWorld {
  add(id: number, pose: Pose, vx: number, vy: number, spin: number): void;
  /** Takes a chip out and says where it was. */
  remove(id: number): Pose | null;
  pose(id: number): Pose | null;
  advance(ms: number): void;
  resting(): boolean;
  destroy(): void;
}

export interface FeltShape {
  left: number;
  top: number;
  right: number;
  ground: number;
  size: ChipSize;
}

export function createFelt({ left, top, right, ground, size }: FeltShape): FeltWorld {
  const engine = chipEngine();
  Composite.add(engine.world, walls(left, top, right, ground));
  const chips = new Map<number, Matter.Body>();
  let carry = 0;
  let still = 0;

  /** Puts the pile to sleep once it has been still for a moment; matter-js alone can leave it trembling. */
  const settle = () => {
    const calm = [...chips.values()].every((b) => b.isSleeping || (b.speed < 0.06 && b.angularSpeed < 0.004));
    still = calm ? still + 1 : 0;
    if (still > 45) for (const b of chips.values()) Sleeping.set(b, true);
  };

  return {
    add(id, pose, vx, vy, spin) {
      const b = chipBody(Math.min(right - size.w / 2, Math.max(left + size.w / 2, pose.x)), Math.max(top + size.th, pose.y), size);
      Body.setAngle(b, pose.angle);
      const speed = Math.hypot(vx, vy);
      const k = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
      Body.setVelocity(b, { x: vx * k, y: vy * k });
      Body.setAngularVelocity(b, spin);
      Composite.add(engine.world, b);
      chips.set(id, b);
      for (const c of chips.values()) Sleeping.set(c, false);
      still = 0;
    },
    remove(id) {
      const b = chips.get(id);
      if (!b) return null;
      Composite.remove(engine.world, b);
      chips.delete(id);
      for (const c of chips.values()) Sleeping.set(c, false);
      still = 0;
      return { x: b.position.x, y: b.position.y, angle: b.angle };
    },
    pose(id) {
      const b = chips.get(id);
      return b ? { x: b.position.x, y: b.position.y, angle: b.angle } : null;
    },
    advance(ms) {
      carry = Math.min(carry + ms, STEP * 4);
      while (carry >= STEP) {
        Engine.update(engine, STEP);
        settle();
        carry -= STEP;
      }
    },
    resting: () => [...chips.values()].every((b) => b.isSleeping),
    destroy() {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
