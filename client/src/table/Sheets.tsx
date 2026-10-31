import {
  ArrowCircleDownIcon,
  ArrowCircleUpIcon,
  BroomIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  CrownSimpleIcon,
  ExportIcon,
  MoonIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  SignOutIcon,
  StackIcon,
  UserMinusIcon,
  UsersIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { Entry } from '../../../domain/ledger.js';
import type { Command } from '../../../domain/table.js';
import { hostClaimable } from '../../../domain/table.js';
import { LEDGER_TAIL, MAIN_POT, MAX_SIDE_POTS } from '../../../domain/values.js';
import { type SeatView, type TableView, isHere } from '../../../protocol/frames.js';
import { ChipTop } from '../ui/Chip.js';
import { Drawer } from '../ui/Drawer.js';
import { ago, chips, initial, potName } from '../ui/text.js';
import { useToast } from '../ui/Toast.js';
import { seatColor } from '../ui/towers.js';
import type { Reason } from './AdjustDrawer.js';
import { LedgerRow } from './LedgerRow.js';

type Run = (cmd: Command) => Promise<boolean>;

export function Badges({ seat, state, me }: { seat: SeatView; state: TableView; me: string }) {
  return (
    <>
      {seat.id === me && <span className="badge b-you">YOU</span>}
      {seat.id === state.host && (
        <span className="badge b-host">
          <CrownSimpleIcon size={11} weight="fill" />
          HOST
        </span>
      )}
      {!isHere(seat) && (
        <span className="badge b-away">
          <MoonIcon size={11} weight="bold" />
          AWAY
        </span>
      )}
    </>
  );
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

const awayFor = (since: number, now: number) => {
  const a = ago(since, now);
  return a === 'now' ? 'Just left' : `Away for ${a}`;
};

export function MoreSheet({
  state,
  onClose,
  onAdjust,
  onPlayers,
  onPots,
  onHistory,
  onShare,
  onLeave,
}: {
  state: TableView;
  onClose(): void;
  onAdjust(reason: Reason): void;
  onPlayers(): void;
  onPots(): void;
  onHistory(): void;
  onShare(): void;
  onLeave(): void;
}) {
  const sides = state.pots.length - 1;
  return (
    <Drawer title="More" label="More" onClose={onClose}>
      <div className="tiles">
        <button className="tile sun" onClick={() => onAdjust('rebuy')}>
          <ArrowCircleUpIcon size={26} weight="bold" />
          Rebuy
        </button>
        <button className="tile sky" onClick={() => onAdjust('cashout')}>
          <ArrowCircleDownIcon size={26} weight="bold" />
          Cash out
        </button>
        <button className="tile lilac" onClick={() => onAdjust('correction')}>
          <PencilSimpleIcon size={26} weight="bold" />
          Correction
        </button>
      </div>
      <div className="rows">
        <button className="rowbtn" onClick={onPlayers}>
          <UsersIcon size={22} weight="bold" />
          <span>Players</span>
          <small>{state.seats.length}</small>
          <CaretRightIcon size={18} weight="bold" />
        </button>
        <button className="rowbtn" onClick={onPots}>
          <StackIcon size={22} weight="bold" />
          <span>Pots</span>
          <small>{sides === 0 ? 'Main only' : `Main and ${sides} side`}</small>
          <CaretRightIcon size={18} weight="bold" />
        </button>
        <button className="rowbtn" onClick={onHistory}>
          <ClockCounterClockwiseIcon size={22} weight="bold" />
          <span>History</span>
          <CaretRightIcon size={18} weight="bold" />
        </button>
        <button className="rowbtn" onClick={onShare}>
          <ExportIcon size={22} weight="bold" />
          <span>Share table</span>
        </button>
        <button className="rowbtn danger" onClick={onLeave}>
          <SignOutIcon size={22} weight="bold" />
          <span>Leave table</span>
        </button>
      </div>
    </Drawer>
  );
}

export function PlayersSheet({
  state,
  me,
  now,
  onClose,
  run,
  onAdjust,
}: {
  state: TableView;
  me: string;
  now: number;
  onClose(): void;
  run: Run;
  onAdjust(seat: string): void;
}) {
  const isHost = state.host === me;
  const host = state.seats.find((s) => s.id === state.host);
  const claimable = !isHost && hostClaimable(state, now);

  return (
    <Drawer title="Players" sub={`${state.seats.length} at the table`} label="Players" onClose={onClose}>
      {claimable && (
        <div className="banner">
          <span>{host && host.awaySince !== null ? `${host.name}, the host, has been away for ${ago(host.awaySince, now)}.` : 'The table has no host.'}</span>
          <button className="mini" onClick={() => void run({ type: 'claimHost' })}>
            <CrownSimpleIcon size={15} weight="fill" />
            Claim host
          </button>
        </div>
      )}
      <div className="plist">
        {state.seats.map((s) => (
          <div className="prow" key={s.id} data-player={s.name}>
            <div className="top1">
              <ChipTop color={isHere(s) ? seatColor(s.id, state.seats) : 'mist'} label={initial(s.name)} size={36} />
              <div className="who">
                <div className="nm">
                  <span>{s.name}</span>
                  <Badges seat={s} state={state} me={me} />
                </div>
                <div className="sub">{s.awaySince === null ? 'Here' : awayFor(s.awaySince, now)}</div>
              </div>
              <div className="st">{chips(s.stack)}</div>
            </div>
            {isHost && s.id !== me && (
              <div className="acts">
                <button
                  className="mini"
                  onClick={() => {
                    if (window.confirm(`Make ${s.name} the host?`)) void run({ type: 'handOver', seat: s.id });
                  }}
                >
                  <CrownSimpleIcon size={15} weight="fill" />
                  Make host
                </button>
                <button className="mini" onClick={() => onAdjust(s.id)}>
                  <PencilSimpleIcon size={15} weight="bold" />
                  Adjust
                </button>
                {!isHere(s) && (
                  <button
                    className="mini danger"
                    onClick={() => {
                      const cash = s.stack > 0 ? ` Their ${chips(s.stack)} chips are cashed out.` : '';
                      if (window.confirm(`Remove ${s.name} from the table?${cash}`)) void run({ type: 'remove', seat: s.id });
                    }}
                  >
                    <UserMinusIcon size={15} weight="bold" />
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}

export function PotsSheet({ state, me, onClose, run }: { state: TableView; me: string; onClose(): void; run: Run }) {
  const isHost = state.host === me;
  const sides = state.pots.length - 1;
  const total = state.pots.reduce((n, p) => n + p.amount, 0);
  return (
    <Drawer title="Pots" sub={`${chips(total)} in the middle`} label="Pots" onClose={onClose}>
      <div className="plist">
        {state.pots.map((p) => (
          <div className="potrow" key={p.id} data-pot-row={p.id}>
            <span className="pn">{capital(potName(p.id))}</span>
            <span className="pv">{chips(p.amount)}</span>
            {isHost && p.id !== MAIN_POT && (
              <button
                className="mini"
                aria-label={`Close ${potName(p.id)}`}
                onClick={() => {
                  const ok =
                    p.amount === 0 ||
                    window.confirm(`Close ${potName(p.id)}? Its ${chips(p.amount)} chips move to the main pot.`);
                  if (ok) void run({ type: 'closePot', pot: p.id });
                }}
              >
                <XCircleIcon size={15} weight="bold" />
                Close
              </button>
            )}
          </div>
        ))}
      </div>
      {isHost ? (
        <div className="stackbtns">
          <button
            className="btn sun block"
            disabled={sides >= MAX_SIDE_POTS}
            onClick={() => void run({ type: 'openPot' })}
          >
            <PlusCircleIcon size={20} weight="bold" />
            Open a side pot
          </button>
          <button
            className="btn paper block"
            disabled={total === 0}
            onClick={() => {
              if (window.confirm(`Clear every pot? ${chips(total)} chips leave play.`)) void run({ type: 'clear' });
            }}
          >
            <BroomIcon size={20} weight="bold" />
            Clear all pots
          </button>
        </div>
      ) : (
        <p className="note">Only the host can open, close or clear pots.</p>
      )}
    </Drawer>
  );
}

export function HistorySheet({
  state,
  me,
  now,
  onClose,
  history,
  canUndo,
  onUndo,
}: {
  state: TableView;
  me: string;
  now: number;
  onClose(): void;
  history(before: number): Promise<Entry[] | null>;
  canUndo(e: Entry): boolean;
  onUndo(seq: number): void;
}) {
  const toast = useToast();
  // Every entry seen while open, so entries that scroll out of the live tail stay listed.
  const seen = useRef(new Map<number, Entry>());
  for (const e of state.ledger) seen.current.set(e.seq, e);
  const [, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const entries = [...seen.current.values()].sort((a, b) => b.seq - a.seq);
  const oldest = entries.at(-1)?.seq ?? 1;
  const atStart = oldest <= 1 || exhausted;

  const loadEarlier = async () => {
    setLoading(true);
    const page = await history(oldest);
    setLoading(false);
    if (!page) {
      toast('Could not load earlier moves. Try again.', 'error');
      return;
    }
    for (const e of page) seen.current.set(e.seq, e);
    if (page.length < LEDGER_TAIL) setExhausted(true);
    setPages((n) => n + 1);
  };

  return (
    <Drawer title="History" sub={`${state.seq} ${state.seq === 1 ? 'move' : 'moves'} at this table`} label="History" onClose={onClose}>
      <div className="history">
        {entries.map((e) => (
          <LedgerRow key={e.seq} e={e} me={me} now={now} undoable={canUndo(e)} onUndo={onUndo} />
        ))}
        {atStart ? (
          <p className="end">That is where the table started.</p>
        ) : (
          <button className="more-btn" disabled={loading} onClick={() => void loadEarlier()}>
            {loading ? 'Loading' : 'Load earlier moves'}
          </button>
        )}
      </div>
    </Drawer>
  );
}
