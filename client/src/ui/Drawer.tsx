import { BackspaceIcon, CheckCircleIcon, XIcon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { ChipTop } from './Chip.js';
import { type Key, press } from './amount.js';
import { chips, potName } from './text.js';
import { chipColor } from './towers.js';

/** A sheet anchored to the bottom edge, over a scrim that closes it. */
export function Drawer({
  title,
  sub,
  onClose,
  children,
  footer,
  label,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
}) {
  const sheet = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);
  useEffect(() => swipeToClose(sheet.current!, body.current!, () => closing.current()), []);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer" ref={sheet} role="dialog" aria-modal="true" aria-label={label}>
        <div className="wrap">
          <div className="grab" />
          <div className="dh">
            <h3>
              {title}
              {sub && <small>{sub}</small>}
            </h3>
            <button className="xbtn" aria-label="Close" onClick={onClose}>
              <XIcon size={18} weight="bold" />
            </button>
          </div>
          <div className="body" ref={body}>
            {children}
          </div>
          {footer}
        </div>
      </section>
    </>
  );
}

/** How far down, as a share of the sheet's height, or how fast, in px per ms, a pull must go to close. */
const PULL_SHARE = 0.25;
const PULL_SPEED = 0.6;

/**
 * Lets a downward swipe anywhere on a sheet pull it closed, once its content
 * is scrolled to the top. Touches that start on a `[data-drag]` element are
 * theirs. Returns the cleanup.
 */
function swipeToClose(sheet: HTMLElement, body: HTMLElement, onClose: () => void): () => void {
  let from: { x: number; y: number } | null = null;
  let pulling = false;
  let last = { y: 0, t: 0 };
  let speed = 0;

  const begin = (e: TouchEvent) => {
    const t = e.touches[0];
    from = e.touches.length === 1 && !(e.target as Element).closest('[data-drag]') ? { x: t.clientX, y: t.clientY } : null;
    pulling = false;
  };
  const move = (e: TouchEvent) => {
    if (!from) return;
    const t = e.touches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (!pulling) {
      if (Math.hypot(dx, dy) < 8) return;
      if (dy <= Math.abs(dx) || body.scrollTop > 0) {
        from = null;
        return;
      }
      pulling = true;
      from = { x: t.clientX, y: t.clientY };
      last = { y: t.clientY, t: e.timeStamp };
      sheet.style.transition = 'none';
    }
    e.preventDefault();
    speed = (t.clientY - last.y) / Math.max(1, e.timeStamp - last.t);
    last = { y: t.clientY, t: e.timeStamp };
    sheet.style.transform = `translateY(${Math.max(0, t.clientY - from.y)}px)`;
  };
  const end = () => {
    if (!from || !pulling) return;
    const pulled = last.y - from.y;
    from = null;
    pulling = false;
    if (pulled > sheet.offsetHeight * PULL_SHARE || speed > PULL_SPEED) {
      sheet.style.transition = 'transform 160ms ease-in';
      sheet.style.transform = 'translateY(100%)';
      setTimeout(onClose, 150);
    } else {
      sheet.style.transition = 'transform 180ms ease-out';
      sheet.style.transform = '';
    }
  };

  sheet.addEventListener('touchstart', begin, { passive: true });
  sheet.addEventListener('touchmove', move, { passive: false });
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
  return () => {
    sheet.removeEventListener('touchstart', begin);
    sheet.removeEventListener('touchmove', move);
    sheet.removeEventListener('touchend', end);
    sheet.removeEventListener('touchcancel', end);
  };
}

/** Choose a pot; each shows its amount. */
export function PotPicker({
  pots,
  value,
  onChange,
  disableEmpty = false,
}: {
  pots: { id: string; amount: number }[];
  value: string;
  onChange(id: string): void;
  disableEmpty?: boolean;
}) {
  return (
    <div className={`seg${pots.length > 2 ? ' scroll' : ''}`} role="radiogroup" aria-label="Pot">
      {pots.map((p) => {
        const on = p.id === value;
        const name = potName(p.id);
        return (
          <button
            key={p.id}
            className={on ? 'on' : undefined}
            role="radio"
            aria-checked={on}
            disabled={disableEmpty && p.amount === 0 && !on}
            onClick={() => onChange(p.id)}
          >
            <div className="sl">
              {on && <CheckCircleIcon size={15} weight="fill" />}
              {name[0].toUpperCase() + name.slice(1)}
            </div>
            <div className="sa">{chips(p.amount)}</div>
          </button>
        );
      })}
    </div>
  );
}

/** The confirm button's class: smaller type when its label is long. */
export const confirmClass = (tone: string, label: string) => `btn ${tone} confirm${label.length > 22 ? ' tight' : ''}`;

/** Size class for a long number, so it stays on one line. */
export function lengthClass(text: string, long: number, longer: number): string {
  return text.length >= longer ? 'longer' : text.length >= long ? 'long' : '';
}

export function Readout({ amount, after }: { amount: number; after: ReactNode }) {
  const text = chips(amount);
  return (
    <div className="read">
      <div className={`amt ${lengthClass(text, 6, 9)}${amount === 0 ? ' zero' : ''}`} data-testid="readout">
        {text}
      </div>
      {after}
    </div>
  );
}

export const compact = (n: number) => (n >= 1_000 && n % 1_000 === 0 ? `${n / 1_000}K` : String(n));

/** Quick chips that add their value, and one wide button at the end (All-in, All, Buy-in). */
export function QuickChips({ values, onAdd, end }: { values: number[]; onAdd(n: number): void; end?: ReactNode }) {
  return (
    <div className="quick">
      {values.map((v) => (
        <button key={v} className="qc" aria-label={`Add ${chips(v)}`} onClick={() => onAdd(v)}>
          <ChipTop color={chipColor(v)} label={`+${compact(v)}`} size={56} />
        </button>
      ))}
      {end}
    </div>
  );
}

/** Digits without the system keyboard; a hardware keyboard works too. */
export function Keypad({ onKey }: { onKey(key: Key): void }) {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) onKey({ t: 'digit', d: Number(e.key) });
      else if (e.key === 'Backspace') onKey({ t: 'back' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [onKey]);
  return (
    <div className="keys">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button key={d} onClick={() => onKey({ t: 'digit', d })}>
          {d}
        </button>
      ))}
      <button className="fn" onClick={() => onKey({ t: 'clear' })}>
        Clear
      </button>
      <button onClick={() => onKey({ t: 'digit', d: 0 })}>0</button>
      <button className="fn" aria-label="Delete" onClick={() => onKey({ t: 'back' })}>
        <BackspaceIcon size={26} weight="bold" />
      </button>
    </div>
  );
}

export { press };
