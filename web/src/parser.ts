/**
 * Turns a sentence ("Cadeira 480 em 4x cartão XP casa") into a draft. Runs entirely on the phone:
 * no AI service, nothing leaves the device until the person confirms.
 * Never guesses on relevant ambiguity: it lists what is missing so the app asks only that field.
 */

export type Kind = 'expense' | 'income' | 'saving' | 'transfer' | 'invoice_payment' | 'refund' | 'investment';

export interface AccountRef { id: string; name: string; kind: 'credit' | 'debit' | 'checking' | 'cash' }
export interface CategoryRef { id: string; name: string; group: 'need' | 'want' | 'save' | 'income' | 'transfer' }

export type Missing =
  | { field: 'amount' }
  | { field: 'amount_choice'; options: number[] }
  | { field: 'account'; options: AccountRef[] }
  | { field: 'category'; options: CategoryRef[] };

export interface Draft {
  kind: Kind;
  amount_cents: number | null;
  purchase_date: string;           // YYYY-MM-DD
  installments: number;
  recurring: 'none' | 'monthly';
  account_id: string | null;
  category_id: string | null;
  description: string | null;
  merchant: string | null;
  tags: string[];
  missing: Missing[];
}

export const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Merchant/word hints → default category name. Only used when the person did not name a category. */
const HINTS: Array<[RegExp, string]> = [
  [/\b(uber|99|taxi|onibus|metro|gasolina|posto|combustivel|estacionamento|pedagio)\b/, 'Transporte'],
  [/\b(mercado|supermercado|atacadao|assai|carrefour|feira|hortifruti|padaria|acougue)\b/, 'Alimentação em casa'],
  [/\b(ifood|restaurante|lanche|lanchonete|pizza|hamburguer|bar|cafe|almoco|jantar|rappi)\b/, 'Comida fora'],
  [/\b(academia|farmacia|drogaria|medico|consulta|exame|dentista|remedio)\b/, 'Saúde'],
  [/\b(netflix|spotify|youtube|prime|disney|hbo|max|icloud|assinatura|chatgpt)\b/, 'Assinaturas'],
  [/\b(aluguel|condominio|iptu)\b/, 'Moradia'],
  [/\b(luz|energia|agua|internet|celular|telefone|gas)\b/, 'Contas e serviços'],
  [/\b(cinema|show|viagem|passeio|ingresso)\b/, 'Lazer'],
  [/\b(curso|faculdade|livro|mba|escola)\b/, 'Educação'],
  [/\b(salario|pagamento do mes)\b/, 'Salário'],
  [/\b(freela|freelance|bico|extra)\b/, 'Renda extra'],
];

const KIND_WORDS: Array<[RegExp, Kind]> = [
  [/^(recebi|ganhei|entrou|caiu)\b/, 'income'],
  [/^(guardei|poupei|separei|reservei)\b/, 'saving'],
  [/^(investi|apliquei)\b/, 'investment'],
  [/^(transferi|passei)\b/, 'transfer'],
  [/^paguei (a )?fatura\b/, 'invoice_payment'],
  [/^(reembolso|estorno|me devolveram|devolveram)\b/, 'refund'],
];

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600,
  setecentos: 700, oitocentos: 800, novecentos: 900,
};

/** "quarenta e oito reais e cinquenta" → "48,50" (voice often spells numbers out). */
export function wordsToDigits(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!(tokens[i] in UNITS) && tokens[i] !== 'mil') {
      out.push(tokens[i]);
      i++;
      continue;
    }
    let total = 0;
    let chunk = 0;
    let j = i;
    let used = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t in UNITS) { chunk += UNITS[t]; used = true; j++; continue; }
      if (t === 'mil') { total += (chunk || 1) * 1000; chunk = 0; used = true; j++; continue; }
      if (t === 'e' && j + 1 < tokens.length && (tokens[j + 1] in UNITS)) { j++; continue; }
      break;
    }
    if (!used) { out.push(tokens[i]); i++; continue; }
    let value = String(total + chunk);
    // "... reais e cinquenta (centavos)"
    if (tokens[j] === 'reais' && tokens[j + 1] === 'e' && tokens[j + 2] in UNITS) {
      let cents = 0;
      let k = j + 2;
      while (k < tokens.length && (tokens[k] in UNITS || (tokens[k] === 'e' && tokens[k + 1] in UNITS))) {
        if (tokens[k] !== 'e') cents += UNITS[tokens[k]];
        k++;
      }
      if (tokens[k] === 'centavos') k++;
      value += ',' + String(cents).padStart(2, '0');
      j = k;
    } else if (tokens[j] === 'reais') {
      j++;
    }
    out.push(value);
    i = j;
  }
  return out.join(' ');
}

/** "1.200,50" | "28,50" | "480" | "28.5" → cents. */
export function toCents(raw: string): number | null {
  let s = raw.replace(/^r\$/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s)) { /* already decimal */ }
  else if (!/^\d+$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function resolveDate(words: string[], today: Date): { date: string; used: Set<number> } {
  const used = new Set<number>();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'hoje') { used.add(i); return { date: iso(d), used }; }
    if (w === 'ontem') { used.add(i); d.setDate(d.getDate() - 1); return { date: iso(d), used }; }
    if (w === 'anteontem') { used.add(i); d.setDate(d.getDate() - 2); return { date: iso(d), used }; }
    const wd = WEEKDAYS.indexOf(w.replace(/-feira$/, ''));
    if (wd >= 0) {
      used.add(i);
      if (words[i - 1] === 'na' || words[i - 1] === 'no' || words[i - 1] === 'ultima' || words[i - 1] === 'ultimo') used.add(i - 1);
      const back = (d.getDay() - wd + 7) % 7;
      d.setDate(d.getDate() - back);
      return { date: iso(d), used };
    }
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
    if (m) {
      used.add(i);
      if (words[i - 1] === 'dia' || words[i - 1] === 'em') used.add(i - 1);
      let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : d.getFullYear();
      const cand = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && cand > d) y -= 1; // "05/12" in January means last December
      return { date: iso(new Date(y, Number(m[2]) - 1, Number(m[1]))), used };
    }
    if (w === 'dia' && /^\d{1,2}$/.test(words[i + 1] ?? '')) {
      used.add(i); used.add(i + 1);
      const day = Number(words[i + 1]);
      const cand = new Date(d.getFullYear(), d.getMonth(), day);
      if (cand > d) cand.setMonth(cand.getMonth() - 1);
      return { date: iso(cand), used };
    }
  }
  return { date: iso(d), used };
}

export function parse(text: string, accounts: AccountRef[], categories: CategoryRef[], today = new Date()): Draft {
  let t = norm(text).replace(/r\$\s*/g, 'r$');
  t = wordsToDigits(t);
  const draft: Draft = {
    kind: 'expense', amount_cents: null, purchase_date: iso(today), installments: 1, recurring: 'none',
    account_id: null, category_id: null, description: null, merchant: null, tags: [], missing: [],
  };

  for (const [re, kind] of KIND_WORDS) {
    const m = re.exec(t);
    if (m) { draft.kind = kind; t = t.slice(m[0].length).trim(); break; }
  }

  // Recurrence
  const rec = /\b(recorrente|todo mes|todos os meses|mensal|mensalmente|por mes)\b/;
  if (rec.test(t)) { draft.recurring = 'monthly'; t = t.replace(new RegExp(rec, 'g'), ' '); }

  // Installments: "4x", "em 4x", "em 4 vezes", "parcelado em 4", "4 parcelas"
  const inst = /\b(?:em |parcelad[oa] em )?(\d{1,2}) ?(?:x|vezes|parcelas)\b|\bparcelad[oa] em (\d{1,2})\b/;
  const im = inst.exec(t);
  if (im) { draft.installments = Math.max(1, Number(im[1] ?? im[2])); t = t.replace(im[0], ' '); }
  t = t.replace(/\b(a vista|à vista)\b/, ' ');

  // Category named explicitly (longest names first: "alimentacao em casa" before "casa")
  const cats = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const c of cats) {
    const n = norm(c.name);
    const re = new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|$)`);
    if (re.test(t)) { draft.category_id = c.id; t = t.replace(re, ' '); break; }
  }

  // Account: by name ("cartao xp", "no nubank"), or by type word (pix, debito, dinheiro)
  const accs = [...accounts].sort((a, b) => b.name.length - a.name.length);
  for (const a of accs) {
    const n = norm(a.name).replace(/^cartao /, '');
    const re = new RegExp(`(^|\\s)(?:no |na |pelo |pela |cartao )?(?:cartao )?${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|$)`);
    if (re.test(t)) { draft.account_id = a.id; t = t.replace(re, ' '); break; }
  }
  if (!draft.account_id) {
    const typeWords: Array<[RegExp, AccountRef['kind'][]]> = [[/\b(no |via )?pix\b|\b(no )?debito\b/, ['debit', 'checking']], [/\b(em |no )?dinheiro\b/, ['cash']]];
    for (const [re, kinds] of typeWords) {
      if (re.test(t)) {
        const match = accounts.filter((a) => kinds.includes(a.kind));
        if (match.length === 1) draft.account_id = match[0].id;
        t = t.replace(re, ' ');
        break;
      }
    }
  }
  t = t.replace(/\b(no )?cartao\b/, ' ');

  let words = t.split(' ').filter(Boolean);
  const { date, used } = resolveDate(words, today);
  draft.purchase_date = date;
  words = words.filter((_, i) => !used.has(i));

  // Amounts: every money-looking token that is not a day or installment count
  const amounts: Array<{ i: number; cents: number }> = [];
  words.forEach((w, i) => {
    if (w === 'ou' || w === 'reais') return;
    const c = toCents(w);
    if (c !== null) amounts.push({ i, cents: c });
  });
  const firstAmountAt = amounts.length ? amounts[0].i : words.length;
  const distinct = [...new Set(amounts.map((a) => a.cents))];
  if (distinct.length === 1) draft.amount_cents = distinct[0];
  else if (distinct.length > 1) draft.missing.push({ field: 'amount_choice', options: distinct.slice(0, 3) });
  else draft.missing.push({ field: 'amount' });
  const amountIdx = new Set(amounts.map((a) => a.i));

  const filler = new Set(['de', 'do', 'da', 'no', 'na', 'em', 'com', 'pra', 'para', 'o', 'a', 'um', 'uma', 'e', 'ou', 'reais', 'gastei', 'comprei', 'paguei', 'foi']);
  const before = words.filter((w, i) => i < firstAmountAt && !amountIdx.has(i) && !filler.has(w));
  const after = words.filter((w, i) => i > firstAmountAt && !amountIdx.has(i) && !filler.has(w));
  // Give back the person's own spelling (accents, capitals) for the words we keep.
  const original = text.trim().split(/\s+/);
  const restore = (w: string) => original.find((o) => norm(o).replace(/[^\p{L}\p{N}]/gu, '') === w) ?? w;
  const cap = (s: string) => s.split(' ').map(restore).join(' ').replace(/^./, (c) => c.toUpperCase());
  if (before.length) {
    draft.description = cap(before.join(' '));
    draft.merchant = cap(before[0]);
  } else if (after.length) {
    draft.description = cap(after.join(' '));
    draft.merchant = cap(after[0]);
  }
  if (before.length) draft.tags = after.filter((w) => w.length > 1 && !/^\d+$/.test(w)).slice(0, 5);

  // Category from hints when not named
  if (!draft.category_id) {
    const hay = norm(text);
    for (const [re, name] of HINTS) {
      if (re.test(hay)) {
        const c = categories.find((x) => norm(x.name) === norm(name));
        if (c && (draft.kind === 'income') === (c.group === 'income')) { draft.category_id = c.id; break; }
      }
    }
  }
  const pool = categories.filter((c) => (draft.kind === 'income' ? c.group === 'income' : c.group === 'need' || c.group === 'want'));
  if (!draft.category_id && draft.kind === 'expense') draft.missing.push({ field: 'category', options: pool });

  // Installments need a card to know which invoice each one falls in
  if (draft.installments > 1 && !draft.account_id) {
    const cards = accounts.filter((a) => a.kind === 'credit');
    if (cards.length === 1) draft.account_id = cards[0].id;
    else draft.missing.push({ field: 'account', options: cards.length ? cards : accounts });
  }
  if (draft.kind !== 'expense') draft.installments = 1;
  return draft;
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
