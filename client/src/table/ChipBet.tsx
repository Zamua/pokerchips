import { ArrowCounterClockwiseIcon, ArrowUUpLeftIcon, HashIcon, PokerChipIcon } from '@phosphor-icons/react';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { BetMode } from '../store/profile.js';
import type { Key } from '../ui/amount.js';
import { ChipSide, Stack } from '../ui/Chip.js';
import { compact, Keypad, lengthClass, press } from '../ui/Drawer.js';
import { reducedMotion } from '../ui/motion.js';
import { playChips, playNope } from '../ui/sound.js';
import { chips, DENOMINATIONS } from '../ui/text.js';
import { chipColor, chipSize } from '../ui/towers.js';
import { type Bet, type BetAction, FELT_CAP, stacksOf } from './betChips.js';
import { FeltScene, type Origin, type Point } from './feltScene.js';

/** The drawn width of a chip on the felt and in the tray. */
const W = 44;
/** A press that moves further than this is a drag, not a tap. */
const SLOP = 8;
/** A chip let go below the felt still goes in when flicked up faster than this, in pixels per frame. */
const FLICK = 4;
/** The most chips a tray stack draws; its count says how many it holds. */
const TALL = 10;

interface Grip {
  id: number;
  value: number;
  x: number;
  y: number;
  dragging: boolean;
}

interface Props {
  stack: number;
  pot: string;
  bet: Bet;
  dispatch(a: BetAction): void;
  mode: BetMode;
  onMode(mode: BetMode): void;
}

/**
 * A bet made with chips: the felt shows the chips in and their total, the
 * tray holds the chips to put in, and the keypad stands in for the tray.
 */
export function ChipBet({ stack, pot, bet: b, dispatch, mode, onMode }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const felt = useRef<HTMLDivElement>(null);
  const layer = useRef<SVGGElement>(null);
  const stacks = useRef(new Map<number, HTMLElement>());
  const scene = useRef<FeltScene | null>(null);
  const origins = useRef(new Map<number, Origin[]>());
  const grip = useRef<Grip | null>(null);
  const dragged = useRef(false);
  const [held, setHeld] = useState<number | null>(null);
  const size = chipSize(W);
  const over = b.amount > stack;
  /** Every tray stack keeps the height of a full one, so the drawer never changes size as chips go in. */
  const stackHeight = (n: number) => Math.ceil(Math.min(n, TALL) * size.th + 2 * size.ry + 6);
  const trayHeight = stackHeight(TALL);
  const text = chips(b.amount);

  useEffect(() => {
    const el = box.current!;
    const rel = (r: DOMRect) => {
      const o = el.getBoundingClientRect();
      return { left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top };
    };
    const geo = {
      felt: () => rel(felt.current!.getBoundingClientRect()),
      source(value: number): Point {
        const s = stacks.current.get(value);
        if (s) {
          const r = rel(s.getBoundingClientRect());
          return { x: (r.left + r.right) / 2, y: r.top + 3 + size.ry + size.th / 2 };
        }
        const f = geo.felt();
        return { x: f.left + (f.right - f.left) * 0.2, y: f.bottom + 40 };
      },
    };
    const motion = !reducedMotion();
    const sc = new FeltScene(layer.current!, geo, size, motion);
    scene.current = sc;
    let live = true;
    if (motion)
      import('./feltWorld.js')
        .then((m) => live && sc.setWorld(m.createFelt))
        .catch(() => {});
    // A finger dragging a chip moves the chip, not the drawer.
    const hold = (e: TouchEvent) => {
      if (grip.current) e.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    let width = 0;
    const resize = new ResizeObserver(() => {
      const w = felt.current!.clientWidth;
      if (w !== width) sc.rebuild();
      width = w;
    });
    resize.observe(felt.current!);
    return () => {
      live = false;
      el.removeEventListener('touchmove', hold);
      resize.disconnect();
      sc.destroy();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    const queued = origins.current;
    const take = new Map<number, Origin>();
    for (const c of b.thrown) {
      const o = queued.get(c.value)?.shift();
      if (o) take.set(c.id, o);
    }
    queued.clear();
    scene.current?.sync(b.thrown.slice(0, FELT_CAP), take);
  }, [b.thrown]);

  const put = (value: number, from?: Origin) => {
    if (from) origins.current.set(value, [...(origins.current.get(value) ?? []), from]);
    dispatch({ t: 'throw', value });
    playChips();
  };

  const at = (e: { clientX: number; clientY: number }): Point => {
    const o = box.current!.getBoundingClientRect();
    return { x: e.clientX - o.left, y: e.clientY - o.top };
  };

  const down = (value: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragged.current = false;
    grip.current = { id: e.pointerId, value, ...at(e), dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    const sc = scene.current;
    if (!g || g.id !== e.pointerId || !sc) return;
    const p = at(e);
    if (!g.dragging) {
      if (Math.hypot(p.x - g.x, p.y - g.y) < SLOP) return;
      g.dragging = true;
      setHeld(g.value);
      sc.hold(g.value, p, e.timeStamp);
    }
    sc.drag(p, e.timeStamp);
  };

  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = grip.current;
    const sc = scene.current;
    if (!g || g.id !== e.pointerId || !sc) return;
    grip.current = null;
    if (!g.dragging) return;
    dragged.current = true;
    setHeld(null);
    const r = sc.letGo();
    if (!r) return;
    if (e.type === 'pointerup' && sc.overFelt(r)) put(g.value, r);
    else if (e.type === 'pointerup' && r.v.y < -FLICK) put(g.value, { x: r.x, y: r.y });
    else sc.back(g.value, r);
  };

  /** A tap that cannot put anything in says so: a refusal sound and a shake. */
  const nope = (el: HTMLElement) => {
    playNope();
    if (!reducedMotion()) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], 220);
  };

  const tap = (value: number, el: HTMLElement) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (!b.tray[value]) nope(el);
    else put(value);
  };

  const onKey = useCallback((k: Key) => dispatch({ t: 'set', amount: press(b.amount, k) }), [b.amount, dispatch]);

  return (
    <div className="cb" ref={box}>
      <div className="felt" ref={felt}>
        <div className="tot">
          <div className={`n ${lengthClass(text, 6, 9)}${b.amount === 0 ? ' zero' : ''}`} data-testid="readout">
            {text}
          </div>
          <div className="s">into the {pot}</div>
        </div>
        <div className={`aft${over ? ' bad' : ''}`}>
          {over ? 'You only have' : 'Your stack after'}
          <b>{chips(over ? stack : stack - b.amount)}</b>
        </div>
        <div className="line" />
        {b.amount === 0 && mode === 'chips' && <div className="hint">Tap a stack or flick a chip in</div>}
      </div>
      <div className="cb-tools">
        {mode === 'chips' && (
          <button className="mini" disabled={b.thrown.length === 0} onClick={() => dispatch({ t: 'undo' })}>
            <ArrowUUpLeftIcon size={15} weight="bold" />
            Undo
          </button>
        )}
        <button className="mini" disabled={b.amount === 0} onClick={() => dispatch({ t: 'reset' })}>
          <ArrowCounterClockwiseIcon size={15} weight="bold" />
          Reset
        </button>
        <div className="cb-mode" role="radiogroup" aria-label="Bet with">
          <button role="radio" aria-checked={mode === 'chips'} onClick={() => onMode('chips')}>
            <PokerChipIcon size={15} weight="bold" />
            Chips
          </button>
          <button role="radio" aria-checked={mode === 'type'} onClick={() => onMode('type')}>
            <HashIcon size={15} weight="bold" />
            Type
          </button>
        </div>
      </div>
      {mode === 'chips' ? (
        <div className="tray">
          {stacksOf(b).map((v) => {
            const count = b.tray[v] ?? 0;
            const n = count - (held === v ? 1 : 0);
            return (
              <button
                key={v}
                className="tray-stack"
                data-drag
                aria-disabled={count === 0}
                aria-label={`Put in a ${chips(v)} chip, ${count} left`}
                onPointerDown={count === 0 ? undefined : down(v)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onClick={(e) => tap(v, e.currentTarget)}
              >
                <span
                  className="tray-chips"
                  style={{ height: trayHeight }}
                  ref={(el) => {
                    if (el) stacks.current.set(v, el);
                    else stacks.current.delete(v);
                  }}
                >
                  {n > 0 ? <Stack colors={Array(Math.min(n, TALL)).fill(chipColor(v))} width={W} /> : <span className="tray-empty" />}
                  {n > 0 && (
                    <span className="tray-count" style={{ bottom: stackHeight(n) - 8 }}>
                      ×{n}
                    </span>
                  )}
                </span>
                <span className="tray-tag">{compact(v)}</span>
              </button>
            );
          })}
          <button
            className="allin"
            onClick={(e) => {
              if (b.amount >= stack) return nope(e.currentTarget);
              dispatch({ t: 'set', amount: stack });
              playChips();
            }}
          >
            All-in
          </button>
        </div>
      ) : (
        <Keypad onKey={onKey} />
      )}
      <svg className="cb-layer" aria-hidden="true">
        <defs>
          {[...new Set(DENOMINATIONS.map(chipColor))].map((c) => (
            <g key={c} id={`bet-chip-${c}`}>
              <ChipSide color={c} width={W} />
            </g>
          ))}
        </defs>
        <g ref={layer} />
      </svg>
    </div>
  );
}
