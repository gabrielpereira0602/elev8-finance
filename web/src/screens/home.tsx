import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Balance, Bullets, Calendar, Composition, Future, HBars, Pace, Trend, Waterfall } from '../charts';
import { brl } from '../parser';
import { PRINCIPLES } from '../learn';
import { accounts, categories, currentMonth, month, recent, refresh, summary, useSignalsAll } from '../store';
import { Money, Tabbar, Top, dayLabel, monthName } from '../ui';

const KIND_SIGN: Record<string, number> = { income: 1, refund: 1 };

export function MonthPicker() {
  const shift = (n: number) => {
    const d = new Date(Number(month.value.slice(0, 4)), Number(month.value.slice(5, 7)) - 1 + n, 1);
    month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    refresh();
  };
  return (
    <div class="row" style={{ justifyContent: 'space-between' }}>
      <button class="icon-btn" style={{ flex: 'none' }} aria-label="Mês anterior" onClick={() => shift(-1)}>‹</button>
      <b style={{ textAlign: 'center' }}>{monthName(month.value)}</b>
      <button class="icon-btn" style={{ flex: 'none' }} aria-label="Próximo mês" onClick={() => shift(1)}>›</button>
    </div>
  );
}

export function PurchaseRow({ p, onClick }: { p: any; onClick?: () => void }) {
  const cat = categories.value.find((c) => c.id === p.category_id);
  const acc = accounts.value.find((a) => a.id === p.account_id);
  const cents = p.amount_cents ?? p.total_cents;
  const sign = KIND_SIGN[p.kind] ? 1 : p.kind === 'expense' ? -1 : 0;
  const seq = p.installments_total > 1 && p.seq ? ` ${p.seq}/${p.installments_total}` : '';
  return (
    <a class="item" href={`#/lancamento/${p.id}`} onClick={onClick} style={{ color: 'inherit', textDecoration: 'none' }}>
      <span class="t"><b>{(p.description ?? cat?.name ?? 'Lançamento') + seq}</b><span>{[cat?.name, acc?.name, dayLabel(p.purchase_date)].filter(Boolean).join(' · ')}{p.status === 'draft' ? ' · rascunho' : ''}</span></span>
      <span class={'v ' + (sign > 0 ? 'ok' : '')}><Money cents={cents} signed={sign > 0} /></span>
    </a>
  );
}

export function Inicio() {
  useSignalsAll();
  const s = summary.value;
  const tip = PRINCIPLES[(new Date().getDate() + 3) % PRINCIPLES.length];
  if (!s) return <><Top sub="Carregando…" /><main class="screen" aria-busy="true" /><Tabbar active="inicio" /></>;
  const target = s.income_cents > 0 ? s.income_cents - s.saved_cents : s.budget_cents;
  const cs = s.can_spend;
  const empty = s.expense_count === 0 && s.income_cents === 0 && recent.value.length === 0;
  return (
    <>
      <Top sub={monthName(s.month)} />
      <main class="screen">
        {!currentMonth.value && <MonthPicker />}
        {empty ? (
          <div class="empty">
            <b class="mid">Seu mês começa aqui</b>
            <span class="dim">Lance o que entrou (salário, freela) e o primeiro gasto. O painel se monta sozinho.</span>
            <a class="btn" href="#/lancar?tipo=income">Lançar o que entrou</a>
            <a class="btn ghost" href="#/lancar">Lançar um gasto</a>
          </div>
        ) : (
          <>
            <section class="card hero" aria-label="Pode gastar hoje">
              {cs.basis === 'none' ? (
                <>
                  <span class="dim">Pode gastar hoje</span>
                  <span>Lance o que entrou neste mês (ou defina um orçamento) para eu calcular quanto você pode gastar por dia.</span>
                  <div class="row"><a class="btn" href="#/lancar?tipo=income">Lançar entrada</a><a class="btn ghost" href="#/ajustes/orcamento">Orçamento</a></div>
                </>
              ) : (
                <>
                  <span class="dim">Pode gastar hoje</span>
                  <span class={'big ' + ((cs.left_cents ?? 0) <= 0 ? 'warn' : '')}><Money cents={cs.per_day_cents ?? 0} /></span>
                  <span class="dim">{(cs.left_cents ?? 0) > 0
                    ? <>Sobram <Money cents={cs.left_cents ?? 0} /> para {cs.days_left} {cs.days_left === 1 ? 'dia' : 'dias'}{cs.basis === 'income' ? ', já descontando o que você guardou' : ', pelo seu orçamento'}.</>
                    : <>O mês já passou do limite em <Money cents={Math.abs(cs.left_cents ?? 0)} />.</>}</span>
                </>
              )}
            </section>
            <div class="grid3">
              <div class="stat"><span>Entrou</span><b class="ok"><Money cents={s.income_cents} /></b></div>
              <div class="stat"><span>Saiu</span><b><Money cents={s.spent_cents} /></b></div>
              <div class="stat"><span>Guardado</span><b class="ok"><Money cents={s.saved_cents} /></b></div>
            </div>
            <section class="card"><h2>Ritmo do mês <small>{target ? `${Math.round((s.spent_cents / target) * 100)}% de ${brl(target)}` : ''}</small></h2>
              <Pace daily={s.daily} month={s.month} target={target} /></section>
            {s.drafts > 0 && <a class="banner warn" href="#/lancamentos?status=draft"><span>{s.drafts} rascunho(s) esperando confirmação</span><b class="warn">Ver</b></a>}
            <section class="card"><h2>Últimos lançamentos <a href="#/lancamentos" style={{ fontSize: '13px' }}>ver todos</a></h2>
              <div class="list">{recent.value.slice(0, 5).map((p) => <PurchaseRow key={p.id} p={p} />)}</div></section>
          </>
        )}
        <a class="card" href={`#/aprender/${tip.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span class="dim" style={{ letterSpacing: '.12em', fontSize: '11px' }}>PRINCÍPIO DO DIA</span>
          <b>{tip.title}</b><span class="dim">{tip.idea}</span>
        </a>
      </main>
      <Tabbar active="inicio" />
    </>
  );
}

const TABS: [string, string][] = [['geral', 'Geral'], ['fluxo', 'Fluxo'], ['categorias', 'Categorias'], ['tendencia', 'Tendência'], ['calendario', 'Calendário'], ['futuro', 'Futuro']];

export function Analises({ tab }: { tab: string }) {
  useSignalsAll();
  const s = summary.value;
  const [trend, setTrend] = useState<any[] | null>(null);
  const [future, setFuture] = useState<any[] | null>(null);
  useEffect(() => {
    if (tab === 'tendencia' && !trend) api('GET', '/metrics/trend?months=6').then((r) => setTrend(r.months)).catch(() => setTrend([]));
    if (tab === 'futuro' && !future) api('GET', '/metrics/future?months=6').then((r) => setFuture(r.months)).catch(() => setFuture([]));
  }, [tab]);
  const income = s?.income_cents ?? 0;
  const pct = (c: number) => (income > 0 ? (c / income) * 100 : 0);
  return (
    <>
      <Top sub="Análises" />
      <main class="screen">
        <div class="seg" role="tablist" aria-label="Visões">
          {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { location.hash = `#/analises/${id}`; }}>{l}</button>)}
        </div>
        {['geral', 'fluxo', 'categorias', 'calendario'].includes(tab) && <MonthPicker />}
        {!s ? <div class="dim">Carregando…</div> : (
          <>
            {tab === 'geral' && (
              <>
                <section class="card"><h2>Regra 50/30/20 <small>% do que entrou</small></h2>
                  {income > 0 ? (
                    <Bullets rows={[
                      { label: 'Necessidades', cents: s.groups.need, pct: pct(s.groups.need), target: 50 },
                      { label: 'Desejos', cents: s.groups.want + s.groups.other, pct: pct(s.groups.want + s.groups.other), target: 30, color: '#7FB0FF' },
                      { label: 'Guardar', cents: s.saved_cents, pct: pct(s.saved_cents), target: 20, color: '#2FBF71' },
                    ]} />
                  ) : <span class="dim">Lance o que entrou no mês para ver a divisão. <a href="#/aprender/503020">O que é 50/30/20?</a></span>}
                </section>
                <section class="card"><h2>Para onde foi <small>top 5</small></h2>
                  {s.by_category.length ? <HBars rows={s.by_category.slice(0, 5).map((c) => ({ label: c.name, cents: c.cents }))} /> : <span class="dim">Nenhum gasto neste mês.</span>}</section>
                <div class="grid2">
                  <div class="stat"><span>Média por gasto</span><b><Money cents={s.average_cents} /></b><span>{s.expense_count} lançamentos</span></div>
                  <div class="stat"><span>Mês anterior</span><b><Money cents={s.previous_spent_cents} /></b><span>{s.previous_spent_cents ? `${s.spent_cents >= s.previous_spent_cents ? '+' : '−'}${Math.abs(Math.round(((s.spent_cents - s.previous_spent_cents) / s.previous_spent_cents) * 100))}% agora` : 'sem dados'}</span></div>
                </div>
              </>
            )}
            {tab === 'fluxo' && (
              <>
                <div class="grid3">
                  <div class="stat"><span>Entradas</span><b class="ok"><Money cents={s.income_cents} /></b></div>
                  <div class="stat"><span>Saídas</span><b><Money cents={s.spent_cents} /></b></div>
                  <div class="stat"><span>Saldo do mês</span><b class={s.balance_cents >= 0 ? 'blue' : 'warn'}><Money cents={s.balance_cents} signed /></b></div>
                </div>
                <section class="card"><h2>Do que entrou ao que está livre</h2>
                  {income > 0 ? <Waterfall income={income} need={s.groups.need} want={s.groups.want} other={s.groups.other} saved={s.saved_cents} /> : <span class="dim">Lance uma entrada para ver o fluxo.</span>}</section>
                <section class="card"><h2>Por cartão e conta</h2>
                  {s.by_account.length ? <HBars rows={s.by_account.map((a) => ({ label: a.name, cents: a.cents }))} color="#2F6FD6" /> : <span class="dim">Sem gastos.</span>}</section>
                {(s.pending_cents > 0 || s.reimbursable_cents > 0) && (
                  <div class="grid2">
                    <div class="stat"><span>Pendente</span><b class="warn"><Money cents={s.pending_cents} /></b></div>
                    <div class="stat"><span>A ser reembolsado</span><b><Money cents={s.reimbursable_cents} /></b></div>
                  </div>
                )}
              </>
            )}
            {tab === 'categorias' && (
              <>
                <section class="card"><h2>Como o gasto se divide</h2>
                  {s.by_category.length ? <><Composition rows={s.by_category.map((c) => ({ label: c.name, cents: c.cents, group: c.group }))} /><span class="dim">Azul forte: essencial · azul claro: desejos</span></> : <span class="dim">Nenhum gasto neste mês.</span>}</section>
                <section class="card"><div class="list">
                  {s.by_category.map((c) => (
                    <a key={c.name} class="item" href={`#/lancamentos?category_id=${c.id ?? ''}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      <span class="t"><b>{c.name}</b><span>{Math.round((c.cents / Math.max(1, s.spent_cents + s.refunds_cents)) * 100)}% do mês</span></span><span class="v"><Money cents={c.cents} /></span>
                    </a>
                  ))}
                </div></section>
              </>
            )}
            {tab === 'tendencia' && (
              trend === null ? <div class="dim">Carregando…</div> : (
                <>
                  <section class="card"><h2>Entrou e saiu <small>6 meses</small></h2><Trend months={trend} />
                    <div class="chips" style={{ gap: '14px' }}><span class="dim">■ <span class="ok">Entrou</span></span><span class="dim">■ <span class="blue">Saiu</span></span></div></section>
                  <section class="card"><h2>Sobra de cada mês <small>entrou − saiu</small></h2><Balance months={trend} /></section>
                  <span class="dim">A tendência fica mais útil a partir do segundo mês de uso.</span>
                </>
              )
            )}
            {tab === 'calendario' && (
              <section class="card"><h2>Quanto saiu por dia <small>toque e segure para ver</small></h2><Calendar month={s.month} daily={s.daily} />
                <span class="dim">Quanto mais escuro, mais saiu naquele dia. O contorno branco é hoje.</span></section>
            )}
            {tab === 'futuro' && (
              future === null ? <div class="dim">Carregando…</div> : (
                <section class="card"><h2>Já comprometido por mês <small>parcelas e recorrentes</small></h2>
                  {future.some((m) => m.total_cents > 0) ? <Future months={future} /> : <span class="dim">Nenhuma parcela ou recorrente nos próximos meses.</span>}</section>
              )
            )}
          </>
        )}
      </main>
      <Tabbar active="analises" />
    </>
  );
}
