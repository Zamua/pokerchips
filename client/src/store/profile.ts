/** The name this device last played under, to fill in the next form. Best-effort like recent tables. */
const KEY = 'pokerchips.name';
/** How this device last entered a bet: with chips or by typing. */
const BET_KEY = 'pokerchips.bet';

export type BetMode = 'chips' | 'type';

export const profile = {
  name(): string {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  },
  remember(name: string): void {
    try {
      localStorage.setItem(KEY, name);
    } catch {
      // Storage unavailable: the form just starts empty next time.
    }
  },
  betMode(): BetMode {
    try {
      return localStorage.getItem(BET_KEY) === 'type' ? 'type' : 'chips';
    } catch {
      return 'chips';
    }
  },
  rememberBetMode(mode: BetMode): void {
    try {
      localStorage.setItem(BET_KEY, mode);
    } catch {
      // Storage unavailable: the drawer opens on chips next time.
    }
  },
};
