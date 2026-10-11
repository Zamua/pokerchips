import { COLORS, type ChipColor, markOn, towerOf, type TowerShape } from './towers.js';

const INK = COLORS.ink;

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

const JITTER = [0, 2, -1, 3, -2, 1, 0, -3, 2, -1, 1, -2];

/** One cartoon side-view stack, ink-outlined; colors bottom to top. */
export function Stack({ colors, width, wobble = true }: { colors: ChipColor[]; width: number; wobble?: boolean }) {
  const w = width;
  const th = w * 0.2;
  const ry = w * 0.26;
  const pad = 3;
  const H = Math.ceil(colors.length * th + ry * 2 + pad * 2);
  const W = w + pad * 2 + 8;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {colors.map((c, i) => {
        const col = COLORS[c];
        const dx = pad + 4 + (wobble ? JITTER[i % JITTER.length] : 0);
        const yc = H - pad - ry - (i + 1) * th;
        const mark = markOn(c);
        return (
          <g key={i}>
            <path
              d={`M${dx} ${yc} v${th} A${w / 2} ${ry} 0 0 0 ${dx + w} ${yc + th} v${-th} z`}
              fill={shade(col, 0.82)}
              stroke={INK}
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            {[0.2, 0.5, 0.8].map((fx) => {
              const x = fx * w;
              const e = ry * Math.sqrt(1 - ((x - w / 2) / (w / 2)) ** 2);
              return <rect key={fx} x={dx + x - w * 0.05} y={yc + e + 1} width={w * 0.1} height={th - 2} fill={mark} opacity=".9" />;
            })}
            <ellipse cx={dx + w / 2} cy={yc} rx={w / 2} ry={ry} fill={col} stroke={INK} strokeWidth="2.2" />
            <ellipse
              cx={dx + w / 2}
              cy={yc}
              rx={w * 0.3}
              ry={ry * 0.58}
              fill="none"
              stroke={mark}
              strokeOpacity=".75"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Chip stacks whose height follows an amount. */
export function Tower({ amount, shape, width }: { amount: number; shape: TowerShape; width: number }) {
  const stacks = towerOf(amount, shape);
  if (stacks.length === 0) return null;
  return (
    <div className="tower">
      {stacks.map((s, i) => (
        <Stack key={i} colors={s} width={width} />
      ))}
    </div>
  );
}

/** A chip seen from above: an avatar with a letter, or a quick-bet chip with its value. */
export function ChipTop({ color, label, size = 34 }: { color: ChipColor; label: string; size?: number }) {
  const mark = markOn(color);
  const fs = label.length > 4 ? 13 : label.length > 3 ? 16 : label.length > 2 ? 21 : 28;
  const y = label.length > 4 ? 55 : label.length > 3 ? 56 : label.length > 2 ? 57 : 61;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <circle cx="50" cy="50" r="46" fill={COLORS[color]} stroke={INK} strokeWidth="6" />
      {Array.from({ length: 8 }, (_, k) => (
        <rect key={k} x="45" y="6" width="10" height="13" rx="2" fill={mark} transform={`rotate(${k * 45} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r={size > 40 ? 31 : 27} fill={color === 'ink' ? '#2A2A60' : '#fff'} stroke={INK} strokeWidth="5" />
      {label && (
        <text
          x="50"
          y={y}
          textAnchor="middle"
          fontFamily="Unbounded, sans-serif"
          fontWeight="800"
          fontSize={fs}
          fill={color === 'ink' ? COLORS.sun : INK}
        >
          {label}
        </text>
      )}
    </svg>
  );
}
