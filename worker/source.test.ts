import { describe, expect, it } from 'vitest';
import { sourceOf } from './source.js';

describe('the network a client address belongs to', () => {
  it('is the /24 of an IPv4 address', () => {
    expect(sourceOf('203.0.113.7')).toBe('203.0.113');
    expect(sourceOf('203.0.113.250')).toBe('203.0.113');
    expect(sourceOf('203.0.114.7')).toBe('203.0.114');
  });

  it('is the /64 of an IPv6 address, however it is written', () => {
    expect(sourceOf('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    expect(sourceOf('2001:db8::1')).toBe('2001:db8:0:0');
    expect(sourceOf('2001:0DB8:0:0:ffff::1')).toBe('2001:db8:0:0');
    expect(sourceOf('2001:db8:0:1::')).toBe('2001:db8:0:1');
    expect(sourceOf('2001:db8:1:2::9')).not.toBe(sourceOf('2001:db8:1:3::9'));
  });

  it('reads an IPv4-mapped IPv6 address as the IPv4 one', () => {
    expect(sourceOf('::ffff:203.0.113.7')).toBe('203.0.113');
  });

  it('is null for loopback, which only a local server sees', () => {
    expect(sourceOf('127.0.0.1')).toBeNull();
    expect(sourceOf('::1')).toBeNull();
  });

  it('is null for no address or text that is not one', () => {
    for (const bad of [null, '', 'junk', '1.2.3', '1.2.3.4.5', '2001:db8:::1', '1:2:3:4:5:6:7:8:9', '2001:zzzz::1', '1:2:3:4:5:6:7']) {
      expect(sourceOf(bad), String(bad)).toBeNull();
    }
  });
});
