import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry } from '../../../domain/ledger.js';
import type { Command } from '../../../domain/table.js';
import type { TableView } from '../../../protocol/frames.js';
import { recent } from '../store/recent.js';
import { api } from './api.js';
import type { Status } from './link.js';
import { type Answer, TableSocket } from './tableSocket.js';

export interface TableConnection {
  state: TableView | null;
  seatId: string | null;
  status: Status;
  send(cmd: Command): Promise<Answer>;
  /** Reconnect now, as after giving up offline. */
  retry(): void;
  /** Ledger entries older than `before`, or null if they could not be fetched. */
  history(before: number): Promise<Entry[] | null>;
}

/** The live table for a seat key; the socket lives as long as the component. */
export function useTable(code: string, seatKey: string): TableConnection {
  const [state, setState] = useState<TableView | null>(null);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const socket = useRef<TableSocket | null>(null);

  useEffect(() => {
    const ts = new TableSocket({
      url: api.socketUrl(code),
      seatKey,
      onState: (s, seat) => {
        setState(s);
        setSeatId(seat);
        const me = s.seats.find((x) => x.id === seat);
        if (me) {
          const hostName = s.seats.find((x) => x.id === s.host)?.name;
          recent.update(code, { stack: me.stack, buyIn: s.buyIn, openedAt: Date.now(), hostName, players: s.seats.length });
        }
      },
      onStatus: setStatus,
    });
    socket.current = ts;
    ts.start();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ts.resume();
    };
    const onOffline = () => ts.offline();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', onOffline);
      ts.stop();
      socket.current = null;
    };
  }, [code, seatKey]);

  const send = useCallback(
    (cmd: Command) => socket.current?.command(cmd) ?? Promise.resolve<Answer>({ ok: false, code: 'not-found' }),
    [],
  );

  const retry = useCallback(() => socket.current?.resume(), []);
  const history = useCallback((before: number) => socket.current?.history(before) ?? Promise.resolve(null), []);

  return { state, seatId, status, send, retry, history };
}
