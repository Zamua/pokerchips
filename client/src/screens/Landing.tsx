import { CaretRightIcon, HashIcon, PlusCircleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { type RecentItem, legacy, mergeRecent } from '../store/legacy.js';
import { recent } from '../store/recent.js';
import { ChipTop, Stack } from '../ui/Chip.js';
import { navigate, normalizeCode } from '../ui/route.js';
import { chips, initial, sentence, showCode, when } from '../ui/text.js';
import { useToast } from '../ui/Toast.js';
import { seatColor } from '../ui/towers.js';
import type { ChipColor } from '../ui/towers.js';

const HERO: { colors: ChipColor[]; tilt?: boolean }[] = [
  { colors: ['tomato', 'paper', 'sun', 'tomato'] },
  { colors: ['ink', 'tomato', 'mint', 'tomato', 'paper', 'tomato', 'mint'] },
  { colors: ['lilac', 'ink', 'mint', 'mint', 'tomato', 'sun', 'tomato', 'paper', 'tomato', 'mint'] },
  { colors: ['mint', 'ink', 'tomato', 'paper', 'tomato'] },
  { colors: ['tomato', 'sun', 'ink'] },
];

export function Landing() {
  const toast = useToast();
  const [code, setCode] = useState('');
  const items = useMemo(() => mergeRecent(recent.list(), legacy.list()), []);
  const now = Date.now();

  const join = () => {
    const c = normalizeCode(code);
    if (!c) {
      toast(sentence('bad-code'), 'error');
      return;
    }
    navigate({ name: 'table', code: c });
  };

  return (
    <main className="screen">
      <div className="wrap">
        <div className="l-top">
          <ChipTop color="tomato" label="" size={30} />
          pokerchips
        </div>
        <div className="l-hero">
          <h1>
            <span>No chips?</span>
            <span className="y">No problem.</span>
          </h1>
          <p className="sub">Track every bet, pot and payout at your home game, from everyone's phone.</p>
          <div className="l-art" aria-hidden="true">
            {HERO.map((s, i) => (
              <Stack key={i} colors={s.colors} width={54} />
            ))}
          </div>
        </div>
        <div className="l-body">
          <button className="btn sun block" onClick={() => navigate({ name: 'open' })}>
            <PlusCircleIcon size={22} weight="bold" />
            Create a game
          </button>
          <form
            className="joinrow"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <label className="field">
              <HashIcon size={20} weight="bold" />
              <span className="sr-only">Game code</span>
              <input
                className="code"
                value={code}
                onChange={(e) => setCode(e.target.value.slice(0, 12))}
                placeholder="Enter game code"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
            </label>
            <button type="submit" className="btn tomato" onMouseDown={(e) => e.preventDefault()}>
              Join
            </button>
          </form>
          <div className="sech" style={{ margin: '24px 2px 10px' }}>
            <h2>Recent games</h2>
          </div>
          {items.length === 0 ? (
            <p className="empty-note">Tables you play at show up here, so you can get back to your seat in one tap.</p>
          ) : (
            <div className="rgs">
              {items.map((item) => (
                <RecentRow key={`${item.kind}:${item.table.code}`} item={item} now={now} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function RecentRow({ item, now }: { item: RecentItem; now: number }) {
  const open = () => navigate({ name: 'table', code: item.table.code });
  if (item.kind === 'legacy') {
    const t = item.table;
    return (
      <button className="card rg" onClick={open}>
        <ChipTop color="mist" label={t.name ? initial(t.name) : '?'} size={34} />
        <div className="m">
          <div className="t">{t.name ? `Back to your seat as ${t.name}` : 'An earlier game'}</div>
          <div className="s">
            <span className="c">{showCode(t.code)}</span> {t.openedAt ? when(t.openedAt, now) : 'from before'}
          </div>
        </div>
        <CaretRightIcon className="car" size={20} weight="bold" />
      </button>
    );
  }
  const t = item.table;
  const mine = t.hostName !== undefined && t.hostName.toLowerCase() === t.name.toLowerCase();
  const title = t.hostName === undefined ? `Table ${showCode(t.code)}` : mine ? 'Your table' : `${t.hostName}'s table`;
  const delta = t.stack !== undefined && t.buyIn !== undefined ? t.stack - t.buyIn : null;
  return (
    <button className="card rg" onClick={open}>
      <ChipTop color={mine ? 'sun' : seatColor(t.code)} label={initial(t.hostName ?? t.name)} size={34} />
      <div className="m">
        <div className="t">{title}</div>
        <div className="s">
          <span className="c">{showCode(t.code)}</span> {when(t.openedAt, now)}
          {t.players ? `, ${t.players} ${t.players === 1 ? 'player' : 'players'}` : ''}
        </div>
      </div>
      {t.stack !== undefined ? (
        <div className="r">
          <div className="v">{chips(t.stack)}</div>
          {delta !== null && (
            <span className={`delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
              {delta === 0 ? 'even' : `${delta > 0 ? '+' : '−'}${chips(Math.abs(delta))}`}
            </span>
          )}
        </div>
      ) : (
        <CaretRightIcon className="car" size={20} weight="bold" />
      )}
    </button>
  );
}
