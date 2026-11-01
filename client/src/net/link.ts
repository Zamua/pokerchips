export type Status = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'denied';

export const HEARTBEAT_MS = 25_000;
/** A socket that has heard nothing for this long is presumed dead. */
export const SILENCE_MS = 2 * HEARTBEAT_MS + 5_000;
/** A socket not welcomed this long after it was created counts as dropped. */
export const WELCOME_MS = 15_000;
export const BACKOFF_START_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
export const MAX_ATTEMPTS = 15;

/**
 * A table connection's lifecycle. `gen` numbers the sockets, so an event from
 * a socket already let go is told apart; `attempt` counts tries since the last
 * welcome; `again` is set once a connection has been lost.
 */
export type Link =
  | { k: 'idle' }
  /** A socket is opening; the welcome deadline runs. */
  | { k: 'opening'; gen: number; attempt: number; again: boolean }
  /** Open and hello sent; the welcome deadline still runs. */
  | { k: 'hello'; gen: number; attempt: number; again: boolean }
  | { k: 'online'; gen: number; heard: number }
  /** Between attempts; the backoff timer runs. */
  | { k: 'waiting'; gen: number; attempt: number }
  /** Gave up after MAX_ATTEMPTS; only a resume tries again. */
  | { k: 'offline'; gen: number }
  | { k: 'denied' }
  | { k: 'stopped' };

export type LinkEvent =
  | { e: 'start' }
  | { e: 'stop' }
  /** The page or the network came back, or the player asked to retry. */
  | { e: 'resume' }
  /** The device lost its network. */
  | { e: 'offline' }
  | { e: 'opened'; gen: number }
  | { e: 'welcome'; gen: number }
  | { e: 'denied'; gen: number }
  /** Any other frame. */
  | { e: 'heard'; gen: number }
  | { e: 'closed'; gen: number }
  /** The current state's timer fired. */
  | { e: 'timer' };

/** What the shell does after a step, in order. Socket effects act on the socket it holds. */
export type Effect =
  | { do: 'open'; gen: number }
  /** Let go of the socket, closing it if it is still open. */
  | { do: 'close'; code: number; reason: string }
  | { do: 'send'; frame: 'hello' | 'ping' }
  /** Replace the one timer; null clears it. */
  | { do: 'timer'; ms: number | null }
  /** Send every held command. */
  | { do: 'flush' }
  /** Settle every held command as refused. */
  | { do: 'refuse-held' }
  /** Give up on the history request in flight. */
  | { do: 'end-history' };

export interface Step {
  link: Link;
  effects: Effect[];
}

/** The clock and a jitter sample, given to every step so `next` stays pure. */
export interface At {
  now: number;
  random: number;
}

/** The one place a link changes. Every state decides every event. */
export function next(link: Link, ev: LinkEvent, at: At): Step {
  switch (link.k) {
    case 'idle':
      return fromIdle(link, ev);
    case 'opening':
    case 'hello':
      return fromConnecting(link, ev, at);
    case 'online':
      return fromOnline(link, ev, at);
    case 'waiting':
      return fromWaiting(link, ev);
    case 'offline':
      return fromOffline(link, ev);
    case 'denied':
    case 'stopped':
      // Terminal: the socket and timer are gone, so nothing can follow.
      return stay(link);
  }
}

/** What the connection indicator shows; null leaves it as it was. */
export function statusOf(link: Link): Status | null {
  switch (link.k) {
    case 'idle':
    case 'stopped':
      return null;
    case 'opening':
    case 'hello':
      return link.again ? 'reconnecting' : 'connecting';
    case 'online':
      return 'online';
    case 'waiting':
      return 'reconnecting';
    case 'offline':
      return 'offline';
    case 'denied':
      return 'denied';
  }
}

function fromIdle(link: Extract<Link, { k: 'idle' }>, ev: LinkEvent): Step {
  switch (ev.e) {
    case 'start':
      return connect(1, 0, false);
    case 'stop':
      return stopped();
    case 'resume':
    case 'offline':
    case 'opened':
    case 'welcome':
    case 'denied':
    case 'heard':
    case 'closed':
    case 'timer':
      // Not started: no socket or timer exists to cause these.
      return stay(link);
  }
}

function fromConnecting(link: Extract<Link, { k: 'opening' | 'hello' }>, ev: LinkEvent, at: At): Step {
  switch (ev.e) {
    case 'start':
      return stay(link);
    case 'stop':
      return stopped();
    case 'resume':
      return reconnect(link.gen);
    case 'offline':
      return lost(link.gen, link.attempt, at, 'offline');
    case 'opened':
      if (ev.gen !== link.gen || link.k !== 'opening') return stay(link);
      return { link: { ...link, k: 'hello' }, effects: [{ do: 'send', frame: 'hello' }] };
    case 'welcome':
      if (ev.gen !== link.gen || link.k !== 'hello') return stay(link);
      return { link: { k: 'online', gen: link.gen, heard: at.now }, effects: [{ do: 'timer', ms: HEARTBEAT_MS }, { do: 'flush' }] };
    case 'denied':
      return ev.gen === link.gen ? denied() : stay(link);
    case 'heard':
      // Nothing to record before the welcome.
      return stay(link);
    case 'closed':
      return ev.gen === link.gen ? lost(link.gen, link.attempt, at, 'lost') : stay(link);
    case 'timer':
      return lost(link.gen, link.attempt, at, 'no welcome');
  }
}

function fromOnline(link: Extract<Link, { k: 'online' }>, ev: LinkEvent, at: At): Step {
  switch (ev.e) {
    case 'start':
    case 'opened':
    case 'welcome':
      // Already started, opened and welcomed.
      return stay(link);
    case 'stop':
      return stopped();
    case 'resume':
      if (at.now - link.heard < SILENCE_MS) return stay(link);
      return reconnect(link.gen);
    case 'offline':
      return lost(link.gen, 0, at, 'offline');
    case 'denied':
      return ev.gen === link.gen ? denied() : stay(link);
    case 'heard':
      return ev.gen === link.gen ? { link: { ...link, heard: at.now }, effects: [] } : stay(link);
    case 'closed':
      return ev.gen === link.gen ? lost(link.gen, 0, at, 'lost') : stay(link);
    case 'timer':
      if (at.now - link.heard > SILENCE_MS) return reconnect(link.gen);
      return { link, effects: [{ do: 'send', frame: 'ping' }, { do: 'timer', ms: HEARTBEAT_MS }] };
  }
}

function fromWaiting(link: Extract<Link, { k: 'waiting' }>, ev: LinkEvent): Step {
  switch (ev.e) {
    case 'start':
    case 'offline':
      // Already started, and no socket is held to drop.
      return stay(link);
    case 'stop':
      return stopped();
    case 'resume':
      return connect(link.gen + 1, 0, true);
    case 'opened':
    case 'welcome':
    case 'denied':
    case 'heard':
    case 'closed':
      // From a socket already let go.
      return stay(link);
    case 'timer':
      return connect(link.gen + 1, link.attempt, true);
  }
}

function fromOffline(link: Extract<Link, { k: 'offline' }>, ev: LinkEvent): Step {
  switch (ev.e) {
    case 'start':
    case 'offline':
    case 'timer':
      // Already started; no socket is held and no timer is set.
      return stay(link);
    case 'stop':
      return stopped();
    case 'resume':
      return connect(link.gen + 1, 0, true);
    case 'opened':
    case 'welcome':
    case 'denied':
    case 'heard':
    case 'closed':
      // From a socket already let go.
      return stay(link);
  }
}

const stay = (link: Link): Step => ({ link, effects: [] });

const close = (reason: string, code = 4000): Effect => ({ do: 'close', code, reason });

/** A new socket, with its welcome deadline. */
function connect(gen: number, attempt: number, again: boolean, before: Effect[] = []): Step {
  return { link: { k: 'opening', gen, attempt, again }, effects: [...before, { do: 'open', gen }, { do: 'timer', ms: WELCOME_MS }] };
}

/** Let go of the socket now and open the next, as a fresh try. */
const reconnect = (gen: number): Step => connect(gen + 1, 0, true, [close('reconnect'), { do: 'end-history' }]);

/** The socket is gone: back off and try again, or give up after MAX_ATTEMPTS. */
function lost(gen: number, attempt: number, at: At, reason: string): Step {
  const effects: Effect[] = [close(reason), { do: 'end-history' }];
  if (attempt >= MAX_ATTEMPTS) return { link: { k: 'offline', gen }, effects: [...effects, { do: 'timer', ms: null }] };
  const ms = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** attempt) * (0.5 + 0.5 * at.random);
  return { link: { k: 'waiting', gen, attempt: attempt + 1 }, effects: [...effects, { do: 'timer', ms }] };
}

const ending: Effect[] = [close('leave', 1000), { do: 'timer', ms: null }, { do: 'end-history' }, { do: 'refuse-held' }];

function stopped(): Step {
  return { link: { k: 'stopped' }, effects: ending };
}

function denied(): Step {
  return { link: { k: 'denied' }, effects: ending };
}
