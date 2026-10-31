import type { ErrorCode } from './errors.js';

declare const brand: unique symbol;
/** A string only its parser makes, so holding one means it was checked. */
type Brand<B extends string> = string & { readonly [brand]: B };

export type TableCode = Brand<'TableCode'>;
export type SeatName = Brand<'SeatName'>;
export type SeatId = string;
export type PotId = string;
export type Chips = number;

export const MAX_SEATS = 24;
export const MAX_SIDE_POTS = 8;
export const BUY_IN_DEFAULT = 1_000;
export const BUY_IN_MAX = 1_000_000;
export const HOST_CLAIM_AFTER_MS = 10 * 60_000;
export const IDLE_LIFETIME_MS = 30 * 24 * 60 * 60_000;
export const LEDGER_TAIL = 50;
export const MAIN_POT: PotId = 'main';
export const CODE_LENGTH = 8;
export const NAME_MAX = 20;

const CODE = new RegExp(`^[a-z0-9]{${CODE_LENGTH}}$`);
/** The characters a seat name may hold, as the body of a regex class. */
const NAME_CHARS = "a-zA-Z0-9 \\-_'.";
const NAME = new RegExp(`^[${NAME_CHARS}]{1,${NAME_MAX}}$`);
const NOT_NAME_CHAR = new RegExp(`[^${NAME_CHARS}]`, 'g');
const SIDE_POT = /^side-([1-9][0-9]*)$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const refuse = (code: ErrorCode): Parsed<never> => ({ ok: false, code });

export function parseTableCode(input: unknown): Parsed<TableCode> {
  if (typeof input !== 'string') return refuse('bad-code');
  const code = input.trim().toLowerCase();
  return CODE.test(code) ? ok(code as TableCode) : refuse('bad-code');
}

export function parseSeatName(input: unknown): Parsed<SeatName> {
  if (typeof input !== 'string') return refuse('bad-name');
  const name = input.trim();
  return NAME.test(name) ? ok(name as SeatName) : refuse('bad-name');
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function isChips(n: unknown): n is Chips {
  return Number.isSafeInteger(n) && (n as number) >= 0;
}

/** A positive chip amount, as a bet or a collect takes. */
export function parseAmount(input: unknown): Parsed<Chips> {
  return isChips(input) && input > 0 ? ok(input) : refuse('bad-amount');
}

/** A non-zero signed amount, as an adjust takes. */
export function parseDelta(input: unknown): Parsed<number> {
  return Number.isSafeInteger(input) && input !== 0 ? ok(input as number) : refuse('bad-amount');
}

export function parseBuyIn(input: unknown): Parsed<Chips> {
  if (input === undefined || input === null) return ok(BUY_IN_DEFAULT);
  return Number.isSafeInteger(input) && (input as number) >= 1 && (input as number) <= BUY_IN_MAX
    ? ok(input as number)
    : refuse('bad-amount');
}

export function isPotId(input: unknown): input is PotId {
  return typeof input === 'string' && (input === MAIN_POT || SIDE_POT.test(input));
}

export const sidePotId = (n: number): PotId => `side-${n}`;

/** The number of a side pot, or null for the main pot or anything that is not a pot id. */
export function sidePotNumber(id: string): number | null {
  const m = SIDE_POT.exec(id);
  return m ? Number(m[1]) : null;
}

/** The name with every character a seat name may not hold removed. */
export const dropNameChars = (name: string) => name.replace(NOT_NAME_CHAR, '');
