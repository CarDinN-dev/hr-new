import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { paginationLabel } from "./features/workflow-utils";

type PaginationProps = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  label: string;
  loading?: boolean;
  onPage: (page: number) => void;
  children?: ReactNode;
};

export function Pagination({ total, page, limit, totalPages, label, loading = false, onPage, children }: PaginationProps) {
  const lastPage = Math.max(totalPages, 1);
  const currentPage = Math.min(Math.max(page, 1), lastPage);
  const atStart = currentPage === 1;
  const atEnd = currentPage === lastPage;

  return <nav className="audit-pagination" aria-label={`${label} pagination`} aria-busy={loading || undefined}>
    <span className="muted" aria-live="polite">{paginationLabel(total, currentPage, limit, label)} · Page {currentPage} of {lastPage}</span>
    {children}
    <div className="inline-controls pagination-actions">
      <button type="button" aria-label="First page" title="First page" disabled={atStart || loading} onClick={() => onPage(1)}><ChevronsLeft size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Previous page" title="Previous page" disabled={atStart || loading} onClick={() => onPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Next page" title="Next page" disabled={atEnd || loading} onClick={() => onPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Last page" title="Last page" disabled={atEnd || loading} onClick={() => onPage(lastPage)}><ChevronsRight size={16} aria-hidden="true" /></button>
    </div>
  </nav>;
}
