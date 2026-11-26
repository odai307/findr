import { useEffect, useId, useRef, useState } from 'react';

/**
 * A single-series daily bar chart (one measure per chart; several measures are shown as small
 * multiples, never on a shared or dual axis). Bars are thin with rounded data ends anchored to the
 * baseline, a 2px gap between bars, a recessive grid, a hover tooltip with a full-column hit area,
 * and a table view for screen readers and exact values. The bar color is the accent token, which
 * passes the dataviz validator against both the light and dark surfaces.
 */
export interface BarDatum {
  label: string; // YYYY-MM-DD
  value: number;
}

const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

function niceMax(max: number) {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => max / s <= 4) ?? 10 * pow;
  return Math.ceil(max / step) * step;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A bar whose top corners are rounded (radius r) and whose bottom sits flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function BarChart({ title, unit, data }: { title: string; unit: string; data: BarDatum[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([entry]) => entry && setWidth(Math.max(240, entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(plotW / 70)));
  const total = data.reduce((s, d) => s + d.value, 0);
  const hovered = hover !== null ? data[hover] : undefined;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="text-xs text-muted">
          {total.toLocaleString()} {unit} in {data.length} days
        </span>
      </figcaption>
      <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${title}: ${total} ${unit} over ${data.length} days. Daily values are in the table below.`}
          className="block"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={10}
                fill="var(--muted)"
              >
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const h = d.value > 0 ? Math.max(2, PAD.top + plotH - y(d.value)) : 0;
            return (
              <g key={d.label}>
                {h > 0 && (
                  <path
                    d={barPath(cx - barW / 2, PAD.top + plotH - h, barW, h, 4)}
                    fill="var(--accent)"
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                    {shortDate(d.label)}
                  </text>
                )}
                {/* Full-column hit area: easier to hover than the thin bar itself. */}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="var(--muted)"
            strokeWidth={1}
          />
        </svg>
        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(width - 60, Math.max(60, PAD.left + slot * hover + slot / 2)) }}
          >
            <span className="block text-muted">{shortDate(hovered.label)}</span>
            <span className="font-semibold text-fg">
              {hovered.value.toLocaleString()} {unit}
            </span>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">View as table</summary>
        <table id={tableId} className="mt-2 w-full max-w-xs text-left">
          <thead>
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right text-fg">{d.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
