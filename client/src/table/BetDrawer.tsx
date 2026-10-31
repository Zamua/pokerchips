import { PokerChipIcon } from '@phosphor-icons/react';
import { useEffect, useReducer, useState } from 'react';
import { MAIN_POT } from '../../../domain/values.js';
import type { SeatView, TableView } from '../../../protocol/frames.js';
import { type BetMode, profile } from '../store/profile.js';
import { Drawer, PotPicker, confirmClass } from '../ui/Drawer.js';
import { chips, potName, quickChips } from '../ui/text.js';
import { ChipBet } from './ChipBet.js';
import { bet, startBet } from './betChips.js';

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
  const [b, dispatch] = useReducer(bet, null, () => startBet(me.stack, quickChips(state.buyIn)));
  useEffect(() => dispatch({ t: 'restart', stack: me.stack }), [me.stack]);
  const [mode, setMode] = useState<BetMode>(profile.betMode);
  const pot = state.pots.some((p) => p.id === chosen) ? chosen : MAIN_POT;
  const over = b.amount > me.stack;
  const label = `Bet ${chips(b.amount)} into ${potName(pot)}`;

  return (
    <Drawer
      title="Bet"
      label="Bet"
      onClose={onClose}
      footer={
        <button className={confirmClass('tomato', label)} disabled={b.amount === 0 || over} onClick={() => onBet(pot, b.amount)}>
          <PokerChipIcon size={22} weight="fill" />
          {label}
        </button>
      }
    >
      <PotPicker pots={state.pots} value={pot} onChange={setPot} />
      <ChipBet
        stack={me.stack}
        pot={potName(pot)}
        bet={b}
        dispatch={dispatch}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          profile.rememberBetMode(m);
        }}
      />
    </Drawer>
  );
}
