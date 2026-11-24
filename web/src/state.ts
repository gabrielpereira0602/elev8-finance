import { signal, computed } from './signal';
import { api, ApiError, flushQueue, queue, setCsrf } from './api';
import type { AccountRef, CategoryRef } from './parser';

export interface User { id: string; email: string; display_name: string | null }
export interface Summary {
  month: string; income_cents: number; spent_cents: number; refunds_cents: number; saved_cents: number; balance_cents: number;
  pending_cents: number; reimbursable_cents: number; drafts: number; expense_count: number; average_cents: number; previous_spent_cents: number;
  budget_cents: number | null; budget_used_pct: number | null; groups: { need: number; want: number; other: number };
  by_category: { id: string | null; name: string; group: string | null; cents: number }[];
  by_account: { id: string | null; name: string; kind: string | null; cents: number }[];
  daily: { day: string; cents: number }[];
  can_spend: { basis: 'income' | 'budget' | 'none'; left_cents: number | null; per_day_cents: number | null; days_left: number | null };
}

const ym = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const user = signal<User | null | undefined>(undefined);
export const accounts = signal<(AccountRef & { closing_day: number | null; due_day: number | null })[]>([]);
export const categories = signal<CategoryRef[]>([]);
export const month = signal(ym());
export const summary = signal<Summary | null>(null);
export const recent = signal<any[]>([]);
export const toast = signal<string | null>(null);
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
export const queued = signal(0);
export const privateMode = signal(localStorage.getItem('e8f_private') === '1');
export const onboarding = signal<boolean | null>(null);
export function finishOnboarding() { localStorage.setItem('e8f_onboarded', '1'); onboarding.value = false; }
export const currentMonth = computed(() => month.value === ym());

let toastTimer: number | undefined;
export function say(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = null; }, 3500);
}

export function setPrivate(v: boolean) {
  privateMode.value = v;
  localStorage.setItem('e8f_private', v ? '1' : '0');
}

export async function boot() {
  try {
    const r = await api<{ user: User; csrf_token: string }>('GET', '/me');
    setCsrf(r.csrf_token);
    user.value = r.user;
    await Promise.all([loadLists(), refresh()]);
    syncQueue();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) user.value = null;
    else if (e instanceof ApiError && e.code === 'offline') { user.value = null; say('Sem conexão. Abra de novo quando a internet voltar.'); }
    else user.value = null;
  }
}

export async function login(email: string, password: string) {
  const r = await api<{ user: User; csrf_token: string }>('POST', '/auth/login', { email, password, device: navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.platform });
  setCsrf(r.csrf_token);
  user.value = r.user;
  await Promise.all([loadLists(), refresh()]);
}

export async function logout(all = false) {
  try { await api('POST', all ? '/auth/logout-all' : '/auth/logout'); } catch { /* session may already be gone */ }
  await queue.clear().catch(() => undefined);
  user.value = null;
  onboarding.value = null;
  summary.value = null;
  recent.value = [];
}

export async function loadLists() {
  const [a, c] = await Promise.all([api('GET', '/accounts'), api('GET', '/categories')]);
  accounts.value = a.accounts;
  categories.value = c.categories;
}

/** Re-reads the numbers. Called after every write, when the app comes back to the screen and every minute while visible. */
export async function refresh() {
  try {
    const [s, r] = await Promise.all([api<Summary>('GET', `/metrics/summary?month=${month.value}`), api('GET', '/purchases/recent?limit=8')]);
    summary.value = s;
    recent.value = r.items;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) user.value = null;
  }
}

export async function syncQueue() {
  queued.value = (await queue.all().catch(() => [])).length;
  if (!queued.value || !navigator.onLine) return;
  const r = await flushQueue();
  queued.value = (await queue.all().catch(() => [])).length;
  if (r.sent) { say(`${r.sent} lançamento(s) sincronizado(s).`); refresh(); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { online.value = true; syncQueue(); });
  window.addEventListener('offline', () => { online.value = false; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user.value) { refresh(); syncQueue(); } });
  window.setInterval(() => { if (document.visibilityState === 'visible' && user.value) refresh(); }, 60_000);
}
