/** API client. Cookies carry the session; every write sends the CSRF token. Offline creates wait in a local queue. */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Sem conexão.');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Algo deu errado.', data?.details);
  }
  return data as T;
}

// ---------------------------------------------------------------- offline queue (IndexedDB, cleared on logout)
const DB = 'e8f';
const STORE = 'queue';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'idempotency_key' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const queue = {
  add: (item: Record<string, unknown>) => tx('readwrite', (s) => s.put(item)),
  all: () => tx<Record<string, unknown>[]>('readonly', (s) => s.getAll()),
  remove: (key: string) => tx('readwrite', (s) => s.delete(key)),
  clear: () => tx('readwrite', (s) => s.clear()),
};

/** Sends queued purchases. The idempotency key makes a retry after a lost response harmless. */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const item of await queue.all()) {
    try {
      await api('POST', '/purchases', { ...item, allow_duplicate: true });
      await queue.remove(item.idempotency_key as string);
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
        await queue.remove(item.idempotency_key as string); // invalid data: drop it and tell the person
      }
      failed++;
    }
  }
  return { sent, failed };
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');
