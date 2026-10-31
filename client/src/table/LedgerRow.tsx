import {
  ArrowCircleDownIcon,
  ArrowCircleUpIcon,
  ArrowUUpLeftIcon,
  BroomIcon,
  ClockCounterClockwiseIcon,
  CrownSimpleIcon,
  PencilSimpleIcon,
  PokerChipIcon,
  SignInIcon,
  StackIcon,
  TrophyIcon,
  UserMinusIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import type { Entry, EntryKind } from '../../../domain/ledger.js';
import { ago, describe, emphasize } from '../ui/text.js';

function Icon({ e }: { e: Entry }) {
  const s = 15;
  switch (e.kind) {
    case 'bet':
      return <span className="ic bet"><PokerChipIcon size={s} weight="fill" /></span>;
    case 'collect':
    case 'split':
      return <span className="ic win"><TrophyIcon size={s} weight="fill" /></span>;
    case 'adjust':
      return (
        <span className="ic adjust">
          {e.reason === 'buyin' ? (
            <SignInIcon size={s} weight="bold" />
          ) : e.reason === 'rebuy' ? (
            <ArrowCircleUpIcon size={s} weight="bold" />
          ) : e.reason === 'cashout' ? (
            <ArrowCircleDownIcon size={s} weight="bold" />
          ) : (
            <PencilSimpleIcon size={s} weight="bold" />
          )}
        </span>
      );
    case 'clear':
      return <span className="ic"><BroomIcon size={s} weight="bold" /></span>;
    case 'undo':
      return <span className="ic"><ArrowUUpLeftIcon size={s} weight="bold" /></span>;
    case 'openPot':
    case 'closePot':
      return <span className="ic"><StackIcon size={s} weight="bold" /></span>;
    case 'handOver':
      return <span className="ic host"><CrownSimpleIcon size={s} weight="fill" /></span>;
    case 'note':
      return (
        <span className="ic">
          {e.note === 'removed' ? (
            <UserMinusIcon size={s} weight="bold" />
          ) : e.note === 'imported' ? (
            <ClockCounterClockwiseIcon size={s} weight="bold" />
          ) : e.note === 'claimed' ? (
            <SignInIcon size={s} weight="bold" />
          ) : (
            <UserPlusIcon size={s} weight="bold" />
          )}
        </span>
      );
  }
}

const QUIET: ReadonlySet<EntryKind> = new Set(['note', 'openPot', 'closePot', 'handOver', 'undo']);

/** One ledger entry: what happened, and Undo where it would work, else how long ago. */
export function LedgerRow({ e, me, now, undoable, onUndo }: { e: Entry; me: string | null; now: number; undoable: boolean; onUndo(seq: number): void }) {
  const line = describe(e, me);
  return (
    <div className={`ev${QUIET.has(e.kind) ? ' quiet' : ''}`} data-seq={e.seq}>
      <Icon e={e} />
      <span className="t">
        {emphasize(line, e.byName).map((seg, i) =>
          seg.kind === 'name' ? <b key={i}>{seg.text}</b> : seg.kind === 'num' ? <span key={i} className="n">{seg.text}</span> : seg.text,
        )}
      </span>
      {undoable ? (
        <button className="mini" onClick={() => onUndo(e.seq)}>
          <ArrowUUpLeftIcon size={15} weight="bold" />
          Undo
        </button>
      ) : (
        <span className="tm">{ago(e.at, now)}</span>
      )}
    </div>
  );
}
