import Matter from 'matter-js';
import type { ChipSize } from './towers.js';
import { type Home, kick, type Pose, restingOn, visualAngle } from './toy.js';

const { Bodies, Body, Composite, Constraint, Engine, Sleeping } = Matter;

const STEP = 1000 / 60;
/** Fast enough on release to fly rather than settle; and the cap that keeps a throw from passing through chips. */
const THROW = 4;
const MAX_SPEED = 24;
/** Bodies are this much narrower than the drawn chips: neighboring stacks are drawn edge to edge and must not rub. */
const SLIM = 6;

/** The chip toy's physics: a matter-js world of chips between the hero's edges. */
export interface ToyWorld {
  poses(): Pose[];
  advance(ms: number): void;
  /** Whether every chip has come to rest and nothing is held. */
  resting(): boolean;
  grab(index: number, x: number, y: number): void;
  drag(x: number, y: number): void;
  drop(): void;
  tap(index: number, x: number, rand: number): void;
  /** Puts every chip at rest at these poses. */
  place(poses: readonly Pose[]): void;
  destroy(): void;
}

export interface WorldShape {
  homes: readonly Home[];
  width: number;
  height: number;
  ground: number;
  size: ChipSize;
}

export function createWorld({ homes, width, height, ground, size }: WorldShape): ToyWorld {
  const engine = Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 8 });
  const T = 200;
  /** Walls stand in a little, so a tilted chip's face stays on screen. */
  const inset = size.ry + 2;
  const wall = (x: number, y: number, w: number, h: number) => Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.8, restitution: 0.1 });
  Composite.add(engine.world, [
    wall(width / 2, ground + T / 2, width + 2 * T, T),
    wall(width / 2, -T / 2, width + 2 * T, T),
    wall(inset - T / 2, height / 2, T, height + 2 * T),
    wall(width - inset + T / 2, height / 2, T, height + 2 * T),
  ]);
  const chips = homes.map((h) =>
    Bodies.rectangle(h.x, h.y, size.w - SLIM, size.th, {
      chamfer: { radius: size.th * 0.3 },
      friction: 0.3,
      frictionStatic: 0.5,
      frictionAir: 0.012,
      restitution: 0.05,
      density: 0.002,
      sleepThreshold: 30,
    }),
  );
  Composite.add(engine.world, chips);

  let hand: { index: number; ox: number; oy: number; spring: Matter.Constraint } | null = null;
  let carry = 0;
  let still = 0;

  const pose = (b: Matter.Body): Pose => ({ x: b.position.x, y: b.position.y, angle: b.angle });

  const place = (poses: readonly Pose[]) => {
    if (hand) Composite.remove(engine.world, hand.spring);
    hand = null;
    chips.forEach((b, i) => {
      Sleeping.set(b, false);
      Body.setPosition(b, { x: poses[i].x, y: poses[i].y });
      Body.setAngle(b, poses[i].angle);
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
      Sleeping.set(b, true);
    });
    still = 0;
  };

  /** Holds the carried chip about level, tipped a little toward where it is going. */
  const steady = () => {
    if (!hand) return;
    const b = chips[hand.index];
    const tilt = Math.max(-0.35, Math.min(0.35, b.velocity.x * 0.05));
    Body.setAngularVelocity(b, 0);
    Body.setAngle(b, b.angle + (tilt - visualAngle(b.angle)) * 0.3);
  };

  /** Sends the chips to sleep once they have all been still for a moment; matter-js alone can leave a pile trembling. */
  const settle = () => {
    const calm = chips.every((b) => b.isSleeping || (b.speed < 0.06 && b.angularSpeed < 0.004));
    still = calm && !hand ? still + 1 : 0;
    if (still > 45) for (const b of chips) Sleeping.set(b, true);
  };

  place(homes);

  return {
    poses: () => chips.map(pose),
    advance(ms) {
      carry = Math.min(carry + ms, STEP * 4);
      while (carry >= STEP) {
        steady();
        Engine.update(engine, STEP);
        settle();
        carry -= STEP;
      }
    },
    resting: () => !hand && chips.every((b) => b.isSleeping),
    grab(index, x, y) {
      if (hand) Composite.remove(engine.world, hand.spring);
      const b = chips[index];
      Sleeping.set(b, false);
      const ox = x - b.position.x;
      const oy = y - b.position.y;
      const spring = Constraint.create({ pointA: { x: x - ox, y: y - oy }, bodyB: b, pointB: { x: 0, y: 0 }, length: 0.01, stiffness: 0.2, damping: 0.05 });
      Composite.add(engine.world, spring);
      hand = { index, ox, oy, spring };
    },
    drag(x, y) {
      if (!hand) return;
      hand.spring.pointA = { x: x - hand.ox, y: y - hand.oy };
      Sleeping.set(chips[hand.index], false);
    },
    drop() {
      if (!hand) return;
      const { index, spring } = hand;
      Composite.remove(engine.world, spring);
      hand = null;
      const b = chips[index];
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > MAX_SPEED) Body.setVelocity(b, { x: (b.velocity.x / speed) * MAX_SPEED, y: (b.velocity.y / speed) * MAX_SPEED });
      if (speed >= THROW) return;
      Body.setAngle(b, b.angle - visualAngle(b.angle));
      Body.setAngularVelocity(b, 0);
      const under = restingOn(
        pose(b),
        chips.map((c, j) => (j === index || c.speed > 0.5 ? null : pose(c))),
        size,
      );
      if (under === null) return;
      Body.setPosition(b, { x: chips[under].position.x, y: b.position.y });
      Body.setVelocity(b, { x: 0, y: Math.max(0, b.velocity.y) });
    },
    tap(index, x, rand) {
      for (const k of kick(chips.map(pose), index, x, size, rand)) {
        const b = chips[k.index];
        Sleeping.set(b, false);
        Body.setVelocity(b, { x: k.vx, y: k.vy });
        Body.setAngularVelocity(b, k.spin);
      }
      still = 0;
    },
    place,
    destroy() {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
