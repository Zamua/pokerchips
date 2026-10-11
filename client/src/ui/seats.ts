/** The other seats in table order, starting with the one after yours, as around a real table. */
export function othersAround<S extends { id: string }>(seats: readonly S[], me: string): S[] {
  const i = seats.findIndex((s) => s.id === me);
  return i < 0 ? [...seats] : [...seats.slice(i + 1), ...seats.slice(0, i)];
}
