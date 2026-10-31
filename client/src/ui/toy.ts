import { type ChipColor, type ChipSize, stackJitter } from './towers.js';

/**
 * The landing page's chip toy, the pure part: where chips rest, what a tap
 * does, where a dropped chip settles. Positions are the centers of chips'
 * edge bands in pixels, y down; velocities are pixels per 60 fps frame.
 */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export interface Home extends Pose {
  color: ChipColor;
  stack: number;
  level: number;
}

export interface Kick {
  index: number;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * Where each chip of a row of stacks rests: each stack shaped as a static
 * stack draws it, the row centered across `width` a chip apart, the bottom
 * chips' edges on `ground`.
 */
export function homes(stacks: readonly (readonly ChipColor[])[], width: number, ground: number, size: ChipSize): Home[] {
  const first = (width - (stacks.length - 1) * size.w) / 2;
  return stacks.flatMap((colors, stack) =>
    colors.map((color, level) => ({
      color,
      stack,
      level,
      x: first + stack * size.w + stackJitter(level),
      y: ground - (level + 0.5) * size.th,
      angle: 0,
    })),
  );
}

/** The angle a chip is drawn at: a chip looks the same flipped over, so within a quarter turn of level. */
export const visualAngle = (a: number) => a - Math.PI * Math.round(a / Math.PI);

/** The chip resting directly on `below`, if any. */
function above(poses: readonly Pose[], below: Pose, taken: readonly number[], size: ChipSize): number {
  let best = -1;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    if (taken.includes(i) || Math.abs(p.x - below.x) > size.w * 0.7) continue;
    if (p.y >= below.y - size.th * 0.3 || p.y < below.y - size.th * 1.8) continue;
    if (best < 0 || p.y > poses[best].y) best = i;
  }
  return best;
}

/**
 * What a tap does: a chip with chips on it tips its column over like a
 * domino, pivoting on its bottom edge, away from the side that was tapped
 * unless a stack as tall stands there; a chip alone hops and flips. `rand` in
 * [0, 1) picks a side for a tap dead center.
 */
export function kick(poses: readonly Pose[], index: number, tapX: number, size: ChipSize, rand: number): Kick[] {
  const tapped = poses[index];
  const column = [index];
  for (let next = above(poses, tapped, column, size); next >= 0; next = above(poses, poses[next], column, size)) column.push(next);
  const top = poses[column[column.length - 1]];
  const walled = (d: number) =>
    poses.some((p, i) => {
      const dx = (p.x - tapped.x) * d;
      return !column.includes(i) && dx > size.w * 0.4 && dx < size.w * 1.3 && p.y <= top.y + size.th * 0.5;
    });
  const off = tapX - tapped.x;
  let dir = Math.abs(off) < size.w * 0.08 ? (rand < 0.5 ? -1 : 1) : off < 0 ? 1 : -1;
  if (walled(dir) && !walled(-dir)) dir = -dir;
  if (column.length === 1) return [{ index, vx: dir * 1.5, vy: -(5 + rand * 2), spin: dir * 0.25 }];
  // A squat column needs more turn to get its weight over the pivot.
  const spin = dir * (0.05 + 2.2 / (tapped.y - top.y + size.th + 10));
  const px = tapped.x + (dir * size.w) / 2;
  const py = tapped.y + size.th / 2;
  return column.map((i) => ({ index: i, vx: -spin * (poses[i].y - py), vy: spin * (poses[i].x - px), spin }));
}

/**
 * The chip a chip let go at `drop` comes down on: the highest level chip
 * under it. `null` entries are chips that cannot be landed on, such as ones
 * still moving.
 */
export function restingOn(drop: Pose, others: readonly (Pose | null)[], size: ChipSize): number | null {
  let best: number | null = null;
  others.forEach((p, i) => {
    if (!p || p.y <= drop.y + size.th * 0.5 || Math.abs(p.x - drop.x) > size.w * 0.55) return;
    if (Math.abs(visualAngle(p.angle)) > 0.2) return;
    if (best === null || p.y < others[best]!.y) best = i;
  });
  return best;
}

/** Whether any chip has left its home. */
export const disturbed = (poses: readonly Pose[], home: readonly Pose[]) =>
  poses.some((p, i) => Math.abs(p.x - home[i].x) > 3 || Math.abs(p.y - home[i].y) > 3 || Math.abs(visualAngle(p.angle)) > 0.12);

/** Paint order: lower chips first, the right one over the left at the same height, the held chip last. */
export function drawOrder(poses: readonly Pose[], held: number): number[] {
  const order = poses.map((_, i) => i).filter((i) => i !== held);
  order.sort((a, b) => poses[b].y - poses[a].y || poses[a].x - poses[b].x || a - b);
  if (held >= 0) order.push(held);
  return order;
}

/** Whether a point falls on a chip's drawing: its face, edge band and front rim. */
function covers(p: Pose, x: number, y: number, size: ChipSize): boolean {
  const a = visualAngle(p.angle);
  const dx = x - p.x;
  const dy = y - p.y;
  const lx = dx * Math.cos(a) + dy * Math.sin(a);
  const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  if (Math.abs(lx) > size.w / 2) return false;
  const e = size.ry * Math.sqrt(Math.max(0, 1 - ((2 * lx) / size.w) ** 2));
  return ly >= -size.th / 2 - e && ly <= size.th / 2 + e;
}

/** The chip painted on top at a point, or -1. */
export function chipAt(poses: readonly Pose[], x: number, y: number, size: ChipSize): number {
  const order = drawOrder(poses, -1);
  for (let k = order.length - 1; k >= 0; k--) if (covers(poses[order[k]], x, y, size)) return order[k];
  return -1;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A chip's pose `t` (0 to 1) of the way home, hopping on an arc and leveling out. */
export function homeward(from: Pose, to: Pose, t: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  const k = easeOut(u);
  const lift = Math.min(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.3);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k - Math.sin(Math.PI * u) * lift,
    angle: visualAngle(from.angle) * (1 - k),
  };
}
