import type { Secrets } from '../app/ports.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 8 characters of [a-z0-9], uniform: bytes past the last whole alphabet cycle are redrawn. */
export function tableCode(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let code = '';
  while (code.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && code.length < 8) code += ALPHABET[b % ALPHABET.length];
    }
  }
  return code;
}

export const secrets: Secrets = {
  seatId: () => hex(8),
  seatKey: () => hex(16),
  async hash(seatKey) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seatKey));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};
