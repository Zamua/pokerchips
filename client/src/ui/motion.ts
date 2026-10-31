import { COLORS, type ChipColor, markOn } from './towers.js';

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function chipSvg(color: ChipColor): string {
  const mark = markOn(color);
  const notches = Array.from({ length: 8 }, (_, k) => `<rect x="45" y="6" width="10" height="13" rx="2" fill="${mark}" transform="rotate(${k * 45} 50 50)"/>`).join('');
  return `<svg width="30" height="30" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="${COLORS[color]}" stroke="${COLORS.ink}" stroke-width="7"/>${notches}<circle cx="50" cy="50" r="27" fill="#fff" stroke="${COLORS.ink}" stroke-width="6"/></svg>`;
}

/** A chip that hops from one element to another; nothing when motion is reduced. */
export function flyChip(from: Element | null, to: Element | null, color: ChipColor = 'tomato'): void {
  if (!from || !to || reducedMotion()) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const el = document.createElement('div');
  el.className = 'flying-chip';
  el.dataset.testid = 'flying-chip';
  el.innerHTML = chipSvg(color);
  document.body.appendChild(el);
  const x0 = a.left + a.width / 2 - 15;
  const y0 = a.top + a.height / 2 - 15;
  const x1 = b.left + b.width / 2 - 15;
  const y1 = b.top + b.height / 2 - 15;
  const lift = Math.min(90, Math.abs(y1 - y0) / 2 + 30);
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - lift}px) scale(1.15) rotate(180deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.8) rotate(360deg)`, opacity: 0.2 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  );
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}
