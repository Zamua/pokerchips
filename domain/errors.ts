/** Stable refusal codes; the client turns each into a sentence. */
export const ERROR_CODES = [
  'bad-name',
  'bad-amount',
  'bad-code',
  'not-found',
  'name-taken',
  'table-full',
  'not-host',
  'no-such-seat',
  'no-such-pot',
  'short-stack',
  'short-pot',
  'too-many-pots',
  'main-pot',
  'not-undoable',
  'host-here',
  'not-away',
  'rate-limited',
  'bad-frame',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
