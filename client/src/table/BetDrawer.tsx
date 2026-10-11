import { PokerChipIcon } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { SeatView, TableView } from '../../../protocol/frames.js';
import type { Key } from '../ui/amount.js';
import { Drawer, Keypad, PotPicker, QuickChips, Readout, confirmClass, press } from '../ui/Drawer.js';
import { chips, potName, quickChips } from '../ui/text.js';

export function BetDrawer({
  state,
  me,
  pot: initialPot,
  onClose,
  onBet,
}: {
  state: TableView;
  me: SeatView;
  pot: string;
  onClose(): void;
  onBet(pot: string, amount: number): void;
}) {
  const [chosen, setPot] = useState(initialPot);
  const [amount, setAmount] = useState(0);
  const onKey = useCallback((k: Key) => setAmount((a) => press(a, k)), []);
  const pot = state.pots.some((p) => p.id === chosen) ? chosen : 'main';
  const over = amount > me.stack;
  const label = `Bet ${chips(amount)} into ${potName(pot)}`;

  return (
    <Drawer
      title="Bet"
      label="Bet"
      onClose={onClose}
      footer={
        <button className={confirmClass('tomato', label)} disabled={amount === 0 || over} onClick={() => onBet(pot, amount)}>
          <PokerChipIcon size={22} weight="fill" />
          {label}
        </button>
      }
    >
      <PotPicker pots={state.pots} value={pot} onChange={setPot} />
      <Readout
        amount={amount}
        after={
          over ? (
            <div className="aft bad">
              You only have
              <b>{chips(me.stack)}</b>
            </div>
          ) : (
            <div className="aft">
              Your stack after
              <b>{chips(me.stack - amount)}</b>
            </div>
          )
        }
      />
      <QuickChips
        values={quickChips(state.buyIn)}
        onAdd={(n) => onKey({ t: 'add', n })}
        end={
          <button className="allin" onClick={() => onKey({ t: 'set', n: me.stack })}>
            All-in
          </button>
        }
      />
      <Keypad onKey={onKey} />
    </Drawer>
  );
}
