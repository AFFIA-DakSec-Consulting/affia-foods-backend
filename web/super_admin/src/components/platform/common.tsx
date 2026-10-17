import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiError } from '../../services/api';
import { platformErrorMessage } from '../../lib/adminMessages';

/** One readable sentence for any failure. */
export const errorText = (error: unknown, fallback = 'Une erreur est survenue. Réessayez.'): string => {
  if (error instanceof ApiError) return platformErrorMessage(error.code, error.message);
  return error instanceof Error ? error.message : fallback;
};

export const dateTime = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const dateOnly = (iso?: string | null): string => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Loads data on mount and whenever `deps` change. A stale answer never overwrites a newer one; a rejected session is reported to the app. */
export function useLoad<T>(load: () => Promise<T>, onAuthError: (error: unknown) => void, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const authRef = useRef(onAuthError);
  authRef.current = onAuthError;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError('');
    try {
      const result = await loadRef.current();
      if (mine === seq.current) setData(result);
    } catch (e) {
      if (mine !== seq.current) return;
      authRef.current(e);
      setError(errorText(e, 'Le chargement a échoué.'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { data, setData, loading, error, reload };
}

export const ErrorBanner: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">
    <span className="flex min-w-0 items-center gap-2"><TriangleAlert className="h-4 w-4 shrink-0 text-kraveo-danger" aria-hidden="true" /><span className="min-w-0">{message}</span></span>
    {onRetry && <button type="button" className="k-btn-ghost !min-h-[36px] !px-3 text-xs" onClick={onRetry}>Réessayer</button>}
  </div>
);

/** A small coloured pill. `tone` is a literal Tailwind class string so the scanner keeps it. */
export const TONES = {
  green: 'bg-kraveo-g500/10 text-kraveo-g700',
  red: 'bg-kraveo-danger/15 text-kraveo-danger',
  amber: 'bg-kraveo-status-placed/15 text-kraveo-status-placed',
  blue: 'bg-kraveo-status-pickedUp/15 text-kraveo-status-pickedUp',
  grey: 'bg-kraveo-surface2 text-kraveo-ink2',
} as const;
export type Tone = keyof typeof TONES;
export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode }> = ({ tone = 'grey', children }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${TONES[tone]}`}>{children}</span>
);

/** Text input that keeps what the admin types as text (the parser turns it into a number on save). */
export const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { id: string; invalid?: boolean }> = ({ invalid, className = '', ...rest }) => (
  <input {...rest} aria-invalid={invalid || undefined} aria-describedby={`${rest.id}-msg`} className={`k-input ${className}`} />
);

export const CheckRow: React.FC<{ id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ id, label, hint, checked, onChange }) => (
  <label htmlFor={id} className="k-inset flex cursor-pointer items-start gap-3 px-4 py-3">
    <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--k-g500,#16a34a)]" />
    <span className="min-w-0"><span className="block text-sm font-bold text-kraveo-ink">{label}</span>{hint && <span className="block text-xs text-kraveo-ink3">{hint}</span>}</span>
  </label>
);
