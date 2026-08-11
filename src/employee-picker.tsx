import { useEffect, useId, useMemo, useRef, useState } from "react";

export type EmployeePickerOption = { id: string; label: string; searchText?: string };

export function filterEmployeePickerOptions(options: readonly EmployeePickerOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter(option => `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function EmployeePicker({ id, name, value, options, onChange, placeholder = "Select employee", ariaLabel = "Employee", clearable = false, disabled = false }: {
  id?: string;
  name?: string;
  value: string;
  options: readonly EmployeePickerOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.id === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => filterEmployeePickerOptions(options, query), [options, query]);

  useEffect(() => { setQuery(selected?.label ?? ""); }, [selected?.label, value]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function choose(option: EmployeePickerOption) {
    onChange(option.id);
    setQuery(option.label);
    setOpen(false);
  }

  function close() {
    setOpen(false);
    setQuery(selected?.label ?? "");
  }

  function moveActive(amount: number) {
    setOpen(true);
    setActiveIndex(current => matches.length ? (current + amount + matches.length) % matches.length : 0);
  }

  return <div className="employee-picker" ref={rootRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <input
      id={id}
      name={name}
      type="text"
      role="combobox"
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={open && matches[activeIndex] ? `${listId}-${matches[activeIndex].id}` : undefined}
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={query}
      onFocus={() => { setOpen(true); setActiveIndex(0); }}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); moveActive(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); }
        else if (event.key === "Enter" && open && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); }
        else if (event.key === "Escape") { event.preventDefault(); close(); }
        else if (event.key === "Tab") close();
      }}
    />
    {clearable && value && <button className="employee-picker__clear" type="button" aria-label="Clear selection" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(false); }}>×</button>}
    <button className="employee-picker__toggle" type="button" aria-label={`${open ? "Hide" : "Show"} choices`} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => setOpen(current => !current)}>▾</button>
    {open && <div id={listId} className="employee-picker__options" role="listbox" aria-label={`${ariaLabel} choices`}>
      {matches.length ? matches.map((option, index) => <button id={`${listId}-${option.id}`} className={option.id === value ? "is-selected" : undefined} type="button" role="option" aria-selected={option.id === value} key={option.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>{option.label}</button>) : <p className="employee-picker__empty">No employees match.</p>}
    </div>}
  </div>;
}
