import { useCallback, useEffect, useState } from "react";

export const MEMORY_TAB = ":memory";
export const LIVE_TAB = ":live";

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function useTabs(project: string, active: string | null) {
  const key = `chef:tabs:${project}`;
  const [tabs, setTabs] = useState<readonly string[]>(() => read(key));
  if (active && !tabs.includes(active)) setTabs([...tabs, active]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(tabs));
    } catch {
      return;
    }
  }, [key, tabs]);
  const close = useCallback(
    (id: string): string | null => {
      const at = tabs.indexOf(id);
      const rest = tabs.filter((t) => t !== id);
      setTabs(rest);
      return rest[Math.min(Math.max(at, 0), rest.length - 1)] ?? null;
    },
    [tabs],
  );
  const keep = useCallback((valid: (id: string) => boolean) => setTabs((list) => (list.every(valid) ? list : list.filter(valid))), []);
  return { tabs, close, keep } as const;
}
