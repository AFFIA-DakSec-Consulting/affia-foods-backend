import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [10, 25, 50, 100, 200];

/** Page numbers to show: first, last, and a window around the current page, with "…" for the gaps. */
export const pageNumbers = (current: number, total: number): Array<number | '…'> => {
  const wanted = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = Array.from(wanted).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  sorted.forEach((n, i) => { if (i > 0 && n - sorted[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
};

/** Slices a list into pages. `resetKey` changes (filters, search…) bring the reader back to page 1. */
export const usePagination = <T,>(items: T[], resetKey: string, initialSize = 10) => {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = useMemo(() => items.slice((currentPage - 1) * pageSize, currentPage * pageSize), [items, currentPage, pageSize]);
  return { pageItems, page: currentPage, pageCount, pageSize, setPage, setPageSize, total: items.length };
};

interface PaginationBarProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Omit when the page size is fixed by the server: the selector is then hidden. */
  onPageSize?: (size: number) => void;
  /** Plural noun for the size selector, e.g. "commandes". */
  noun?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({ page, pageCount, pageSize, total, onPage, onPageSize, noun = 'éléments' }) => {
  if (total === 0) return null;
  return (
    <nav className="flex flex-col items-center justify-between gap-3 px-1 sm:flex-row" aria-label="Pagination">
      {onPageSize ? (
        <label className="flex items-center gap-2 text-sm text-kraveo-ink2">
          Afficher
          <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="k-input !w-auto py-1.5 pr-8" aria-label={`Nombre de ${noun} par page`}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          par page
        </label>
      ) : <span className="hidden sm:block sm:w-40" aria-hidden="true" />}
      <p className="text-sm text-kraveo-ink3" aria-live="polite">
        <span className="font-bold text-kraveo-ink">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> sur {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" className="k-btn-ghost !px-3" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Page précédente"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
        {pageNumbers(page, pageCount).map((n, i) => (n === '…'
          ? <span key={`gap-${i}`} className="px-1 text-kraveo-ink3" aria-hidden="true">…</span>
          : (
            <button key={n} type="button" onClick={() => onPage(n)} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}
              className={`h-9 min-w-[2.25rem] rounded-k-sm px-2 text-sm font-bold tabular-nums transition-colors ${n === page ? 'bg-kraveo-g500 text-white' : 'border border-kraveo-line bg-kraveo-surface text-kraveo-ink2 hover:bg-kraveo-surface2'}`}>{n}</button>
          )))}
        <button type="button" className="k-btn-ghost !px-3" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Page suivante"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>
    </nav>
  );
};
