/** The name this device last played under, to fill in the next form. Best-effort like recent tables. */
const KEY = 'pokerchips.name';

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
};
