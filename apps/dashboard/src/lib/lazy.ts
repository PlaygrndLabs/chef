import { lazy, useState, type ComponentType, type LazyExoticComponent } from "react";

export type Preloadable<P> = LazyExoticComponent<ComponentType<P>> & { readonly preload: () => Promise<unknown> };

export function preloadable<P>(load: () => Promise<ComponentType<P>>): Preloadable<P> {
  let loading: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
  return Object.assign(
    lazy(() => preload().then((component) => ({ default: component }))),
    { preload },
  );
}

export function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 1500);
  return () => window.clearTimeout(id);
}

export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}
