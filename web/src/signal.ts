/** Tiny reactive store (a few lines instead of a dependency). Components re-render through useSignals(). */
import { useEffect, useState } from 'preact/hooks';

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export interface Signal<T> { value: T }

export function signal<T>(initial: T): Signal<T> {
  let v = initial;
  return {
    get value() { return v; },
    set value(next: T) { if (next !== v) { v = next; notify(); } },
  };
}

export function computed<T>(fn: () => T): { readonly value: T } {
  return { get value() { return fn(); } };
}

/** Subscribe a component to every store change. The app is small enough that one channel is fine. */
export function useSignals() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}
