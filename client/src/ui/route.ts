import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'landing' }
  | { name: 'open' }
  | { name: 'join'; code: string }
  | { name: 'table'; code: string };

const CODE = /^[a-z0-9]{8}$/;

/** A table code as typed or pasted: spaces and dashes dropped, lowercased; null unless 8 of [a-z0-9]. */
export function normalizeCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toLowerCase();
  return CODE.test(code) ? code : null;
}

export function parseRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'landing' };
  if (path === '/new') return { name: 'open' };
  if (path === '/join') {
    const code = new URLSearchParams(search).get('code') ?? '';
    return { name: 'join', code: normalizeCode(code) ?? '' };
  }
  const code = path.split('/').length === 2 ? normalizeCode(path.slice(1)) : null;
  return code ? { name: 'table', code } : { name: 'landing' };
}

export const pathOf = (route: Route): string => {
  switch (route.name) {
    case 'landing':
      return '/';
    case 'open':
      return '/new';
    case 'join':
      return route.code ? `/join?code=${route.code}` : '/join';
    case 'table':
      return `/${route.code}`;
  }
};

const listeners = new Set<() => void>();
let current = '';

function snapshot(): string {
  const next = window.location.pathname + window.location.search;
  if (next !== current) current = next;
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
}

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const path = pathOf(route);
  if (path === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const fn of listeners) fn();
}

export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, snapshot);
  const q = location.indexOf('?');
  return parseRoute(q < 0 ? location : location.slice(0, q), q < 0 ? '' : location.slice(q));
}
