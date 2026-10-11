import { useEffect, useState } from 'react';
import { chips } from './text.js';

/** The time, refreshed every `ms`, for "4m ago" style text. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A chip count that pops when it changes after the first render. */
export function Amount({ value, className = '' }: { value: number; className?: string }) {
  const [first] = useState(value);
  return (
    <span key={value} className={`${className}${value !== first ? ' pop' : ''}`.trim() || undefined}>
      {chips(value)}
    </span>
  );
}
