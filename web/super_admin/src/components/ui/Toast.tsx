import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastInput {
  kind?: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  kind: ToastKind;
}

interface ToastApi {
  toast: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};

// Solid colours on purpose: a message about money or an order must be seen at a glance, from the top of the screen.
const KIND_STYLE: Record<ToastKind, { Icon: React.ElementType; box: string; bar: string; link: string }> = {
  success: { Icon: CheckCircle2, box: 'bg-kraveo-status-delivered', bar: 'bg-white/60', link: 'text-white' },
  error: { Icon: TriangleAlert, box: 'bg-kraveo-danger', bar: 'bg-white/60', link: 'text-white' },
  info: { Icon: Info, box: 'bg-kraveo-g600', bar: 'bg-white/60', link: 'text-white' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    const kind = input.kind ?? 'info';
    setItems((current) => [...current.slice(-3), { ...input, id, kind }]);
    const duration = input.durationMs ?? (kind === 'error' ? 9000 : 5000);
    setItems((current) => current.map((item) => (item.id === id ? { ...item, durationMs: duration } : item)));
    timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
  }, [dismiss]);

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const api = useMemo<ToastApi>(() => ({
    toast,
    success: (title, description) => toast({ kind: 'success', title, description }),
    error: (title, description) => toast({ kind: 'error', title, description }),
    info: (title, description) => toast({ kind: 'info', title, description }),
  }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-3 px-4 pt-4 sm:pt-6"
      >
        {items.map((item) => {
          const { Icon, box, bar, link } = KIND_STYLE[item.kind];
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto relative flex w-full max-w-lg animate-toast-in items-start gap-3.5 overflow-hidden rounded-k-lg p-4 pr-3 text-white shadow-k-lift ring-1 ring-black/5 ${box}`}
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[15px] font-bold leading-snug">{item.title}</p>
                {item.description && <p className="mt-0.5 text-sm leading-snug text-white/90">{item.description}</p>}
                {item.action && (
                  <button
                    onClick={() => { item.action?.onClick(); dismiss(item.id); }}
                    className={`mt-2 text-sm font-bold underline underline-offset-2 hover:no-underline ${link}`}
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Fermer la notification" onClick={() => dismiss(item.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className={`absolute bottom-0 left-0 h-1 w-full origin-left animate-toast-timer ${bar}`} style={{ animationDuration: `${item.durationMs ?? 5000}ms` }} aria-hidden="true" />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
