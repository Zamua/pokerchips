/** At most `limit` frames in any `windowMs`, per socket. */
export class RateLimit {
  private readonly times = new WeakMap<WebSocket, number[]>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 1_000,
  ) {}

  allow(ws: WebSocket, now: number): boolean {
    const recent = (this.times.get(ws) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.times.set(ws, recent);
      return false;
    }
    recent.push(now);
    this.times.set(ws, recent);
    return true;
  }
}
