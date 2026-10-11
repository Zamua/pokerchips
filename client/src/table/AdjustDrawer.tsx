import { CheckCircleIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { Command } from '../../../domain/table.js';
import type { TableView } from '../../../protocol/frames.js';
import { type Key, type Reason, deltaFor } from '../ui/amount.js';

export type { Reason };
import { Drawer, Keypad, QuickChips, Readout, confirmClass, press } from '../ui/Drawer.js';
import { chips, quickChips } from '../ui/text.js';


const TITLES: Record<Reason, string> = { rebuy: 'Rebuy', cashout: 'Cash out', correction: 'Correction' };

/** Rebuy, cash out or correct a stack: your own, or as the host anyone's. */
export function AdjustDrawer({
  state,
  meId,
  seat,
  reason: initialReason,
  onClose,
  onAdjust,
}: {
  state: TableView;
  meId: string;
  seat: string;
  reason: Reason;
  onClose(): void;
  onAdjust(cmd: Command): void;
}) {
  const [reason, setReason] = useState<Reason>(initialReason);
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(0);
  const onKey = useCallback((k: Key) => setAmount((a) => press(a, k)), []);
  const target = state.seats.find((s) => s.id === seat);
  if (!target) return null;

  const mine = target.id === meId;
  const whose = mine ? 'your' : `${target.name}'s`;
  const delta = deltaFor(reason, amount, sign);
  const after = target.stack + delta;
  const short = after < 0;
  const label =
    reason === 'rebuy'
      ? `Add ${chips(amount)} to ${whose} stack`
      : reason === 'cashout'
        ? `Cash out ${chips(amount)}`
        : `Correct by ${sign > 0 ? '+' : '−'}${chips(amount)}`;

  return (
    <Drawer
      title={TITLES[reason]}
      sub={`${mine ? 'Your' : `${target.name}'s`} stack is ${chips(target.stack)}`}
      label={TITLES[reason]}
      onClose={onClose}
      footer={
        <button
          className={confirmClass('sun', label)}
          disabled={amount === 0 || short}
          onClick={() => onAdjust({ type: 'adjust', delta, reason, ...(mine ? {} : { seat: target.id }) })}
        >
          <CheckCircleIcon size={22} weight="fill" />
          {label}
        </button>
      }
    >
      <div className="tabs" role="tablist">
        {(Object.keys(TITLES) as Reason[]).map((r) => (
          <button key={r} role="tab" aria-selected={reason === r} className={reason === r ? 'on' : undefined} onClick={() => setReason(r)}>
            {TITLES[r]}
          </button>
        ))}
      </div>
      {reason === 'correction' && (
        <div className="sign" role="radiogroup" aria-label="Direction">
          <button role="radio" aria-checked={sign > 0} className={sign > 0 ? 'on' : undefined} onClick={() => setSign(1)}>
            <PlusIcon size={16} weight="bold" />
            Add chips
          </button>
          <button role="radio" aria-checked={sign < 0} className={sign < 0 ? 'on' : undefined} onClick={() => setSign(-1)}>
            <MinusIcon size={16} weight="bold" />
            Take chips away
          </button>
        </div>
      )}
      <Readout
        amount={amount}
        after={
          short ? (
            <div className="aft bad">
              The stack holds
              <b>{chips(target.stack)}</b>
            </div>
          ) : (
            <div className="aft">
              Stack after
              <b>{chips(after)}</b>
            </div>
          )
        }
      />
      <QuickChips
        values={quickChips(state.buyIn)}
        onAdd={(n) => onKey({ t: 'add', n })}
        end={
          reason === 'cashout' ? (
            <button className="allin" onClick={() => onKey({ t: 'set', n: target.stack })}>
              All
            </button>
          ) : reason === 'rebuy' ? (
            <button className="allin" onClick={() => onKey({ t: 'set', n: state.buyIn })}>
              Buy-in
            </button>
          ) : undefined
        }
      />
      <Keypad onKey={onKey} />
    </Drawer>
  );
}
