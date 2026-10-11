/** Keypad entry for chip amounts. The readout holds at most this many digits. */
export const MAX_DIGITS = 9;
export const MAX_ENTRY = 10 ** MAX_DIGITS - 1;

export type Key =
  | { t: 'digit'; d: number }
  | { t: 'back' }
  | { t: 'clear' }
  | { t: 'add'; n: number }
  | { t: 'set'; n: number };

export function press(amount: number, key: Key): number {
  switch (key.t) {
    case 'digit': {
      const next = amount * 10 + key.d;
      return next > MAX_ENTRY ? amount : next;
    }
    case 'back':
      return Math.floor(amount / 10);
    case 'clear':
      return 0;
    case 'add':
      return Math.min(MAX_ENTRY, amount + key.n);
    case 'set':
      return Math.max(0, Math.min(MAX_ENTRY, key.n));
  }
}

/** Each share of a split, as the table divides it: odd chips to the first seats listed. */
export function splitPreview(amount: number, n: number): { each: number; extra: number } {
  return n > 0 ? { each: Math.floor(amount / n), extra: amount % n } : { each: 0, extra: 0 };
}

export type Reason = 'rebuy' | 'cashout' | 'correction';

/** The signed change an adjust makes for an entered amount. */
export function deltaFor(reason: Reason, amount: number, sign: 1 | -1): number {
  if (reason === 'rebuy') return amount;
  if (reason === 'cashout') return -amount;
  return sign * amount;
}
