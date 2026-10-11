import { CheckIcon, HandCoinsIcon, ScalesIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { SeatView, TableView } from '../../../protocol/frames.js';
import { ChipTop } from '../ui/Chip.js';
import { type Key, splitPreview } from '../ui/amount.js';
import { Drawer, Keypad, PotPicker, QuickChips, Readout, confirmClass, press } from '../ui/Drawer.js';
import { chips, initial, potName, quickChips } from '../ui/text.js';
import { seatColor } from '../ui/towers.js';

type Mode = 'all' | 'some' | 'split';

export function WinDrawer({
  state,
  me,
  pot: initialPot,
  onClose,
  onCollect,
  onSplit,
}: {
  state: TableView;
  me: SeatView;
  pot: string;
  onClose(): void;
  onCollect(pot: string, amount?: number): void;
  onSplit(pot: string, seats: string[]): void;
}) {
  const [chosen, setPot] = useState(() => {
    const preferred = state.pots.find((p) => p.id === initialPot && p.amount > 0);
    return (preferred ?? state.pots.find((p) => p.amount > 0) ?? state.pots[0]).id;
  });
  const [mode, setMode] = useState<Mode>('all');
  const [amount, setAmount] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const onKey = useCallback((k: Key) => setAmount((a) => press(a, k)), []);

  const pot = state.pots.find((p) => p.id === chosen) ?? state.pots[0];
  const name = potName(pot.id);
  const ordered = state.seats.filter((s) => picked.includes(s.id)).map((s) => s.id);
  const share = splitPreview(pot.amount, ordered.length);

  const label =
    mode === 'split'
      ? ordered.length < 2
        ? 'Split the pot'
        : `Split between ${ordered.length}`
      : mode === 'some'
        ? `Take ${chips(amount)} from ${name}`
        : `Take all ${chips(pot.amount)}`;
  const footer =
    mode === 'split' ? (
      <button
        className={confirmClass('mint', label)}
        disabled={ordered.length < 2 || pot.amount === 0}
        onClick={() => onSplit(pot.id, ordered)}
      >
        <ScalesIcon size={22} weight="bold" />
        {label}
      </button>
    ) : mode === 'some' ? (
      <button
        className={confirmClass('mint', label)}
        disabled={amount === 0 || amount > pot.amount}
        onClick={() => onCollect(pot.id, amount)}
      >
        <HandCoinsIcon size={22} weight="fill" />
        {label}
      </button>
    ) : (
      <button className={confirmClass('mint', label)} disabled={pot.amount === 0} onClick={() => onCollect(pot.id)}>
        <HandCoinsIcon size={22} weight="fill" />
        {label}
      </button>
    );

  return (
    <Drawer title="Win" label="Win" onClose={onClose} footer={footer}>
      <PotPicker pots={state.pots} value={pot.id} onChange={setPot} disableEmpty />
      <div className="tabs" role="tablist">
        {(
          [
            ['all', 'Take all'],
            ['some', 'Some'],
            ['split', 'Split'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'all' && (
        <>
          <Readout
            amount={pot.amount}
            after={
              <div className="aft">
                Your stack after
                <b>{chips(me.stack + pot.amount)}</b>
              </div>
            }
          />
          <p className="note">
            {pot.amount === 0 ? `The ${name} is empty.` : `The whole ${name} goes to you.`}
          </p>
        </>
      )}
      {mode === 'some' && (
        <>
          <Readout
            amount={amount}
            after={
              amount > pot.amount ? (
                <div className="aft bad">
                  The pot holds
                  <b>{chips(pot.amount)}</b>
                </div>
              ) : (
                <div className="aft">
                  Your stack after
                  <b>{chips(me.stack + amount)}</b>
                </div>
              )
            }
          />
          <QuickChips
            values={quickChips(state.buyIn)}
            onAdd={(n) => onKey({ t: 'add', n })}
            end={
              <button className="allin" onClick={() => onKey({ t: 'set', n: pot.amount })}>
                All
              </button>
            }
          />
          <Keypad onKey={onKey} />
        </>
      )}
      {mode === 'split' && (
        <>
          <div className="picks" role="group" aria-label="Split between">
            {state.seats.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  className={`pick${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                >
                  <ChipTop color={s.here ? seatColor(s.id, state.seats) : 'mist'} label={initial(s.name)} size={30} />
                  <span>{s.id === me.id ? `${s.name} (you)` : s.name}</span>
                  <span className="tick" aria-hidden="true" style={{ flex: 'none' }}>
                    {on && <CheckIcon size={14} weight="bold" />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="note">
            {ordered.length < 2 ? (
              'Pick two or more players.'
            ) : (
              <>
                Each gets <b>{chips(share.each)}</b>
                {share.extra > 0 && `, and ${share.extra} odd ${share.extra === 1 ? 'chip goes' : 'chips go'} to the first ${share.extra === 1 ? 'player' : `${share.extra} players`} in table order`}.
              </>
            )}
          </p>
        </>
      )}
    </Drawer>
  );
}
