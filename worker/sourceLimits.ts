import type { Env } from './env.js';
import { sourceOf } from './source.js';

/**
 * The caps on the network a request comes from. A limiter that is down lets
 * the request through: a cap must not stop real players, and the tables
 * answering the request scale on their own.
 */
export function sourceLimits(env: Env, request: Request) {
  const source = sourceOf(request.headers.get('CF-Connecting-IP'));
  const limiter = () => env.CREATIONS.get(env.CREATIONS.idFromName('creations'), { locationHint: 'enam' });

  async function guarded(call: (source: string) => Promise<boolean>): Promise<boolean> {
    if (source === null) return true;
    try {
      return await call(source);
    } catch (e) {
      console.error('source limiter unavailable', e instanceof Error ? e.message : '');
      return true;
    }
  }

  return {
    /** Counts a table opened; false when the network may open no more. */
    mayOpen: () => guarded((s) => limiter().take('creations', s)),
    /** Whether the network may look up another table. */
    mayLookUp: () => guarded(async (s) => !(await limiter().reached('misses', s))),
    /** Counts a lookup of a table that does not exist. */
    missed: () => guarded((s) => limiter().take('misses', s)),
  };
}

export type SourceLimits = ReturnType<typeof sourceLimits>;
