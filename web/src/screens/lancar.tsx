import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, ApiError, newKey, queue } from '../api';
import { brl, iso, parse, toCents, type Draft, type Kind } from '../parser';
import { accounts, categories, queued, refresh, say, useSignalsAll } from '../store';
import { Icon, Money, Tabbar, Top, dayLabel } from '../ui';

type Mode = 'expense' | 'income' | 'saving';
const SpeechRec: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

/** Lançar: one sentence, the voice, or the fields. Nothing is saved until "Confirmar". */
export function Lancar({ params }: { params: URLSearchParams }) {
  useSignalsAll();
  const initialMode = (params.get('tipo') as Mode) || 'expense';
  const [mode, setMode] = useState<Mode>(['expense', 'income', 'saving'].includes(initialMode) ? initialMode : 'expense');
  const [amount, setAmount] = useState('');
  const [phrase, setPhrase] = useState(params.get('t') ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(iso(new Date()));
  const [installments, setInstallments] = useState(1);
  const [recurring, setRecurring] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const cats = useMemo(() => categories.value.filter((c) => (mode === 'income' ? c.group === 'income' : mode === 'saving' ? c.group === 'save' : c.group !== 'income' && c.group !== 'save' && c.group !== 'transfer')), [mode, categories.value]);

  // Siri shortcut opens #/lancar?t=texto: go straight to the draft.
  useEffect(() => { if (params.get('t')) review(); }, []);

  function review() {
    const base = phrase.trim() ? parse(phrase, accounts.value, categories.value) : parse('', accounts.value, categories.value);
    const manualCents = amount ? toCents(amount.replace(/\s/g, '').replace(/^r\$/i, '')) : null;
    const d: Draft = {
      ...base,
      kind: phrase.trim() && base.kind !== 'expense' ? base.kind : (mode as Kind),
      amount_cents: manualCents ?? base.amount_cents,
      category_id: categoryId ?? base.category_id,
      account_id: accountId ?? base.account_id,
      purchase_date: date !== iso(new Date()) ? date : base.purchase_date,
      installments: installments > 1 ? installments : base.installments,
      recurring: recurring ? 'monthly' : base.recurring,
    };
    d.missing = base.missing.filter((m) =>
      (m.field === 'amount' || m.field === 'amount_choice') ? d.amount_cents === null
        : m.field === 'category' ? d.category_id === null && d.kind === 'expense'
          : m.field === 'account' ? d.account_id === null : true);
    if (d.amount_cents === null && !d.missing.some((m) => m.field.startsWith('amount'))) d.missing.unshift({ field: 'amount' });
    if (d.kind !== 'expense') d.missing = d.missing.filter((m) => m.field !== 'category');
    setDraft(d);
    // Learnt suggestion from this person's own past choices
    if (!d.category_id && d.merchant) {
      api('GET', `/categories/suggest?merchant=${encodeURIComponent(d.merchant)}`).then((r) => {
        if (r.category_id) setDraft((cur) => cur && { ...cur, category_id: r.category_id, missing: cur.missing.filter((m) => m.field !== 'category') });
      }).catch(() => undefined);
    }
  }

  function startVoice() {
    if (!SpeechRec) return;
    if (!localStorage.getItem('e8f_voice_ok')) {
      const ok = confirm('O reconhecimento de voz é do próprio navegador: no Chrome o áudio passa pelos servidores do Google e no iPhone pelos da Apple. O Elev8 Finance só recebe o texto, e nada é salvo sem você confirmar. Continuar?');
      if (!ok) return;
      localStorage.setItem('e8f_voice_ok', '1');
    }
    const rec = new SpeechRec();
    rec.lang = 'pt-BR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => setPhrase(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => { setListening(false); say('Não consegui ouvir. Tente de novo ou escreva.'); };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function reset() {
    setAmount(''); setPhrase(''); setCategoryId(null); setAccountId(null); setDate(iso(new Date())); setInstallments(1); setRecurring(false); setDraft(null);
  }

  const yesterday = iso(new Date(Date.now() - 864e5));
  return (
    <>
      <Top sub="Lançar" />
      <main class="screen">
        <div class="seg" role="tablist" aria-label="Tipo de lançamento">
          {([['expense', 'Saiu'], ['income', 'Entrou'], ['saving', 'Guardei']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setCategoryId(null); }}>{l}</button>
          ))}
        </div>
        <label class="f">Valor
          <input class="amount" inputMode="decimal" placeholder="R$ 0,00" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
        </label>
        <label class="f">Ou escreva como você falaria
          <div class="phrase">
            <input class="input" value={phrase} placeholder={mode === 'income' ? 'Recebi 4200 salário' : 'Uber 28,50 hoje'} onInput={(e) => setPhrase((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') review(); }} />
            {SpeechRec && <button class={'mic' + (listening ? ' on' : '')} aria-label={listening ? 'Ouvindo' : 'Falar o lançamento'} onClick={() => (listening ? recRef.current?.stop() : startVoice())}><Icon name="mic" color={listening ? '#fff' : '#3D8BFF'} /></button>}
          </div>
        </label>
        <div class="f dim">Categoria
          <div class="chips scroll">{cats.map((c) => <button key={c.id} class="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>{c.name}</button>)}</div>
        </div>
        {accounts.value.length > 0 && (
          <div class="f dim">{mode === 'income' ? 'Entrou em' : 'Pagamento'}
            <div class="chips scroll">{accounts.value.map((a) => <button key={a.id} class="chip" aria-pressed={accountId === a.id} onClick={() => setAccountId(accountId === a.id ? null : a.id)}>{a.name}</button>)}</div>
          </div>
        )}
        <div class="f dim">Quando
          <div class="chips">
            <button class="chip" aria-pressed={date === iso(new Date())} onClick={() => setDate(iso(new Date()))}>Hoje</button>
            <button class="chip" aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>Ontem</button>
            <input class="chip" type="date" aria-label="Outra data" value={date} max={iso(new Date(Date.now() + 365 * 864e5))} onInput={(e) => setDate((e.target as HTMLInputElement).value || iso(new Date()))} />
          </div>
        </div>
        {mode === 'expense' && (
          <div class="row">
            <label class="f">Parcelas
              <select class="input" value={installments} onChange={(e) => setInstallments(Number((e.target as HTMLSelectElement).value))}>
                {Array.from({ length: 24 }, (_, i) => <option key={i} value={i + 1}>{i === 0 ? 'À vista' : `${i + 1}x`}</option>)}
              </select>
            </label>
            <label class="f">Todo mês
              <button class="switch" role="switch" aria-checked={recurring} aria-label="Repetir todo mês" onClick={() => { setRecurring(!recurring); setInstallments(1); }} />
            </label>
          </div>
        )}
        <button class="btn" onClick={review} disabled={!amount && !phrase.trim()}>Revisar lançamento</button>
        {queued.value > 0 && <div class="banner info"><span>{queued.value} lançamento(s) esperando internet para sincronizar.</span><Icon name="wifi" /></div>}
      </main>
      {draft && <DraftSheet draft={draft} setDraft={setDraft} source={phrase.trim() ? (listening ? 'voice' : 'text') : 'manual'} phrase={phrase} onDone={() => { reset(); location.hash = '#/inicio'; }} onClose={() => setDraft(null)} />}
      <Tabbar active="lancar" />
    </>
  );
}

const KIND_LABEL: Record<string, string> = { expense: 'Saiu', income: 'Entrou', saving: 'Guardei', investment: 'Investi', transfer: 'Transferência', invoice_payment: 'Pagamento de fatura', refund: 'Reembolso' };

function DraftSheet({ draft, setDraft, phrase, source, onDone, onClose }: { draft: Draft; setDraft: (d: Draft) => void; phrase: string; source: 'manual' | 'text' | 'voice'; onDone: () => void; onClose: () => void }) {
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [dupOf, setDupOf] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const ask = draft.missing[0];
  const cat = categories.value.find((c) => c.id === draft.category_id);
  const acc = accounts.value.find((a) => a.id === draft.account_id);
  const per = draft.amount_cents && draft.installments > 1 ? Math.floor(draft.amount_cents / draft.installments) : null;

  const answer = (patch: Partial<Draft>, field: string) => setDraft({ ...draft, ...patch, missing: draft.missing.filter((m) => !m.field.startsWith(field)) });

  async function confirm(allowDuplicate = false) {
    if (!draft.amount_cents) return;
    setBusy(true);
    const body = {
      idempotency_key: key, kind: draft.kind, status: 'confirmed', origin: source, total_cents: draft.amount_cents, purchase_date: draft.purchase_date,
      installments: draft.installments, recurring: draft.recurring, account_id: draft.account_id, category_id: draft.category_id,
      description: draft.description, merchant: draft.merchant, tags: draft.tags, ...(allowDuplicate ? { allow_duplicate: true } : {}),
    };
    try {
      await api('POST', '/purchases', body);
      say('Lançado.');
      refresh();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'probable_duplicate') setDupOf(String(e.details?.existing_id ?? ''));
      else if (e instanceof ApiError && (e.code === 'offline' || e.status >= 500)) {
        await queue.add(body);
        queued.value = queued.value + 1;
        say('Sem conexão: guardado no aparelho. Envio quando a internet voltar.');
        onDone();
      } else say(e instanceof Error ? e.message : 'Não foi possível lançar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="Rascunho do lançamento">
        <div class="dim">Rascunho · nada foi salvo ainda</div>
        {phrase && <div class="card" style={{ padding: '14px' }}><span class="dim">Você {source === 'voice' ? 'falou' : 'escreveu'}</span><span>“{phrase}”</span></div>}

        {ask?.field === 'amount' && (
          <div class="ask"><h3>Qual foi o valor?</h3>
            <div class="phrase"><input class="input" inputMode="decimal" placeholder="R$ 0,00" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
              <button class="btn" style={{ width: '96px' }} onClick={() => { const c = toCents(typed.replace(/\s/g, '')); if (c) answer({ amount_cents: c }, 'amount'); }}>OK</button></div>
          </div>
        )}
        {ask?.field === 'amount_choice' && (
          <div class="ask"><h3>Foi {ask.options.map((o) => brl(o)).join(' ou ')}?</h3>
            <div class="row">{ask.options.map((o) => <button key={o} class="btn ghost" onClick={() => answer({ amount_cents: o }, 'amount')}>{brl(o)}</button>)}</div>
            <button class="btn link" onClick={() => setDraft({ ...draft, missing: [{ field: 'amount' }, ...draft.missing.filter((m) => !m.field.startsWith('amount'))] })}>Outro valor</button>
          </div>
        )}
        {!ask?.field.startsWith('amount') && ask?.field === 'account' && (
          <div class="ask"><h3>{draft.installments > 1 ? 'Parcelado em qual cartão?' : 'Em qual conta?'}</h3>
            <div class="chips">{ask.options.map((a) => <button key={a.id} class="chip" onClick={() => answer({ account_id: a.id }, 'account')}>{a.name}</button>)}</div>
            {ask.options.length === 0 && <a class="btn ghost" href="#/ajustes/cartoes">Cadastrar um cartão</a>}
          </div>
        )}
        {ask?.field === 'category' && (
          <div class="ask"><h3>Qual categoria?</h3>
            <div class="chips">{ask.options.filter((c) => c.group !== 'income' && c.group !== 'transfer').map((c) => <button key={c.id} class="chip" onClick={() => answer({ category_id: c.id }, 'category')}>{c.name}</button>)}</div>
          </div>
        )}

        {!ask && draft.amount_cents !== null && (
          <>
            <div><div class="big money">{brl(draft.amount_cents)}</div>
              <div class="dim">{KIND_LABEL[draft.kind]}{per ? ` · ${draft.installments} parcelas de ${brl(per)}` : ''}{draft.recurring === 'monthly' ? ' · todo mês' : ''}</div></div>
            <div>
              {draft.description && <div class="kv"><span>Descrição</span><b>{draft.description}</b></div>}
              <div class="kv"><span>Categoria</span><b>{cat?.name ?? '—'}</b></div>
              <div class="kv"><span>{draft.kind === 'income' ? 'Entrou em' : 'Pagamento'}</span><b>{acc?.name ?? 'Não informado'}</b></div>
              <div class="kv"><span>Data</span><b>{dayLabel(draft.purchase_date)}</b></div>
              {acc?.kind === 'credit' && <div class="kv"><span>Fatura</span><b>conforme o fechamento do {acc.name}</b></div>}
              {draft.tags.length > 0 && <div class="kv"><span>Tags</span><b>{draft.tags.join(', ')}</b></div>}
            </div>
            {dupOf !== null ? (
              <div class="ask"><h3>Parece que você já lançou isso agora há pouco.</h3>
                <div class="row"><button class="btn" onClick={() => confirm(true)} disabled={busy}>Lançar mesmo assim</button><button class="btn ghost" onClick={onClose}>Não lançar</button></div>
              </div>
            ) : (
              <>
                <button class="btn" onClick={() => confirm()} disabled={busy}><Icon name="check" color="#fff" />{busy ? 'Lançando…' : 'Confirmar'}</button>
                <div class="row"><button class="btn ghost" onClick={onClose}>Editar</button><button class="btn ghost" onClick={() => { onClose(); location.hash = '#/inicio'; }}>Cancelar</button></div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
