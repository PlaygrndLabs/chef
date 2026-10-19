import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) addEventListener("popstate", notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) removeEventListener("popstate", notify);
  };
}

function current(): string {
  return location.pathname + location.search;
}

export function navigate(to: string, options: { readonly replace?: boolean } = {}): void {
  if (to === current()) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  scrollTo(0, 0);
  notify();
}

export function useLocation(): { readonly path: string; readonly search: URLSearchParams } {
  const at = useSyncExternalStore(subscribe, current, current);
  const url = new URL(at, location.origin);
  return { path: url.pathname, search: url.searchParams };
}

export function sameAppLink(event: globalThis.MouseEvent, anchor: HTMLAnchorElement): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  return url.pathname + url.search;
}

export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { readonly to: string }) {
  return (
    <a
      {...props}
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        const target = sameAppLink(event.nativeEvent, event.currentTarget);
        if (target === null) return;
        event.preventDefault();
        navigate(target);
      }}
    />
  );
}
