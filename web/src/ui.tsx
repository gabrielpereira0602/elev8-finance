import type { ComponentChildren } from 'preact';
import { brl } from './parser';
import { privateMode, setPrivate } from './state';

const P = (d: string) => <path d={d} />;
const ICONS: Record<string, ComponentChildren> = {
  home: <>{P('M3 11l9-7 9 7')}{P('M5 10v10h14V10')}</>,
  chart: <>{P('M4 20h16')}{P('M7 16v-4')}{P('M12 16V8')}{P('M17 16v-7')}</>,
  plus: <>{P('M12 5v14')}{P('M5 12h14')}</>,
  book: <>{P('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z')}{P('M4 21a2 2 0 0 1 2-2h13')}</>,
  gear: <><circle cx="12" cy="12" r="3" />{P('M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1')}</>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" />{P('M5 11a7 7 0 0 0 14 0')}{P('M12 18v3')}</>,
  eye: <>{P('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z')}<circle cx="12" cy="12" r="3" /></>,
  eyeoff: <>{P('M3 3l18 18')}{P('M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.2 6.2A17 17 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.2-1')}</>,
  check: P('M20 6L9 17l-5-5'),
  x: <>{P('M18 6L6 18')}{P('M6 6l12 12')}</>,
  back: P('M15 18l-6-6 6-6'),
  share: <>{P('M12 3v12')}{P('M8 7l4-4 4 4')}{P('M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7')}</>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2" />{P('M3 10h18')}</>,
  wifi: <>{P('M2 8.8a15 15 0 0 1 20 0')}{P('M5 12.5a10 10 0 0 1 14 0')}{P('M8.5 16a5 5 0 0 1 7 0')}<circle cx="12" cy="19.5" r="1" /></>,
};

export function Icon({ name, size = 22, color = 'currentColor', label }: { name: string; size?: number; color?: string; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
      {ICONS[name]}
    </svg>
  );
}

/** Money is wrapped so "modo discreto" can blur every value at once. */
export const Money = ({ cents, signed = false }: { cents: number; signed?: boolean }) => (
  <span class="money">{signed && cents > 0 ? '+' : ''}{brl(cents)}</span>
);

export function Top({ sub, back }: { sub?: string; back?: string }) {
  return (
    <header class="top">
      <div class="brand">
        {back ? <a class="icon-btn" href={back} aria-label="Voltar"><Icon name="back" /></a> : <img src="/icons/simbolo-azul.svg" alt="" />}
        <div><b>elev8 <span>finance</span></b>{sub && <small>{sub}</small>}</div>
      </div>
      <button class="icon-btn" aria-label={privateMode.value ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={privateMode.value} onClick={() => setPrivate(!privateMode.value)}>
        <Icon name={privateMode.value ? 'eyeoff' : 'eye'} size={20} color="#A9AFB8" />
      </button>
    </header>
  );
}

export function Tabbar({ active }: { active: string }) {
  const tabs: [string, string, string][] = [['inicio', 'Início', 'home'], ['analises', 'Análises', 'chart'], ['lancar', 'Lançar', 'plus'], ['aprender', 'Aprender', 'book'], ['ajustes', 'Ajustes', 'gear']];
  return (
    <div class="tabbar">
      <nav aria-label="Navegação principal">
        {tabs.map(([id, label, icon]) =>
          id === 'lancar' ? (
            <a key={id} href="#/lancar" aria-label="Lançar" aria-current={active === id ? 'page' : undefined}><span class="plus"><Icon name="plus" size={26} color="#fff" /></span></a>
          ) : (
            <a key={id} href={`#/${id}`} aria-current={active === id ? 'page' : undefined}><Icon name={icon} />{label}</a>
          ),
        )}
      </nav>
    </div>
  );
}

export const monthName = (ym: string) => {
  const s = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  const t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'hoje';
  if (d.toDateString() === y.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
