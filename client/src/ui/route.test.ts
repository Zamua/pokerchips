import { describe, expect, it } from 'vitest';
import { normalizeCode, parseRoute, pathOf } from './route.js';

describe('routes', () => {
  it('maps the four screens', () => {
    expect(parseRoute('/')).toEqual({ name: 'landing' });
    expect(parseRoute('/new')).toEqual({ name: 'open' });
    expect(parseRoute('/join')).toEqual({ name: 'join', code: '' });
    expect(parseRoute('/join', '?code=7B2E41C9')).toEqual({ name: 'join', code: '7b2e41c9' });
    expect(parseRoute('/7b2e41c9')).toEqual({ name: 'table', code: '7b2e41c9' });
  });

  it('lowercases a table code and tolerates a trailing slash', () => {
    expect(parseRoute('/7B2E41C9/')).toEqual({ name: 'table', code: '7b2e41c9' });
  });

  it('sends anything else to the landing screen', () => {
    for (const p of ['/7b2e41c', '/7b2e41c9x', '/7b2e_41c', '/a/b', '/join/x']) expect(parseRoute(p)).toEqual({ name: 'landing' });
    expect(parseRoute('/join', '?code=nope')).toEqual({ name: 'join', code: '' });
  });

  it('round-trips every route through its path', () => {
    for (const r of [{ name: 'landing' }, { name: 'open' }, { name: 'join', code: '' }, { name: 'join', code: 'abcd1234' }, { name: 'table', code: 'abcd1234' }] as const) {
      const path = pathOf(r);
      const q = path.indexOf('?');
      expect(parseRoute(q < 0 ? path : path.slice(0, q), q < 0 ? '' : path.slice(q))).toEqual(r);
    }
  });

  it('reads a code as people type or paste it', () => {
    expect(normalizeCode('7B2E 41C9')).toBe('7b2e41c9');
    expect(normalizeCode(' 7b2e-41c9 ')).toBe('7b2e41c9');
    expect(normalizeCode('7b2e41c')).toBeNull();
    expect(normalizeCode('7b2e41c!')).toBeNull();
  });
});
