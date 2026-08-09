import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { NavItem } from "./data";

const placeholders: Record<NavItem, string> = {
  Dashboard: "Search dashboard sections",
  "My HR": "Search my profile and leave",
  Team: "Search team and approvals",
  Employees: "Search employees",
  Attendance: "Search attendance",
  Leave: "Search leave requests",
  Loans: "Search loans",
  Payroll: "Search payroll",
  Recruitment: "Search jobs and candidates",
  EOS: "Search end-of-service records",
  Documents: "Search documents and requests",
  Reports: "Search reports",
  Audit: "Search audit history",
  Hierarchy: "Search reporting hierarchy",
  System: "Search users, roles and sessions",
  Settings: "Search settings",
};

type PageSearchValue = {
  input: string;
  search: string;
  active: boolean;
  pending: boolean;
  resultCount?: number;
  loading: boolean;
  error?: string;
  setInput(value: string): void;
  clear(): void;
  report(key: string, status?: { count?: number; loading?: boolean; error?: string }): void;
};

const PageSearchContext = createContext<PageSearchValue | null>(null);

export function PageSearchProvider({ page, children }: { page: NavItem; children: React.ReactNode }) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Record<string, { count?: number; loading?: boolean; error?: string }>>({});

  useEffect(() => {
    setInput("");
    setSearch("");
    setStatuses({});
  }, [page]);

  useEffect(() => {
    const trimmed = input.trim();
    const timer = window.setTimeout(() => setSearch(trimmed.length >= 2 ? trimmed : ""), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const report = useCallback((key: string, status?: { count?: number; loading?: boolean; error?: string }) => setStatuses(current => {
    if (!status) {
      if (!(key in current)) return current;
      const next = { ...current }; delete next[key]; return next;
    }
    const previous = current[key];
    if (previous?.count === status.count && previous?.loading === status.loading && previous?.error === status.error) return current;
    return { ...current, [key]: status };
  }), []);
  const reported = useMemo(() => Object.values(statuses), [statuses]);
  const value = useMemo<PageSearchValue>(() => ({
    input,
    search,
    active: search.length >= 2,
    pending: input.trim().length >= 2 && input.trim() !== search,
    resultCount: reported.some(status => status.count !== undefined) ? reported.reduce((total, status) => total + (status.count ?? 0), 0) : undefined,
    loading: reported.some(status => status.loading),
    error: reported.find(status => status.error)?.error,
    setInput,
    clear: () => { setInput(""); setSearch(""); },
    report,
  }), [input, search, report, reported]);

  return <PageSearchContext.Provider value={value}>{children}</PageSearchContext.Provider>;
}

export function usePageSearch() {
  const context = useContext(PageSearchContext);
  if (!context) throw new Error("usePageSearch must be used inside PageSearchProvider");
  return context;
}

export function usePageSearchStatus(key: string, status: { count?: number; loading?: boolean; error?: string }) {
  const { active, report } = usePageSearch();
  useEffect(() => {
    report(key, active ? status : undefined);
    return () => report(key);
  }, [active, key, report, status.count, status.loading, status.error]);
}

export function PageSearchBar({ page }: { page: NavItem }) {
  const { input, active, pending, resultCount, loading, error, setInput, clear } = usePageSearch();
  return <div className="page-search" role="search">
    <Search size={17} aria-hidden="true" />
    <label className="sr-only" htmlFor="page-search-input">{placeholders[page]}</label>
    <input
      id="page-search-input"
      type="search"
      value={input}
      onChange={event => setInput(event.target.value)}
      placeholder={placeholders[page]}
      aria-label={placeholders[page]}
      aria-describedby={input.trim().length === 1 ? "page-search-hint" : undefined}
      autoComplete="off"
      maxLength={100}
    />
    {(pending || loading) && <span className="page-search-spinner" aria-label="Searching" />}
    {input && <button type="button" onClick={clear} aria-label={`Clear ${placeholders[page].toLowerCase()}`}><X size={16} /></button>}
    {input.trim().length === 1 && <span id="page-search-hint" className="sr-only">Enter at least two characters to search.</span>}
    {active && !pending && <span className={`page-search-status${error ? " error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{error || (loading ? "Searching" : `${resultCount ?? 0} result${resultCount === 1 ? "" : "s"}`)}</span>}
  </div>;
}
