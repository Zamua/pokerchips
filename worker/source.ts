const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/;
const LOOPBACK = /^(127\.|::1$)/;
const GROUP = /^[0-9a-f]{1,4}$/i;

/** The network of a client address: its /24 for IPv4, its /64 for IPv6; null when it is neither or is loopback, which only a local server sees. */
export function sourceOf(ip: string | null): string | null {
  if (!ip || LOOPBACK.test(ip)) return null;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  const v4 = IPV4.exec(mapped ? mapped[1]! : ip);
  if (v4) return v4.slice(1).join('.');
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => GROUP.test(g))) return null;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':');
}
