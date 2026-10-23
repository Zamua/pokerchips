import Matter from 'matter-js';
import type { ChipSize } from './towers.js';

const { Bodies, Engine } = Matter;

/** Bodies are this much narrower than the drawn chips: neighboring stacks are drawn edge to edge and must not rub. */
const SLIM = 6;

export const chipEngine = () => Engine.create({ enableSleeping: true, positionIterations: 12, velocityIterations: 8 });

/** A chip seen from the side: its edge band, slightly slimmed, with rounded corners. */
export const chipBody = (x: number, y: number, size: ChipSize) =>
  Bodies.rectangle(x, y, size.w - SLIM, size.th, {
    chamfer: { radius: size.th * 0.3 },
    friction: 0.3,
    frictionStatic: 0.5,
    frictionAir: 0.012,
    restitution: 0.05,
    density: 0.002,
    sleepThreshold: 30,
  });

/** Static walls whose inner faces are the given box. */
export function walls(left: number, top: number, right: number, ground: number): Matter.Body[] {
  const T = 200;
  const w = right - left;
  const h = ground - top;
  const wall = (x: number, y: number, ww: number, hh: number) => Bodies.rectangle(x, y, ww, hh, { isStatic: true, friction: 0.8, restitution: 0.1 });
  return [
    wall(left + w / 2, ground + T / 2, w + 2 * T, T),
    wall(left + w / 2, top - T / 2, w + 2 * T, T),
    wall(left - T / 2, top + h / 2, T, h + 2 * T),
    wall(right + T / 2, top + h / 2, T, h + 2 * T),
  ];
}
