import { useEffect, useState } from 'react';
import { type Result, type Seated, api } from '../net/api.js';
import { legacy } from '../store/legacy.js';
import { recent } from '../store/recent.js';
import { sentence } from '../ui/text.js';
import { Join } from './Join.js';
import { Table } from './Table.js';

type Prefill = { name: string; message: string };

/** One claim per table at a time, so a repeated effect cannot claim the seat twice and revoke the first key. */
const adopting = new Map<string, Promise<Result<Seated>>>();

function adopt(code: string, name: string): Promise<Result<Seated>> {
  let p = adopting.get(code);
  if (!p) {
    p = api.join(code, name).finally(() => adopting.delete(code));
    adopting.set(code, p);
  }
  return p;
}

/**
 * `/<code>`: the table when this device holds a seat there; a version 2
 * recent room is claimed by its name first; otherwise the join screen.
 */
export function TableRoute({ code }: { code: string }) {
  const [seatKey, setSeatKey] = useState<string | null>(() => recent.get(code)?.seatKey ?? null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [claiming, setClaiming] = useState(() => !seatKey && !!legacy.get(code)?.name);

  useEffect(() => {
    if (!claiming) return;
    const old = legacy.get(code);
    if (!old?.name) {
      setClaiming(false);
      return;
    }
    let live = true;
    void adopt(code, old.name).then((r) => {
      if (r.ok) {
        legacy.drop(code);
        recent.remember({ code, name: old.name, seatKey: r.value.seatKey, openedAt: Date.now() });
      } else if (r.code === 'not-found') {
        legacy.drop(code);
      }
      if (!live) return;
      if (r.ok) setSeatKey(r.value.seatKey);
      else setPrefill({ name: old.name, message: sentence(r.code) });
      setClaiming(false);
    });
    return () => {
      live = false;
    };
  }, [claiming, code]);

  if (claiming) {
    return (
      <main className="screen">
        <div className="wrap">
          <div className="card waiting">
            Taking your seat back
            <p>Moving you over from the old pokerchips.</p>
          </div>
        </div>
      </main>
    );
  }

  if (!seatKey) {
    return (
      <Join
        key={prefill?.message ?? 'join'}
        initialCode={code}
        initialName={prefill?.name}
        message={prefill?.message}
        onSeated={(_, key) => {
          setPrefill(null);
          setSeatKey(key);
        }}
      />
    );
  }

  return (
    <Table
      key={seatKey}
      code={code}
      seatKey={seatKey}
      onLost={(name, message) => {
        recent.forget(code);
        setPrefill({ name, message });
        setSeatKey(null);
      }}
    />
  );
}
