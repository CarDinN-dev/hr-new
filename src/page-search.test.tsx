import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageSearchBar, PageSearchProvider, rankedPageSearchItems, usePageSearch } from "./page-search";

describe("page search", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("debounces for 250ms, ignores one character and resets on navigation", () => {
    let value: ReturnType<typeof usePageSearch> | undefined;
    const Probe = () => { value = usePageSearch(); return null; };
    act(() => root.render(<PageSearchProvider page="Employees"><Probe /></PageSearchProvider>));
    act(() => value!.setInput("a"));
    act(() => vi.advanceTimersByTime(250));
    expect(value!.search).toBe("");
    act(() => value!.setInput("  Alice  "));
    act(() => vi.advanceTimersByTime(249));
    expect(value!.search).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(value!.search).toBe("Alice");
    act(() => root.render(<PageSearchProvider page="Attendance"><Probe /></PageSearchProvider>));
    expect(value!.input).toBe("");
    expect(value!.search).toBe("");
  });

  it("uses a page-specific accessible label and enforces the server length ceiling", () => {
    act(() => root.render(<PageSearchProvider page="Recruitment"><PageSearchBar page="Recruitment" /></PageSearchProvider>));
    const input = host.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Search jobs and candidates");
    expect(input.maxLength).toBe(100);
  });

  it("keeps current order until ranked results arrive and restores it when search clears", () => {
    const items = [{ id: "first" }, { id: "second" }];
    const id = (item: { id: string }) => item.id;
    expect(rankedPageSearchItems(items, undefined, true, id, id).map(id)).toEqual(["first", "second"]);
    expect(rankedPageSearchItems(items, [{ id: "second" }, { id: "first" }], true, id, id).map(id)).toEqual(["second", "first"]);
    expect(rankedPageSearchItems(items, [], true, id, id)).toEqual([]);
    expect(rankedPageSearchItems(items, [{ id: "second" }], false, id, id).map(id)).toEqual(["first", "second"]);
  });
});
