import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { type Bucket, CAPS, SOURCE_WINDOW_MS } from './limits.js';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Counts what each source network does in a fixed window, per bucket. A count
 * is keyed by a hash of a random salt, the bucket and the network. The salt,
 * the keys and the counts are all erased when the window ends, so no network,
 * in clear or hashed, outlives it.
 */
export class CreationLimiter extends DurableObject<Env> {
  /** Counts one for `source` in `bucket`; false when its cap was already reached. */
  take(bucket: Bucket, source: string): Promise<boolean> {
    return this.use(bucket, source, true);
  }

  /** Whether `source` has reached its cap in `bucket`, counting nothing. */
  async reached(bucket: Bucket, source: string): Promise<boolean> {
    return !(await this.use(bucket, source, false));
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private use(bucket: Bucket, source: string, count: boolean): Promise<boolean> {
    // The hash awaits outside storage, which would let another call interleave with the count.
    return this.ctx.blockConcurrencyWhile(async () => {
      const kv = this.ctx.storage.kv;
      const now = Date.now();
      let salt = kv.get<string>('salt');
      const start = kv.get<number>('start');
      if (salt === undefined || start === undefined || now - start >= SOURCE_WINDOW_MS) {
        await this.ctx.storage.deleteAll();
        salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        kv.put('salt', salt);
        kv.put('start', now);
        await this.ctx.storage.setAlarm(now + SOURCE_WINDOW_MS);
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${bucket}:${source}`));
      const key = hex(new Uint8Array(digest));
      const used = kv.get<number>(key) ?? 0;
      if (used >= CAPS[bucket]) return false;
      if (count) kv.put(key, used + 1);
      return true;
    });
  }
}
