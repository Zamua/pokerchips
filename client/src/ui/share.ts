import { showCode } from './text.js';

export type Shared = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Shares a table's link with the system sheet, or copies it where there is none. */
export async function shareTable(code: string): Promise<Shared> {
  const url = `${window.location.origin}/${code}`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'pokerchips', text: `Join my poker table, code ${showCode(code)}`, url });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
