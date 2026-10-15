import { useCallback, useEffect, useMemo, useState } from "react";

export const MAIN_TAB = ":main";

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== MAIN_TAB) : [];
  } catch {
    return [];
  }
}

export function useTabs(project: string, active: string | null) {
  const key = `chef:tabs:${project}`;
  const [opened, setOpened] = useState<readonly string[]>(() => read(key));
  if (active && active !== MAIN_TAB && !opened.includes(active)) setOpened([...opened, active]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(opened));
    } catch {
      return;
    }
  }, [key, opened]);
  const tabs = useMemo(() => [MAIN_TAB, ...opened], [opened]);
  const close = useCallback(
    (id: string): string => {
      if (id === MAIN_TAB) return MAIN_TAB;
      const at = tabs.indexOf(id);
      const rest = tabs.filter((t) => t !== id);
      setOpened(rest.filter((t) => t !== MAIN_TAB));
      return rest[Math.min(Math.max(at, 0), rest.length - 1)] ?? MAIN_TAB;
    },
    [tabs],
  );
  const keep = useCallback((valid: (id: string) => boolean) => setOpened((list) => (list.every(valid) ? list : list.filter(valid))), []);
  return { tabs, close, keep } as const;
}
