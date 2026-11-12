const KEY = 'pokerchips.device';
const ID = /^[0-9a-f]{32}$/;

/**
 * A random id for this browser, made on first use and kept in localStorage.
 * It only lets usage be counted per device; it is tied to no name, seat or table.
 * null when storage is unavailable.
 */
export function deviceId(): string | null {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept && ID.test(kept)) return kept;
    const made = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    return null;
  }
}
