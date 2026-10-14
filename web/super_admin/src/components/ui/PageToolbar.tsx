import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Columns3, Download, LayoutGrid, RefreshCw, Rows3, Search, X } from 'lucide-react';

/** Page title block: icon square, title, one-line subtitle, actions on the right (same look on every list page). */
export const PageHeader: React.FC<{ icon: React.ElementType; title: string; subtitle: string; actions?: React.ReactNode; onRefresh?: () => void; refreshing?: boolean }> = ({ icon: Icon, title, subtitle, actions, onRefresh, refreshing = false }) => (
  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-kraveo-surface2 text-kraveo-ink2 sm:h-12 sm:w-12"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <div className="min-w-0">
        <h1 className="truncate font-display text-lg font-bold text-kraveo-ink sm:text-xl">{title}</h1>
        <p className="truncate text-xs text-kraveo-ink3 sm:text-sm">{subtitle}</p>
      </div>
    </div>
    <div className="flex items-center gap-2 self-start sm:self-auto">
      {onRefresh && (
        <button type="button" className="k-btn-ghost !px-3" onClick={onRefresh} disabled={refreshing} aria-label="Actualiser" title="Actualiser">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}
      {actions}
    </div>
  </div>
);

export const SearchField: React.FC<{ value: string; onChange: (value: string) => void; placeholder: string; label: string }> = ({ value, onChange, placeholder, label }) => (
  <div className="relative max-w-xl">
    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
    <input type="search" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder={placeholder}
      className="w-full rounded-k-lg border border-kraveo-line bg-kraveo-surface py-3 pl-11 pr-4 text-sm text-kraveo-ink placeholder:text-kraveo-ink3 focus:border-kraveo-g500 focus:outline-none focus:ring-2 focus:ring-kraveo-g500/20" />
  </div>
);

export interface TabOption<T extends string> { id: T; label: string; count?: number; hint?: string; alert?: boolean }

/** Underlined status tabs with a count pill. */
export function UnderlineTabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<TabOption<T>>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="border-b border-kraveo-line">
      <nav className="-mb-px flex gap-4 overflow-x-auto scrollbar-none sm:gap-6" role="group" aria-label={label}>
        {tabs.map((tab) => {
          const active = value === tab.id;
          const count = tab.count ?? 0;
          return (
            <button key={tab.id} type="button" aria-pressed={active} title={tab.hint} onClick={() => onChange(tab.id)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${active ? 'border-kraveo-g500 text-kraveo-g600' : 'border-transparent text-kraveo-ink3 hover:border-kraveo-line hover:text-kraveo-ink'} ${tab.alert && count > 0 && !active ? '!text-kraveo-danger' : ''}`}>
              {tab.label}
              {tab.count !== undefined && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${active ? 'bg-kraveo-g500/10 text-kraveo-g600' : tab.alert && count > 0 ? 'bg-kraveo-danger/10 text-kraveo-danger' : 'bg-kraveo-surface2 text-kraveo-ink3'}`}>{count}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ───────────────────────── Table tools (same on every list page) ─────────────────────────

export type ViewMode = 'table' | 'grid';

export const ViewToggle: React.FC<{ value: ViewMode; onChange: (view: ViewMode) => void }> = ({ value, onChange }) => (
  <div className="inline-flex overflow-hidden rounded-k-sm border border-kraveo-line bg-kraveo-surface" role="group" aria-label="Affichage">
    <button type="button" onClick={() => onChange('table')} aria-pressed={value === 'table'} title="Vue tableau" className={`p-2 ${value === 'table' ? 'bg-kraveo-g500 text-white' : 'text-kraveo-ink3 hover:bg-kraveo-surface2'}`}><Rows3 className="h-4 w-4" aria-hidden="true" /></button>
    <button type="button" onClick={() => onChange('grid')} aria-pressed={value === 'grid'} title="Vue cartes" className={`p-2 ${value === 'grid' ? 'bg-kraveo-g500 text-white' : 'text-kraveo-ink3 hover:bg-kraveo-surface2'}`}><LayoutGrid className="h-4 w-4" aria-hidden="true" /></button>
  </div>
);

export function ColumnsMenu<K extends string>({ columns, hidden, onToggle, onReset }: { columns: Array<{ key: K; label: string }>; hidden: K[]; onToggle: (key: K) => void; onReset: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative hidden xl:block">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-2 rounded-k-sm border border-kraveo-line bg-kraveo-surface px-3 py-2 text-sm font-semibold text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2">
        <Columns3 className="h-4 w-4" aria-hidden="true" />Colonnes
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-k-md border border-kraveo-line bg-kraveo-surface py-1 shadow-k-lift">
            {columns.map((c) => {
              const on = !hidden.includes(c.key);
              return (
                <li key={c.key}>
                  <button type="button" onClick={() => onToggle(c.key)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-kraveo-ink2 hover:bg-kraveo-surface2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-kraveo-g500 bg-kraveo-g500 text-white' : 'border-kraveo-line'}`}>{on && <Check className="h-3 w-3" aria-hidden="true" />}</span>{c.label}
                  </button>
                </li>
              );
            })}
            {hidden.length > 0 && <li className="border-t border-kraveo-line"><button type="button" onClick={onReset} className="w-full px-4 py-2 text-left text-xs font-bold text-kraveo-g600 hover:bg-kraveo-surface2">Tout afficher</button></li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Column heading that sorts on click: none → descending → ascending → none. */
export const SortHeader: React.FC<{ label: string; active: false | 'asc' | 'desc'; onClick: () => void }> = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick} title={`Trier par ${label.toLowerCase()}`} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-kraveo-ink">
    {label}{active === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : active === 'desc' ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
  </button>
);

export const nextSort = <F extends string>(current: { field: F; dir: 'asc' | 'desc' } | null, field: F): { field: F; dir: 'asc' | 'desc' } | null =>
  (current?.field !== field ? { field, dir: 'desc' } : current.dir === 'desc' ? { field, dir: 'asc' } : null);

export const SelectionBar: React.FC<{ count: number; noun: string; onExport: () => void; onClear: () => void }> = ({ count, noun, onExport, onClear }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-k-lg border border-kraveo-g500/30 bg-kraveo-g500/5 px-4 py-3" role="status">
    <span className="text-sm font-bold text-kraveo-ink">{count} {noun}{count > 1 ? 's' : ''} sélectionné{count > 1 ? 's' : ''}</span>
    <div className="flex items-center gap-2">
      <button type="button" className="k-btn-ghost" onClick={onExport}><Download className="h-4 w-4" aria-hidden="true" />Exporter la sélection</button>
      <button type="button" className="k-btn-ghost" onClick={onClear}><X className="h-4 w-4" aria-hidden="true" />Désélectionner</button>
    </div>
  </div>
);

export const downloadCsv = (name: string, head: string[], rows: Array<Array<string | number | null | undefined>>) => {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${[head, ...rows].map((row) => row.map(cell).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/** View mode and hidden columns, remembered per page in this browser. */
export function useTablePrefs<K extends string>(key: string, defaultView: ViewMode = 'table') {
  const read = (): { hidden: K[]; view: ViewMode } => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
      return { hidden: Array.isArray(raw.hidden) ? raw.hidden : [], view: raw.view === 'grid' || raw.view === 'table' ? raw.view : defaultView };
    } catch { return { hidden: [], view: defaultView }; }
  };
  const [prefs, setPrefs] = React.useState(read);
  React.useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* storage blocked: kept for this visit only */ } }, [key, prefs]);
  return {
    hidden: prefs.hidden,
    view: prefs.view,
    show: (column: K) => !prefs.hidden.includes(column),
    setView: (view: ViewMode) => setPrefs((p) => ({ ...p, view })),
    toggleColumn: (column: K) => setPrefs((p) => ({ ...p, hidden: p.hidden.includes(column) ? p.hidden.filter((c) => c !== column) : [...p.hidden, column] })),
    resetColumns: () => setPrefs((p) => ({ ...p, hidden: [] })),
  };
}
