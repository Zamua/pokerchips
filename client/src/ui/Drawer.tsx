import { BackspaceIcon, CheckCircleIcon, XIcon } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer" role="dialog" aria-modal="true" aria-label={label}>
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
          <div className="body">{children}</div>
          {footer}
        </div>
      </section>
    </>
  );
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

const compact = (n: number) => (n >= 1_000 && n % 1_000 === 0 ? `${n / 1_000}K` : String(n));

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
