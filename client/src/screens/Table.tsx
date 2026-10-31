import { ArrowsClockwiseIcon, DotsThreeOutlineIcon, ExportIcon, HandCoinsIcon, PokerChipIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry } from '../../../domain/ledger.js';
import type { Command } from '../../../domain/table.js';
import { MAIN_POT, MAX_SEATS } from '../../../domain/values.js';
import { type SeatView, type TableView, isHere } from '../../../protocol/frames.js';
import { api } from '../net/api.js';
import type { Status } from '../net/tableSocket.js';
import { useTable } from '../net/useTable.js';
import { recent } from '../store/recent.js';
import { AdjustDrawer, type Reason } from '../table/AdjustDrawer.js';
import { BetDrawer } from '../table/BetDrawer.js';
import { LedgerRow } from '../table/LedgerRow.js';
import { Badges, HistorySheet, MoreSheet, PlayersSheet, PotsSheet } from '../table/Sheets.js';
import { WinDrawer } from '../table/WinDrawer.js';
import { ChipTop, Tower } from '../ui/Chip.js';
import { lengthClass } from '../ui/Drawer.js';
import { Amount, useNow } from '../ui/hooks.js';
import { flyChip } from '../ui/motion.js';
import { navigate } from '../ui/route.js';
import { othersAround } from '../ui/seats.js';
import { shareTable } from '../ui/share.js';
import { playChips } from '../ui/sound.js';
import { chips, initial, potName, sentence, showCode } from '../ui/text.js';
import { useToast } from '../ui/Toast.js';
import { seatColor } from '../ui/towers.js';

type Panel =
  | { kind: 'bet' }
  | { kind: 'win' }
  | { kind: 'more' }
  | { kind: 'players' }
  | { kind: 'pots' }
  | { kind: 'history' }
  | { kind: 'adjust'; seat: string; reason: Reason };

const FEED_SIZE = 3;

export function Table({ code, seatKey, onLost }: { code: string; seatKey: string; onLost(name: string, message: string): void }) {
  const t = useTable(code, seatKey);
  const toast = useToast();
  const now = useNow(30_000);
  const [panel, setPanel] = useState<Panel | null>(null);
  const lastPot = useRef<string>(MAIN_POT);
  const close = useCallback(() => setPanel(null), []);

  useEffect(() => {
    document.title = `${showCode(code)} - pokerchips`;
    return () => {
      document.title = 'pokerchips';
    };
  }, [code]);

  const lost = useRef(false);
  const loseSeat = useCallback(
    (message: string) => {
      if (lost.current) return;
      lost.current = true;
      toast(message, 'error');
      onLost(recent.get(code)?.name ?? '', message);
    },
    [code, onLost, toast],
  );

  useEffect(() => {
    if (t.status !== 'denied') return;
    void api.info(code).then((r) =>
      loseSeat(
        r.ok
          ? 'This seat is now held on another device. Join again to take it back.'
          : r.code === 'not-found'
            ? sentence('not-found')
            : 'This phone no longer holds a seat at this table.',
      ),
    );
  }, [t.status, code, loseSeat]);

  // A deleted table refuses the socket outright, which looks like a network failure; ask once.
  const welcomed = t.state !== null;
  useEffect(() => {
    if (welcomed || (t.status !== 'reconnecting' && t.status !== 'offline')) return;
    let live = true;
    void api.info(code).then((r) => {
      if (live && !r.ok && r.code === 'not-found') loseSeat(sentence('not-found'));
    });
    return () => {
      live = false;
    };
  }, [t.status, welcomed, code, loseSeat]);

  const run = useCallback(
    async (cmd: Command): Promise<boolean> => {
      if (t.status !== 'online') toast('Not connected right now. This goes through when you are back.', 'info');
      const a = await t.send(cmd);
      if (!a.ok) toast(sentence(a.code), 'error');
      return a.ok;
    },
    [t.status, t.send, toast],
  );

  const share = useCallback(async () => {
    const r = await shareTable(code);
    if (r === 'copied') toast('Link copied. Send it to the table.', 'ok');
    if (r === 'failed') toast(`Tell them the code: ${showCode(code)}`, 'info');
  }, [code, toast]);

  const { state, seatId } = t;
  const me = state?.seats.find((s) => s.id === seatId) ?? null;

  const canUndo = useCallback(
    (e: Entry) => !!state && e.seq === state.undoable && (e.by === seatId || state.host === seatId),
    [state, seatId],
  );

  const undo = useCallback(
    (seq: number) => {
      void run({ type: 'undo', seq });
    },
    [run],
  );

  const bet = (pot: string, amount: number) => {
    lastPot.current = pot;
    setPanel(null);
    void run({ type: 'bet', pot, amount }).then((ok) => {
      if (!ok) return;
      playChips();
      flyChip(document.querySelector('[data-you]'), document.querySelector(`[data-pot="${pot}"]`), 'tomato');
    });
  };

  const collect = (pot: string, amount?: number) => {
    lastPot.current = pot;
    setPanel(null);
    void run(amount === undefined ? { type: 'collect', pot } : { type: 'collect', pot, amount }).then((ok) => {
      if (!ok) return;
      playChips();
      flyChip(document.querySelector(`[data-pot="${pot}"]`), document.querySelector('[data-you]'), 'sun');
    });
  };

  const split = (pot: string, seats: string[]) => {
    setPanel(null);
    void run({ type: 'split', pot, seats }).then((ok) => {
      if (!ok) return;
      playChips();
      const from = document.querySelector(`[data-pot="${pot}"]`);
      for (const id of seats) {
        flyChip(from, document.querySelector(id === seatId ? '[data-you]' : `[data-seat="${id}"]`), 'sun');
      }
    });
  };

  const leave = () => {
    if (!window.confirm('Leave this table? Your seat stays, marked away, and you can take it back by joining with your name.')) return;
    recent.forget(code);
    navigate({ name: 'landing' });
  };

  const others = state && me ? othersAround(state.seats, me.id) : [];

  return (
    <>
      <main className="screen with-bar">
        <div className="wrap">
          <header className="top">
            <button className="ticket" aria-label={`Share table code ${showCode(code)}`} onClick={() => void share()}>
              <span className="cd">{showCode(code)}</span>
              <span className="sh">
                <ExportIcon size={18} weight="bold" />
              </span>
            </button>
            <Connection status={t.status} onRetry={t.retry} />
          </header>

          {state && me ? (
            <>
              <YouCard state={state} me={me} />
              <Pots state={state} />

              <div className="sech">
                <h2>At the table</h2>
                <span>
                  {state.seats.length} {state.seats.length === 1 ? 'player' : 'players'}
                </span>
              </div>
              <section className="grid">
                {others.map((s) => (
                  <SeatCard key={s.id} seat={s} state={state} me={me.id} onOpen={() => setPanel({ kind: 'players' })} />
                ))}
                {state.seats.length < MAX_SEATS && (
                  <button className="pc invite" onClick={() => void share()}>
                    <UserPlusIcon size={24} weight="bold" />
                    Invite
                  </button>
                )}
              </section>

              <div className="sech">
                <h2>Activity</h2>
                <button onClick={() => setPanel({ kind: 'history' })}>See all</button>
              </div>
              <section className="card feed" aria-label="Activity">
                {state.ledger.length === 0 ? (
                  <p className="none">Nothing yet.</p>
                ) : (
                  state.ledger
                    .slice(-FEED_SIZE)
                    .reverse()
                    .map((e) => <LedgerRow key={e.seq} e={e} me={seatId} now={now} undoable={canUndo(e)} onUndo={undo} />)
                )}
              </section>
            </>
          ) : (
            <div className="card waiting">
              Taking your seat
              <p>{t.status === 'offline' ? 'Cannot reach the table. Check your connection and retry.' : 'Connecting to the table.'}</p>
            </div>
          )}
        </div>
      </main>

      {state && me && (
        <nav className="actionbar" aria-label="Actions">
          <div className="wrap">
            <button className="act bet" onClick={() => setPanel({ kind: 'bet' })}>
              <PokerChipIcon size={22} weight="fill" />
              Bet
            </button>
            <button className="act win" onClick={() => setPanel({ kind: 'win' })}>
              <HandCoinsIcon size={22} weight="fill" />
              Win
            </button>
            <button className="act more" aria-label="More" onClick={() => setPanel({ kind: 'more' })}>
              <DotsThreeOutlineIcon size={22} weight="fill" />
            </button>
          </div>
        </nav>
      )}

      {state && me && panel?.kind === 'bet' && <BetDrawer state={state} me={me} pot={lastPot.current} onClose={close} onBet={bet} />}
      {state && me && panel?.kind === 'win' && (
        <WinDrawer state={state} me={me} pot={lastPot.current} onClose={close} onCollect={collect} onSplit={split} />
      )}
      {state && me && panel?.kind === 'adjust' && (
        <AdjustDrawer
          state={state}
          meId={me.id}
          seat={panel.seat}
          reason={panel.reason}
          onClose={close}
          onAdjust={(cmd) => {
            setPanel(null);
            void run(cmd);
          }}
        />
      )}
      {state && me && panel?.kind === 'more' && (
        <MoreSheet
          state={state}
          onClose={close}
          onAdjust={(reason) => setPanel({ kind: 'adjust', seat: me.id, reason })}
          onPlayers={() => setPanel({ kind: 'players' })}
          onPots={() => setPanel({ kind: 'pots' })}
          onHistory={() => setPanel({ kind: 'history' })}
          onShare={() => void share()}
          onLeave={leave}
        />
      )}
      {state && me && panel?.kind === 'players' && (
        <PlayersSheet
          state={state}
          me={me.id}
          now={now}
          onClose={close}
          run={run}
          onAdjust={(seat) => setPanel({ kind: 'adjust', seat, reason: 'correction' })}
        />
      )}
      {state && me && panel?.kind === 'pots' && <PotsSheet state={state} me={me.id} onClose={close} run={run} />}
      {state && me && panel?.kind === 'history' && (
        <HistorySheet state={state} me={me.id} now={now} onClose={close} history={t.history} canUndo={canUndo} onUndo={undo} />
      )}
    </>
  );
}

function Connection({ status, onRetry }: { status: Status; onRetry(): void }) {
  if (status === 'offline' || status === 'denied') {
    return (
      <button className="live off" onClick={onRetry} aria-label="Offline. Retry" data-testid="connection">
        <span className="dot" />
        Offline
        <ArrowsClockwiseIcon size={16} weight="bold" />
      </button>
    );
  }
  const label = status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <div className={`live${status === 'online' ? '' : ' wait'}`} role="status" aria-live="polite" data-testid="connection">
      <span className="dot" />
      {label}
    </div>
  );
}

function YouCard({ state, me }: { state: TableView; me: SeatView }) {
  const text = chips(me.stack);
  return (
    <section className="card you" data-you aria-label="Your stack">
      <div className="who">
        <span className="nm">{me.name}</span>
        <span className="badge b-you">YOU</span>
        {state.host === me.id && <span className="badge b-host">HOST</span>}
      </div>
      <div className={`big ${lengthClass(text, 8, 10)}`} data-testid="my-stack">
        <Amount value={me.stack} />
      </div>
      <div className="lbl">your stack</div>
      <Tower amount={me.stack} shape={{ unit: state.buyIn / 10, perStack: 9, stacks: 3 }} width={36} />
    </section>
  );
}

function Pots({ state }: { state: TableView }) {
  const n = state.pots.length;
  return (
    <section className={`pots${n === 1 ? ' one' : n > 2 ? ' many' : ''}`} aria-label="Pots">
      {state.pots.map((p) => {
        const name = potName(p.id);
        const text = chips(p.amount);
        const main = p.id === MAIN_POT;
        return (
          <div key={p.id} className={`card pot ${main ? 'main' : 'side'}${p.amount === 0 ? ' empty' : ''}`} data-pot={p.id}>
            <div className="pl">{name[0].toUpperCase() + name.slice(1)}</div>
            <div className={`pa ${lengthClass(text, main && n !== 2 ? 9 : 6, main && n !== 2 ? 11 : 8)}`} data-testid={`pot-${p.id}`}>
              <Amount value={p.amount} />
            </div>
            <Tower amount={p.amount} shape={{ unit: state.buyIn / 10, perStack: 8, stacks: main ? 2 : 1 }} width={main ? 30 : 28} />
          </div>
        );
      })}
    </section>
  );
}

function SeatCard({ seat, state, me, onOpen }: { seat: SeatView; state: TableView; me: string; onOpen(): void }) {
  const text = chips(seat.stack);
  return (
    <button className={`pc${isHere(seat) ? '' : ' away'}`} data-seat={seat.id} onClick={onOpen} aria-label={`${seat.name}${isHere(seat) ? '' : ', away'}, ${text} chips`}>
      <div className="r1">
        <ChipTop color={isHere(seat) ? seatColor(seat.id, state.seats) : 'mist'} label={initial(seat.name)} size={34} />
        <span className="bdg">
          <Badges seat={seat} state={state} me={me} />
        </span>
      </div>
      <div className="nm">{seat.name}</div>
      <div className={`st ${lengthClass(text, 7, 99)}`}>
        <Amount value={seat.stack} />
      </div>
    </button>
  );
}
