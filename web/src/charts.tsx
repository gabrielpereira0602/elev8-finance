/** Small SVG charts. Sizes follow the container width; colors come from the Elev8 tokens. */
import { brl } from './parser';

const BLUE = '#0066FF', BLUE_T = '#3D8BFF', SOFT = '#7FB0FF', OK = '#2FBF71', WARN = '#F5A524', DIM = '#A9AFB8', GRID = 'rgba(197,203,211,.14)', SURF2 = '#1B1E26';
const short = (c: number) => brl(c).replace(',00', '').replace('R$', '').trim();
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];

/** Cumulative spending against an even pace to the budget (or income − saved). */
export function Pace({ daily, month, target }: { daily: { day: string; cents: number }[]; month: string; target: number | null }) {
  const W = 320, H = 150, days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const today = new Date();
  const isCurrent = today.getFullYear() === Number(month.slice(0, 4)) && today.getMonth() + 1 === Number(month.slice(5, 7));
  const last = isCurrent ? today.getDate() : days;
  const byDay = new Array(days + 1).fill(0);
  for (const d of daily) byDay[Number(d.day.slice(8, 10))] += d.cents;
  let acc = 0;
  const pts: [number, number][] = [];
  for (let d = 1; d <= last; d++) { acc += byDay[d]; pts.push([d, acc]); }
  const max = Math.max(target ?? 0, acc, 1);
  const X = (d: number) => 4 + ((d - 1) / Math.max(days - 1, 1)) * (W - 8);
  const Y = (v: number) => 22 + (1 - v / max) * (H - 42);
  const line = pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Gasto acumulado no mês">
      {target ? <path d={`M${X(1)},${Y(0)} L${X(days)},${Y(target)}`} stroke={DIM} stroke-dasharray="5 5" stroke-width="1.5" fill="none" /> : null}
      {pts.length > 0 && <path d={`M${X(1)},${Y(0)} L${line} L${X(last)},${Y(0)} Z`} fill="rgba(0,102,255,.18)" />}
      {pts.length > 0 && <polyline points={line} fill="none" stroke={BLUE_T} stroke-width="2.5" stroke-linejoin="round" />}
      {pts.length > 0 && <circle cx={X(last)} cy={Y(acc)} r="5" fill={BLUE_T} stroke="#000" stroke-width="2" />}
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke={GRID} />
      <text x="0" y={H - 2} font-size="11" fill={DIM}>1</text>
      <text x={W} y={H - 2} font-size="11" fill={DIM} text-anchor="end">{days}</text>
      {target ? <text x={W} y={Math.max(12, Y(target) - 6)} font-size="11" fill={DIM} text-anchor="end">meta {short(target)}</text> : null}
    </svg>
  );
}

/** Horizontal bars with optional target marker (50/30/20). */
export function Bullets({ rows }: { rows: { label: string; cents: number; pct: number; target?: number; color?: string }[] }) {
  return (
    <div class="blist">
      {rows.map((r) => (
        <div key={r.label}>
          <div class="l"><span>{r.label}</span><span><b class="money">{Math.round(r.pct)}%</b>{r.target !== undefined && <span class="dim"> · meta {r.target}%</span>}</span></div>
          <div class="bar"><i style={{ width: `${Math.min(100, r.pct)}%`, background: r.color ?? BLUE }} />{r.target !== undefined && <em style={{ left: `${r.target}%` }} />}</div>
        </div>
      ))}
    </div>
  );
}

export function HBars({ rows, color = BLUE }: { rows: { label: string; cents: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <div class="blist">
      {rows.map((r) => (
        <div key={r.label}>
          <div class="l"><span>{r.label}</span><b class="money">{brl(r.cents)}</b></div>
          <div class="bar"><i style={{ width: `${(r.cents / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

/** One bar split by group, then by category. */
export function Composition({ rows }: { rows: { label: string; cents: number; group: string | null }[] }) {
  const total = rows.reduce((s, r) => s + r.cents, 0) || 1;
  const sorted = [...rows].sort((a, b) => (a.group === 'need' ? 0 : 1) - (b.group === 'need' ? 0 : 1) || b.cents - a.cents);
  return (
    <div style={{ display: 'flex', height: '28px', borderRadius: '8px', overflow: 'hidden' }}>
      {sorted.map((r) => <div key={r.label} title={r.label} style={{ width: `${(r.cents / total) * 100}%`, background: r.group === 'need' ? BLUE : SOFT, borderRight: '2px solid #111318' }} />)}
    </div>
  );
}

/** From what came in to what is free: in → need → want → saved → left. */
export function Waterfall({ income, need, want, other, saved }: { income: number; need: number; want: number; other: number; saved: number }) {
  const left = income - need - want - other - saved;
  const all: [string, number, string][] = [['Entrou', income, OK], ['Essencial', -need, BLUE], ['Desejos', -want, SOFT], ['Outros', -other, DIM], ['Guardado', -saved, OK], ['Livre', left, left >= 0 ? BLUE_T : WARN]];
  const steps = all.filter(([n, v]) => n === 'Entrou' || n === 'Livre' || v !== 0);
  const W = 320, H = 190, n = steps.length, gx = W / n, bw = gx - 10;
  const max = Math.max(income, 1);
  const Y = (v: number) => 16 + (1 - Math.max(0, v) / max) * (H - 46);
  let level = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Do que entrou ao que está livre">
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke={GRID} />
      {steps.map(([name, v, col], i) => {
        const x = i * gx + 5;
        let top: number, bot: number;
        if (i === 0) { top = v; bot = 0; level = v; } else if (i === n - 1) { top = Math.max(v, 0); bot = 0; } else { top = level; bot = level + v; level = bot; }
        const y1 = Y(Math.max(top, bot)), y2 = Y(Math.min(top, bot));
        return (
          <g key={name}>
            <rect x={x} y={y1} width={bw} height={Math.max(2, y2 - y1)} rx="4" fill={col} opacity={name === 'Guardado' ? 0.6 : 1} />
            <text x={x + bw / 2} y={y1 - 5} font-size="10.5" fill="#fff" text-anchor="middle" class="money">{short(Math.abs(v))}</text>
            <text x={x + bw / 2} y={H - 6} font-size="10.5" fill={DIM} text-anchor="middle">{name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Trend({ months }: { months: { month: string; income_cents: number; spent_cents: number }[] }) {
  const W = 320, H = 150, gx = (W - 10) / months.length, bw = Math.min(16, gx / 2 - 3);
  const max = Math.max(1, ...months.flatMap((m) => [m.income_cents, m.spent_cents]));
  const Y = (v: number) => 8 + (1 - v / max) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Entrou e saiu por mês">
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke={GRID} />
      {months.map((m, i) => {
        const cx = 5 + gx * i + gx / 2;
        return (
          <g key={m.month}>
            <rect x={cx - bw - 1} y={Y(m.income_cents)} width={bw} height={Y(0) - Y(m.income_cents)} rx="3" fill={OK} />
            <rect x={cx + 1} y={Y(m.spent_cents)} width={bw} height={Y(0) - Y(m.spent_cents)} rx="3" fill={BLUE} />
            <text x={cx} y={H - 4} font-size="11" fill={DIM} text-anchor="middle">{monthLabel(m.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Balance({ months }: { months: { month: string; balance_cents: number }[] }) {
  const W = 320, H = 104, gx = (W - 10) / months.length, zero = 56;
  const mx = Math.max(1, ...months.map((m) => Math.abs(m.balance_cents)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sobra de cada mês">
      <line x1="0" x2={W} y1={zero} y2={zero} stroke={GRID} />
      {months.map((m, i) => {
        const cx = 5 + gx * i + gx / 2, v = m.balance_cents, h = Math.max(2, (Math.abs(v) / mx) * 34), y = v >= 0 ? zero - h : zero;
        return (
          <g key={m.month}>
            <rect x={cx - 11} y={y} width="22" height={h} rx="3" fill={v >= 0 ? OK : WARN} />
            {v !== 0 && <text x={cx} y={v >= 0 ? y - 5 : zero + h + 13} font-size="10" fill="#fff" text-anchor="middle" class="money">{(v >= 0 ? '+' : '−') + short(Math.abs(v))}</text>}
            <text x={cx} y={H - 2} font-size="10.5" fill={DIM} text-anchor="middle">{monthLabel(m.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Calendar({ month, daily }: { month: string; daily: { day: string; cents: number }[] }) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const days = new Date(y, m, 0).getDate();
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const by: Record<number, number> = {};
  for (const d of daily) by[Number(d.day.slice(8, 10))] = (by[Number(d.day.slice(8, 10))] ?? 0) + d.cents;
  const vals = Object.values(by).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => vals[Math.floor(p * (vals.length - 1))] ?? 0;
  const lvl = (v: number) => (v <= 0 ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.8) ? 3 : 4);
  const shades = [SURF2, 'rgba(0,102,255,.25)', 'rgba(0,102,255,.45)', 'rgba(0,102,255,.7)', BLUE];
  const today = new Date();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '5px' }}>
      {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((w, i) => <span key={i} class="dim" style={{ textAlign: 'center', fontSize: '11px' }}>{w}</span>)}
      {Array.from({ length: first }, (_, i) => <span key={'e' + i} />)}
      {Array.from({ length: days }, (_, i) => {
        const d = i + 1, v = by[d] ?? 0;
        const isToday = today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
        return <span key={d} title={brl(v)} style={{ aspectRatio: '1', borderRadius: '8px', background: shades[lvl(v)], border: isToday ? '2px solid #fff' : 0, display: 'grid', placeItems: 'center', fontSize: '11px' }}>{d}</span>;
      })}
    </div>
  );
}

export function Future({ months }: { months: { month: string; accounts: { account: string; cents: number }[]; recurring_projected_cents: number; total_cents: number }[] }) {
  const names = [...new Set(months.flatMap((m) => m.accounts.map((a) => a.account)))];
  const palette = [BLUE, '#2F6FD6', '#5A8DEB', '#9DB8F0'];
  const W = 320, H = 170, gx = (W - 10) / months.length, bw = 26;
  const max = Math.max(1, ...months.map((m) => m.total_cents));
  const Y = (v: number) => 14 + (1 - v / max) * (H - 40);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Já comprometido por mês">
        <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke={GRID} />
        {months.map((m, i) => {
          const cx = 5 + gx * i + gx / 2;
          let y0 = Y(0);
          const parts = [...m.accounts.map((a) => ({ c: a.cents, col: palette[names.indexOf(a.account) % palette.length] })), { c: m.recurring_projected_cents, col: SOFT }];
          return (
            <g key={m.month}>
              {parts.filter((p) => p.c > 0).map((p, k) => { const h = Y(0) - Y(p.c); y0 -= h; return <rect key={k} x={cx - bw / 2} y={y0} width={bw} height={h} fill={p.col} />; })}
              {m.total_cents > 0 && <text x={cx} y={y0 - 5} font-size="10" fill="#fff" text-anchor="middle" class="money">{short(m.total_cents)}</text>}
              <text x={cx} y={H - 6} font-size="11" fill={DIM} text-anchor="middle">{monthLabel(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <div class="chips" style={{ gap: '14px' }}>
        {[...names.map((n, i) => [n, palette[i % palette.length]]), ['Recorrentes', SOFT]].map(([n, c]) => (
          <span key={n} class="dim" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '3px', background: c }} />{n}</span>
        ))}
      </div>
    </>
  );
}
