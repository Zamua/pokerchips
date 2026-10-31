import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { ChipSide } from './Chip.js';
import { reducedMotion } from './motion.js';
import { playChips } from './sound.js';
import { chipAt, disturbed, drawOrder, type Home, homes, homeward, type Pose, visualAngle } from './toy.js';
import type { ToyWorld, WorldShape } from './toyWorld.js';
import { type ChipColor, chipSize } from './towers.js';

const SVG = 'http://www.w3.org/2000/svg';
/** The bottom chips' front rims sit this far above the toy's bottom edge. */
const FLOOR = 9;
/** On Restack each chip hops home in HOP_MS, the higher and further right ones a little later. */
const HOP_MS = 420;
const LEVEL_MS = 24;
const STACK_MS = 8;
/** A press that moves further than this is a drag, not a tap. */
const SLOP = 8;

interface Press {
  id: number;
  chip: number;
  x: number;
  y: number;
  dragging: boolean;
}

export interface ChipToyHandle {
  /** Hops every chip back to where it started. */
  restack(): void;
}

interface Props {
  stacks: ChipColor[][];
  width: number;
  /** Told whether the chips are away from where they started. */
  onMessy: (messy: boolean) => void;
  ref?: Ref<ChipToyHandle>;
}

/**
 * Chip stacks to play with, filling the positioned parent: tap to topple,
 * drag to move, restack to put them back. The physics loads after first
 * paint, and not at all under reduced motion.
 */
export function ChipToy({ stacks, width, onMessy, ref }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<SVGGElement>(null);
  const restack = useRef(() => {});
  const colors = [...new Set(stacks.flat())];
  useImperativeHandle(ref, () => ({ restack: () => restack.current() }), []);

  useEffect(() => {
    const el = box.current!;
    const g = layer.current!;
    const size = chipSize(width);
    let shape: WorldShape | null = null;
    let home: Home[] = [];
    let poses: Pose[] = [];
    let nodes: SVGUseElement[] = [];
    let order: number[] = [];
    let build: ((s: WorldShape) => ToyWorld) | null = null;
    let world: ToyWorld | null = null;
    let raf = 0;
    let last = 0;
    let held = -1;
    let isMessy = false;
    let hop: { from: Pose[]; start: number } | null = null;
    let press: Press | null = null;

    const mess = (v: boolean) => {
      if (v === isMessy) return;
      isMessy = v;
      onMessy(v);
    };

    const draw = () => {
      nodes.forEach((n, i) => {
        const p = poses[i];
        n.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${((visualAngle(p.angle) * 180) / Math.PI).toFixed(2)})`);
      });
      const next = drawOrder(poses, held);
      if (next.some((v, k) => v !== order[k])) {
        for (const i of next) g.appendChild(nodes[i]);
        order = next;
      }
    };

    const layout = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (shape && shape.width === w && shape.height === h) return;
      const ground = h - FLOOR - size.ry;
      home = homes(stacks, w, ground, size);
      shape = { homes: home, width: w, height: h, ground, size };
      poses = home.map(({ x, y, angle }) => ({ x, y, angle }));
      nodes = home.map((c) => {
        const u = document.createElementNS(SVG, 'use');
        u.setAttribute('href', `#toy-chip-${c.color}`);
        u.dataset.chip = `${c.stack}.${c.level}`;
        return u;
      });
      g.replaceChildren(...nodes);
      order = nodes.map((_, i) => i);
      held = -1;
      press = null;
      hop = null;
      world?.destroy();
      world = build ? build(shape) : null;
      mess(false);
      draw();
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(50, now - last);
      last = now;
      const h0 = hop;
      if (h0) {
        let done = true;
        poses = home.map((h, i) => {
          const t = (now - h0.start - h.level * LEVEL_MS - h.stack * STACK_MS) / HOP_MS;
          if (t < 1) done = false;
          return homeward(h0.from[i], h, t);
        });
        if (done) {
          hop = null;
          poses = home.map(({ x, y, angle }) => ({ x, y, angle }));
          world?.place(poses);
          playChips();
        }
      } else if (world) {
        world.advance(dt);
        poses = world.poses();
        if (!isMessy && disturbed(poses, home)) mess(true);
      }
      draw();
      if (hop || held >= 0 || (world && !world.resting())) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const at = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const down = (e: PointerEvent) => {
      if (!world || hop || press || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const p = at(e);
      const chip = chipAt(poses, p.x, p.y, size);
      if (chip < 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      press = { id: e.pointerId, chip, x: p.x, y: p.y, dragging: false };
    };

    const move = (e: PointerEvent) => {
      const p = at(e);
      if (!press) {
        if (world && !hop && e.pointerType === 'mouse') el.style.cursor = chipAt(poses, p.x, p.y, size) >= 0 ? 'grab' : '';
        return;
      }
      if (e.pointerId !== press.id || !world) return;
      if (!press.dragging) {
        if (Math.hypot(p.x - press.x, p.y - press.y) < SLOP) return;
        press.dragging = true;
        held = press.chip;
        world.grab(press.chip, press.x, press.y);
        el.style.cursor = 'grabbing';
      }
      world.drag(p.x, p.y);
      wake();
    };

    const up = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id || !world) return;
      if (press.dragging) world.drop();
      else if (e.type === 'pointerup') {
        world.tap(press.chip, press.x, Math.random());
        playChips();
      }
      press = null;
      held = -1;
      el.style.cursor = '';
      wake();
    };

    /** A touch that lands on a chip is the toy's, not a scroll (nor a long-press loupe). */
    const touch = (e: TouchEvent) => {
      if (!world || hop || e.touches.length !== 1) return;
      const p = at(e.touches[0]);
      if (chipAt(poses, p.x, p.y, size) >= 0) e.preventDefault();
    };

    restack.current = () => {
      if (!world || hop) return;
      if (press?.dragging) world.drop();
      press = null;
      held = -1;
      hop = { from: poses.map((p) => ({ ...p })), start: performance.now() };
      mess(false);
      wake();
    };

    layout();
    const resize = new ResizeObserver(layout);
    resize.observe(el);

    let live = true;
    if (!reducedMotion()) {
      import('./toyWorld.js')
        .then((m) => {
          if (!live) return;
          build = m.createWorld;
          if (shape) world = build(shape);
          el.dataset.toy = 'ready';
        })
        .catch(() => {});
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('touchstart', touch, { passive: false });
    }

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      resize.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('touchstart', touch);
      world?.destroy();
      g.replaceChildren();
      delete el.dataset.toy;
    };
  }, [stacks, width, onMessy]);

  return (
    <div className="toy" ref={box} aria-hidden="true" data-testid="toy">
        <svg>
          <defs>
            {colors.map((c) => (
              <g key={c} id={`toy-chip-${c}`}>
                <ChipSide color={c} width={width} />
              </g>
            ))}
          </defs>
          <g ref={layer} />
        </svg>
    </div>
  );
}
