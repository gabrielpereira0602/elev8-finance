import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, newKey } from '../api';
import { PRINCIPLES } from '../learn';
import { brl, toCents } from '../parser';
import { accounts, categories, finishOnboarding, loadLists, login, logout, month, privateMode, refresh, say, setPrivate, useSignalsAll, user } from '../store';
import { Icon, Money, Tabbar, Top, dayLabel, monthName } from '../ui';
import { MonthPicker, PurchaseRow } from './home';

const err = (e: unknown) => say(e instanceof Error ? e.message : 'Algo deu errado.');

// ---------------------------------------------------------------- Login
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try { await login(email, password); location.hash = '#/inicio'; } catch (x) { setMsg(x instanceof Error ? x.message : 'Não foi possível entrar.'); } finally { setBusy(false); }
  }
  return (
    <main class="center">
      <img src="/icons/elev8-finance-vertical-escuro.svg" alt="elev8 finance" style={{ height: '150px', alignSelf: 'center' }} />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <label class="f">E-mail<input class="input" type="email" autoComplete="username" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></label>
        <label class="f">Senha<input class="input" type="password" autoComplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></label>
        {msg && <div class="banner err" role="alert">{msg}</div>}
        <button class="btn" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p class="dim" style={{ textAlign: 'center' }}>Beta fechado da Elev8 Lab. Seus dados ficam isolados na sua conta.</p>
    </main>
  );
}

// ---------------------------------------------------------------- Aprender
export function Aprender() {
  return (
    <>
      <Top sub="Educação financeira" />
      <main class="screen">
        <span class="dim">Ideias que atravessaram gerações, resumidas em palavras nossas. Cada uma vira uma ação no app.</span>
        {PRINCIPLES.map((p, i) => (
          <a key={p.id} class={'card' + (i === 0 ? ' hero' : '')} href={`#/aprender/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <b style={{ fontSize: '16px' }}>{p.title}</b><span>{p.idea}</span><span class="dim">{p.source}</span>
            <span class="blue" style={{ fontSize: '12px', fontWeight: 500 }}>No app: {p.inApp}</span>
          </a>
        ))}
        <span class="dim">Conteúdo educativo. Não é recomendação de investimento.</span>
      </main>
      <Tabbar active="aprender" />
    </>
  );
}

export function Principio({ id }: { id: string }) {
  const i = PRINCIPLES.findIndex((p) => p.id === id);
  const p = PRINCIPLES[i];
  if (!p) return <Aprender />;
  return (
    <>
      <Top sub={`Aprender · ${i + 1} de ${PRINCIPLES.length}`} back="#/aprender" />
      <main class="screen">
        <h1 style={{ margin: '0px', fontFamily: 'var(--display)', fontSize: '30px', lineHeight: 1.1 }}>{p.title}</h1>
        <span class="dim">{p.source}</span>
        {p.body.map((t, k) => <p key={k} style={{ margin: '0px', lineHeight: 1.6 }}>{t}</p>)}
        <section class="card"><h2>No Elev8 Finance</h2><span class="dim">{p.inApp}</span>{p.action && <a class="btn" href={p.action.href}>{p.action.label}</a>}</section>
        <div class="row">
          {i > 0 && <a class="btn ghost" href={`#/aprender/${PRINCIPLES[i - 1].id}`}>Anterior</a>}
          {i < PRINCIPLES.length - 1 && <a class="btn ghost" href={`#/aprender/${PRINCIPLES[i + 1].id}`}>Próximo</a>}
        </div>
        <span class="dim">Conteúdo educativo. Não é recomendação de investimento.</span>
      </main>
      <Tabbar active="aprender" />
    </>
  );
}

// ---------------------------------------------------------------- Lançamentos (lista e detalhe)
export function Lancamentos({ params }: { params: URLSearchParams }) {
  useSignalsAll();
  const [items, setItems] = useState<any[] | null>(null);
  const status = params.get('status');
  const categoryId = params.get('category_id');
  useEffect(() => {
    setItems(null);
    const q = new URLSearchParams({ month: month.value, ...(categoryId ? { category_id: categoryId } : {}) });
    if (status === 'draft') api('GET', '/purchases/recent?limit=50').then((r) => setItems(r.items.filter((p: any) => p.status === 'draft'))).catch(err);
    else api('GET', `/purchases?${q}`).then((r) => setItems(r.items)).catch(err);
  }, [month.value, status, categoryId]);
  const cat = categories.value.find((c) => c.id === categoryId);
  return (
    <>
      <Top sub={status === 'draft' ? 'Rascunhos' : cat ? cat.name : 'Lançamentos'} back="#/inicio" />
      <main class="screen">
        {status !== 'draft' && <MonthPicker />}
        {items === null ? <div class="dim">Carregando…</div> : items.length === 0 ? <div class="empty"><span class="dim">Nada por aqui em {monthName(month.value)}.</span><a class="btn" href="#/lancar">Lançar</a></div> : (
          <section class="card"><div class="list">{items.map((p) => <PurchaseRow key={p.id + (p.seq ?? '')} p={p} />)}</div></section>
        )}
      </main>
      <Tabbar active="inicio" />
    </>
  );
}

export function Lancamento({ id }: { id: string }) {
  useSignalsAll();
  const [p, setP] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [editCat, setEditCat] = useState(false);
  const load = () => api('GET', `/purchases/${id}`).then((r) => setP(r.purchase)).catch(err);
  useEffect(() => { load(); }, [id]);
  if (!p) return <><Top back="#/inicio" /><main class="screen dim">Carregando…</main></>;
  const cat = categories.value.find((c) => c.id === p.category_id);
  const acc = accounts.value.find((a) => a.id === p.account_id);
  const act = async (fn: () => Promise<any>, msg: string, goHome = false) => { try { await fn(); say(msg); refresh(); goHome ? (location.hash = '#/inicio') : load(); } catch (e) { err(e); } };
  return (
    <>
      <Top sub="Lançamento" back="#/lancamentos" />
      <main class="screen">
        <div><div class="big money">{brl(p.total_cents)}</div><div class="dim">{p.description ?? cat?.name}{p.status === 'cancelled' ? ' · cancelado' : p.status === 'draft' ? ' · rascunho' : ''}</div></div>
        <section class="card">
          <div class="kv"><span>Categoria</span><button class="chip" onClick={() => setEditCat(!editCat)}>{cat?.name ?? 'Escolher'}</button></div>
          {editCat && <div class="chips">{categories.value.filter((c) => (p.kind === 'income') === (c.group === 'income')).map((c) => <button key={c.id} class="chip" aria-pressed={c.id === p.category_id} onClick={() => { setEditCat(false); act(() => api('PATCH', `/purchases/${id}`, { category_id: c.id }), 'Categoria atualizada.'); }}>{c.name}</button>)}</div>}
          <div class="kv"><span>Data da compra</span><b>{dayLabel(p.purchase_date)}</b></div>
          <div class="kv"><span>Cartão ou conta</span><b>{acc?.name ?? 'Não informado'}</b></div>
          {p.recurring === 'monthly' && <div class="kv"><span>Repete</span><b>todo mês</b></div>}
          {p.tags.length > 0 && <div class="kv"><span>Tags</span><b>{p.tags.join(', ')}</b></div>}
        </section>
        {p.schedule.length > 1 && (
          <section class="card"><h2>Parcelas <small>{p.installments_total > 1 ? `${p.installments_total}x` : 'mensal'}</small></h2>
            <div class="list">{p.schedule.map((s: any) => <div key={s.seq} class="item" style={{ cursor: 'default' }}><span class="t"><b>{s.seq}ª · {monthName(s.month)}</b><span>{s.status === 'cancelled' ? 'cancelada' : 'conta neste mês'}</span></span><span class="v"><Money cents={s.amount_cents} /></span></div>)}</div></section>
        )}
        {p.status === 'draft' && <button class="btn" onClick={() => act(() => api('POST', `/purchases/${id}/confirm`), 'Confirmado.')}>Confirmar rascunho</button>}
        {p.status !== 'cancelled' && (
          <>
            <button class="btn ghost" onClick={() => act(() => api('POST', `/purchases/${id}/duplicate`, { idempotency_key: newKey() }), 'Cópia criada como rascunho de hoje.')}>Duplicar para hoje</button>
            {preview ? (
              <div class="ask"><h3>Cancelar o quê?</h3>
                {preview.future_count > 0 && <button class="btn ghost" onClick={() => act(() => api('POST', `/purchases/${id}/cancel`, { scope: 'future' }), 'Próximas parcelas canceladas.')}>Só as próximas: {preview.future_count} parcela(s), {brl(preview.future_cents)}</button>}
                <button class="btn danger" onClick={() => act(() => api('POST', `/purchases/${id}/cancel`, { scope: 'all' }), 'Lançamento cancelado.')}>Tudo: {preview.all_count} lançamento(s), {brl(preview.all_cents)}</button>
                <button class="btn link" onClick={() => setPreview(null)}>Voltar</button>
              </div>
            ) : <button class="btn ghost" onClick={() => api('GET', `/purchases/${id}/cancel-preview`).then(setPreview).catch(err)}>Cancelar…</button>}
          </>
        )}
        <button class="btn link" style={{ color: 'var(--bad)' }} onClick={() => { if (confirm('Apagar este lançamento de vez? Não dá para desfazer.')) act(() => api('DELETE', `/purchases/${id}`), 'Apagado.', true); }}>Apagar de vez</button>
      </main>
      <Tabbar active="inicio" />
    </>
  );
}

// ---------------------------------------------------------------- Ajustes
export function Ajustes() {
  useSignalsAll();
  const row = (href: string, title: string, sub: string) => (
    <a class="setting" href={href} style={{ textDecoration: 'none' }}><span class="t"><span>{title}</span><small>{sub}</small></span><span class="dim">›</span></a>
  );
  return (
    <>
      <Top sub="Ajustes" />
      <main class="screen">
        <section class="card" style={{ gap: '0px' }}>
          {row('#/ajustes/cartoes', 'Cartões e contas', accounts.value.map((a) => a.name).join(', ') || 'Cadastre seus cartões')}
          {row('#/ajustes/categorias', 'Categorias', `${categories.value.length} categorias · editar, ordenar, arquivar`)}
          {row('#/ajustes/orcamento', 'Orçamento do mês', 'Usado quando não há entrada lançada')}
          <div class="setting"><span class="t"><span>Modo discreto</span><small>Desfoca os valores na tela</small></span><button class="switch" role="switch" aria-checked={privateMode.value} aria-label="Modo discreto" onClick={() => setPrivate(!privateMode.value)} /></div>
          {row('#/ajustes/instalar', 'Instalar no iPhone e atalho da Siri', 'Tela inicial e “Lançar gasto” por voz')}
          {row('#/ajustes/sessoes', 'Aparelhos conectados', 'Ver e encerrar sessões')}
        </section>
        <section class="card" style={{ gap: '0px' }}>
          <a class="setting" href="/api/export.csv" download style={{ textDecoration: 'none' }}><span class="t"><span>Exportar meus dados (CSV)</span><small>Abre no Excel e no Google Planilhas</small></span><span class="dim">↓</span></a>
          <a class="setting" href="/api/export" download="elev8-finance.json" style={{ textDecoration: 'none' }}><span class="t"><span>Exportar tudo (JSON)</span><small>Cópia completa e legível</small></span><span class="dim">↓</span></a>
          <a class="setting" href="#/ajustes/excluir" style={{ textDecoration: 'none' }}><span class="t"><span style={{ color: 'var(--bad)' }}>Excluir conta e dados</span><small>Apaga tudo de forma definitiva</small></span><span class="dim">›</span></a>
        </section>
        <div class="row"><button class="btn ghost" onClick={() => logout()}>Sair</button><button class="btn ghost" onClick={() => logout(true)}>Sair de todos</button></div>
        <span class="dim" style={{ textAlign: 'center' }}>{user.value?.email} · elev8 finance beta · Developed by Elev8</span>
      </main>
      <Tabbar active="ajustes" />
    </>
  );
}

const KIND_LABEL: Record<string, string> = { credit: 'Crédito', debit: 'Débito', checking: 'Conta', cash: 'Dinheiro' };

export function Cartoes({ onboarding = false }: { onboarding?: boolean }) {
  useSignalsAll();
  const blank = { id: '', name: '', kind: 'credit', closing_day: '', due_day: '' };
  const [f, setF] = useState<any>(blank);
  const [busy, setBusy] = useState(false);
  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    const body: any = { name: f.name, kind: f.kind };
    if (f.kind === 'credit') { body.closing_day = Number(f.closing_day); body.due_day = Number(f.due_day); }
    try {
      await api(f.id ? 'PATCH' : 'POST', f.id ? `/accounts/${f.id}` : '/accounts', body);
      await loadLists();
      say(f.id ? 'Atualizado.' : 'Cadastrado.');
      setF(blank);
    } catch (x) { err(x); } finally { setBusy(false); }
  }
  return (
    <>
      <Top sub={onboarding ? 'Primeiro acesso · 1 de 2' : 'Cartões e contas'} back={onboarding ? undefined : '#/ajustes'} />
      <main class="screen">
        {onboarding && <div><h1 class="mid" style={{ margin: '0px' }}>Seus cartões e contas</h1><span class="dim">Com o fechamento e o vencimento, cada parcela cai no mês certo do painel.</span></div>}
        {accounts.value.length > 0 && (
          <section class="card"><div class="list">{accounts.value.map((a) => (
            <button key={a.id} class="item" onClick={() => setF({ id: a.id, name: a.name, kind: a.kind, closing_day: a.closing_day ?? '', due_day: a.due_day ?? '' })}>
              <span class="t"><b>{a.name}</b><span>{KIND_LABEL[a.kind]}{a.kind === 'credit' ? ` · fecha dia ${a.closing_day}, vence dia ${a.due_day}` : ''}</span></span><span class="dim">editar</span>
            </button>))}</div></section>
        )}
        <form class="card" onSubmit={save}>
          <h2>{f.id ? 'Editar' : 'Adicionar'}</h2>
          <label class="f">Nome<input class="input" required maxLength={60} placeholder="Cartão XP, Nubank, Pix…" value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></label>
          <div class="chips">{Object.entries(KIND_LABEL).map(([k, l]) => <button type="button" key={k} class="chip" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
          {f.kind === 'credit' && (
            <div class="grid2">
              <label class="f">Dia do fechamento<input class="input" type="number" inputMode="numeric" min={1} max={31} required value={f.closing_day} onInput={(e) => setF({ ...f, closing_day: (e.target as HTMLInputElement).value })} /></label>
              <label class="f">Dia do vencimento<input class="input" type="number" inputMode="numeric" min={1} max={31} required value={f.due_day} onInput={(e) => setF({ ...f, due_day: (e.target as HTMLInputElement).value })} /></label>
            </div>
          )}
          {f.id && <span class="dim">Mudar os dias não move parcelas já lançadas.</span>}
          <button class="btn" disabled={busy}>{f.id ? 'Salvar' : 'Adicionar'}</button>
          {f.id && <button type="button" class="btn link" onClick={async () => { await api('PATCH', `/accounts/${f.id}`, { archived: true }).catch(err); await loadLists(); setF(blank); }}>Arquivar</button>}
        </form>
        {onboarding && <a class="btn ghost" href="#/ajustes/instalar?onboarding=1">{accounts.value.length ? 'Continuar' : 'Pular por agora'}</a>}
      </main>
      {!onboarding && <Tabbar active="ajustes" />}
    </>
  );
}

const GROUP_LABEL: Record<string, string> = { need: 'Essencial', want: 'Desejo', save: 'Guardar', income: 'Receita', transfer: 'Transferência' };

export function Categorias() {
  useSignalsAll();
  const [editing, setEditing] = useState<any>(null);
  async function save() {
    try {
      if (editing.id) await api('PATCH', `/categories/${editing.id}`, { name: editing.name, group: editing.group });
      else await api('POST', '/categories', { name: editing.name, group: editing.group });
      await loadLists(); setEditing(null); say('Salvo.');
    } catch (e) { err(e); }
  }
  return (
    <>
      <Top sub="Categorias" back="#/ajustes" />
      <main class="screen">
        <button class="btn ghost" onClick={() => setEditing({ name: '', group: 'want' })}>Nova categoria</button>
        {editing && (
          <section class="card">
            <label class="f">Nome<input class="input" maxLength={60} value={editing.name} onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })} /></label>
            <div class="chips">{Object.entries(GROUP_LABEL).map(([k, l]) => <button key={k} class="chip" aria-pressed={editing.group === k} onClick={() => setEditing({ ...editing, group: k })}>{l}</button>)}</div>
            <div class="row"><button class="btn" onClick={save}>Salvar</button>{editing.id && <button class="btn ghost" onClick={async () => { await api('PATCH', `/categories/${editing.id}`, { archived: true }).catch(err); await loadLists(); setEditing(null); }}>Arquivar</button>}</div>
          </section>
        )}
        <section class="card"><div class="list">{categories.value.map((c) => (
          <button key={c.id} class="item" onClick={() => setEditing({ ...c })}><span class="t"><b>{c.name}</b><span>{GROUP_LABEL[c.group]}</span></span><span class="dim">editar</span></button>
        ))}</div></section>
        <span class="dim">Arquivar esconde a categoria dos novos lançamentos e mantém o histórico.</span>
      </main>
      <Tabbar active="ajustes" />
    </>
  );
}

export function Orcamento() {
  const [v, setV] = useState('');
  useEffect(() => { api('GET', `/budgets/${month.value}`).then((r) => setV(r.amount_cents ? String(r.amount_cents / 100).replace('.', ',') : '')).catch(err); }, []);
  return (
    <>
      <Top sub="Orçamento" back="#/ajustes" />
      <main class="screen">
        <span class="dim">Quanto você quer gastar por mês, no máximo. Vale para {monthName(month.value)} e para os meses seguintes até você mudar.</span>
        <input class="amount" inputMode="decimal" placeholder="R$ 0,00" value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
        <button class="btn" onClick={async () => { const c = toCents(v.replace(/\s/g, '')); if (!c) return say('Valor inválido.'); try { await api('PUT', `/budgets/${month.value}`, { amount_cents: c }); say('Orçamento salvo.'); refresh(); } catch (e) { err(e); } }}>Salvar</button>
      </main>
      <Tabbar active="ajustes" />
    </>
  );
}

export function Sessoes() {
  const [list, setList] = useState<any[] | null>(null);
  const load = () => api('GET', '/auth/sessions').then((r) => setList(r.sessions)).catch(err);
  useEffect(() => { load(); }, []);
  return (
    <>
      <Top sub="Aparelhos conectados" back="#/ajustes" />
      <main class="screen">
        <section class="card"><div class="list">{(list ?? []).map((s) => (
          <div key={s.id} class="item" style={{ cursor: 'default' }}>
            <span class="t"><b>{s.device_label ?? 'Aparelho'}{s.current ? ' · este' : ''}</b><span>desde {new Date(s.created_at.replace(' ', 'T')).toLocaleDateString('pt-BR')}</span></span>
            {!s.current && <button class="chip" onClick={() => api('DELETE', `/sessions/${s.id}`).then(load).catch(err)}>Encerrar</button>}
          </div>))}</div></section>
        <button class="btn ghost" onClick={() => logout(true)}>Sair de todos os aparelhos</button>
      </main>
      <Tabbar active="ajustes" />
    </>
  );
}

export function Excluir() {
  const [pw, setPw] = useState('');
  return (
    <>
      <Top sub="Excluir conta" back="#/ajustes" />
      <main class="screen">
        <span>Isso apaga sua conta, cartões, categorias, lançamentos e orçamentos de forma definitiva. Antes, se quiser, <a href="/api/export.csv" download>exporte seus dados</a>.</span>
        <label class="f">Digite sua senha para confirmar<input class="input" type="password" autoComplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} /></label>
        <button class="btn danger" disabled={!pw} onClick={async () => { try { await api('POST', '/me/delete', { password: pw }); await logout(); say('Conta excluída.'); } catch (e) { err(e); } }}>Excluir tudo de vez</button>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- Instalar no iPhone + atalho da Siri
export function Instalar({ params }: { params: URLSearchParams }) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
  const [other, setOther] = useState(!ios);
  const onboarding = params.get('onboarding') === '1';
  const url = `${location.origin}/#/lancar?t=`;
  const step = (n: number, title: string, text: string) => <div class="step"><i>{n}</i><div><b>{title}</b><div class="dim">{text}</div></div></div>;
  return (
    <>
      <Top sub={onboarding ? 'Primeiro acesso · 2 de 2' : 'Instalar'} back={onboarding ? undefined : '#/ajustes'} />
      <main class="screen">
        <div class="row" style={{ alignItems: 'center' }}>
          <img src="/icons/icon-192.png" alt="" style={{ width: '72px', height: '72px', borderRadius: '17px', flex: 'none' }} />
          <div><h1 class="mid" style={{ margin: '0px' }}>{standalone ? 'App instalado' : 'Instale no seu iPhone'}</h1><span class="dim">{standalone ? 'Você já está usando pela tela inicial.' : 'Abre como app, em tela cheia.'}</span></div>
        </div>
        {!standalone && !other && (
          <section class="card">
            {step(1, 'Abra no Safari', 'No iPhone, a instalação funciona pelo Safari.')}
            {step(2, 'Toque em Compartilhar', 'O quadrado com a seta para cima, na barra do Safari.')}
            {step(3, 'Adicionar à Tela de Início', 'Role a lista se não aparecer de cara. Depois, toque em Adicionar.')}
            {step(4, 'Abra pelo ícone', 'A partir daí, use sempre o ícone da tela inicial.')}
          </section>
        )}
        {!standalone && other && (
          <section class="card">
            {step(1, 'Android (Chrome)', 'Menu ⋮ › Instalar app ou Adicionar à tela inicial.')}
            {step(2, 'Computador (Chrome ou Edge)', 'Ícone de instalar na barra de endereço.')}
          </section>
        )}
        <button class="btn link" onClick={() => setOther(!other)}>{other ? 'Ver instruções para iPhone' : 'Ver instruções para Android ou computador'}</button>
        <section class="card"><h2>Atalho da Siri: “Lançar gasto”</h2>
          {step(1, 'Abra o app Atalhos', 'Toque em + para criar um atalho.')}
          {step(2, 'Adicione “Ditar Texto”', 'Idioma: Português (Brasil).')}
          {step(3, 'Adicione “Abrir URLs”', 'Cole o endereço abaixo e, no fim, insira a variável “Texto Ditado”.')}
          <code style={{ background: 'var(--surf2)', padding: '10px', borderRadius: '10px', fontSize: '12px', wordBreak: 'break-all' }}>{url}</code>
          <button class="btn ghost" onClick={() => navigator.clipboard?.writeText(url).then(() => say('Endereço copiado.'))}>Copiar endereço</button>
          {step(4, 'Dê o nome “Lançar gasto”', 'Depois é só dizer: “E aí Siri, lançar gasto”. O app abre com o rascunho pronto.')}
        </section>
        <div class="banner info" style={{ cursor: 'default' }}><span>No iPhone, notificações só funcionam com o app instalado na tela inicial e com a sua permissão. Elas chegam em dezembro.</span></div>
        {onboarding && <a class="btn" href="#/inicio" onClick={finishOnboarding}>Começar</a>}
      </main>
      {!onboarding && <Tabbar active="ajustes" />}
    </>
  );
}

export { Icon, ApiError };
