import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { CREATION_WINDOW_MS, CREATIONS_PER_WINDOW } from './limits.js';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Counts table creations per source network in a fixed window. A count is
 * keyed by a hash of a random salt and the network. The salt, the keys and
 * the counts are all erased when the window ends, so no network, in clear or
 * hashed, outlives it.
 */
export class CreationLimiter extends DurableObject<Env> {
  /** Whether `source` may open another table; counts it when it may. */
  take(source: string): Promise<boolean> {
    // The hash awaits outside storage, which would let another call interleave with the count.
    return this.ctx.blockConcurrencyWhile(async () => {
      const kv = this.ctx.storage.kv;
      const now = Date.now();
      let salt = kv.get<string>('salt');
      const start = kv.get<number>('start');
      if (salt === undefined || start === undefined || now - start >= CREATION_WINDOW_MS) {
        await this.ctx.storage.deleteAll();
        salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        kv.put('salt', salt);
        kv.put('start', now);
        await this.ctx.storage.setAlarm(now + CREATION_WINDOW_MS);
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${source}`));
      const key = hex(new Uint8Array(digest));
      const used = kv.get<number>(key) ?? 0;
      if (used >= CREATIONS_PER_WINDOW) return false;
      kv.put(key, used + 1);
      return true;
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
