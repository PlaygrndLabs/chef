import { createContext, useContext, useEffect, useMemo, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { homeOf, lookOf, pageTitle } from "./meta.ts";
import { bySpecificity, isPage, matchPath } from "./paths.ts";
import { Link, navigate, sameAppLink, useLocation } from "./router.tsx";
import type { FontName, FontRole } from "./fonts.ts";
import type { Colors } from "./meta.ts";
import { lookCss } from "./theme.ts";
import { Icon } from "./ui.tsx";

export interface PageProps {
  readonly params: Readonly<Record<string, string>>;
}

export interface Page {
  readonly path: string;
  readonly title: string;
  readonly description?: string;
  readonly nav?: boolean;
  readonly component: ComponentType<PageProps>;
}

export interface Look {
  readonly brand?: string;
  readonly description?: string;
  readonly accent?: string;
  readonly width?: "narrow" | "normal" | "wide" | "full";
  readonly scheme?: "light" | "dark";
  readonly fonts?: Partial<Record<FontRole, FontName>>;
  readonly colors?: { readonly light?: Colors; readonly dark?: Colors };
  readonly radius?: string;
  readonly style?: string;
}

const Params = createContext<Readonly<Record<string, string>>>({});

export function useParams(): Readonly<Record<string, string>> {
  return useContext(Params);
}

export function findPage(pages: readonly Page[], path: string): { readonly page: Page; readonly params: Record<string, string> } | null {
  for (const page of [...pages].sort(bySpecificity)) {
    const params = matchPath(page.path, path);
    if (params) return { page, params };
  }
  return null;
}

export { homeOf, lookOf };

function describe(text: string | undefined): void {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!text) return tag?.remove();
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = "description";
    document.head.appendChild(tag);
  }
  tag.content = text;
}

function report(pages: readonly Page[]): void {
  if (window.parent === window) return;
  const listed = pages.filter((page) => isPage({ method: "GET", path: page.path })).map((page) => ({ title: page.title, path: page.path }));
  window.parent.postMessage({ chef: "page", path: location.pathname + location.search, title: document.title, pages: listed }, "*");
}

function Empty({ icon, title, children }: { readonly icon: "sparkles" | "search"; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function App({ pages, look = {} }: { readonly pages: readonly Page[]; readonly look?: Look }) {
  const { path } = useLocation();
  const found = findPage(pages, path);
  const home = path === "/" && !found ? homeOf(pages) : null;
  const nav = pages.filter((page) => page.nav && isPage({ method: "GET", path: page.path }));
  const title = found ? found.page.title : path === "/" ? (look.brand ?? "App") : "This page isn't built yet";
  useEffect(() => {
    if (home) navigate(home, { replace: true });
  }, [home]);
  const description = found?.page.description ?? look.description;
  useEffect(() => {
    document.title = pageTitle(title, look);
    describe(description);
    report(pages);
  }, [path, title, description]);
  const width = look.width && look.width !== "normal" ? ` ${look.width}` : "";
  const Body = found?.page.component;
  return (
    <>
      {look.brand || nav.length ? (
        <header className="topbar">
          <div className={`container-bar${width}`}>
            <Link className="brand" to="/">
              {look.brand ?? "App"}
            </Link>
            {nav.length ? (
              <nav>
                {nav.map((page) => (
                  <Link key={page.path} to={page.path} aria-current={page.path === path ? "page" : undefined}>
                    {page.title}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </header>
      ) : null}
      <main className={`container${width}`}>
        {Body && found ? (
          <Params.Provider value={found.params}>
            <Body params={found.params} />
          </Params.Provider>
        ) : home ? null : path === "/" ? (
          <Empty icon="sparkles" title="Nothing here yet">
            This app's pages show up here as Chef builds them.
          </Empty>
        ) : (
          <Empty icon="search" title="This page isn't built yet">
            Nothing in this app answers <code>{path}</code> yet. <Link to="/">Go home</Link>
          </Empty>
        )}
      </main>
    </>
  );
}

function Root({ pages, looks }: { readonly pages: readonly Page[]; readonly looks: readonly Look[] }) {
  const look = useMemo(() => lookOf(looks), [looks]);
  return <App pages={pages} look={look} />;
}

export function start(pages: readonly Page[], looks: readonly Look[] = []): void {
  const look = lookOf(looks);
  if (look.scheme === "light" || look.scheme === "dark") document.documentElement.dataset.scheme = look.scheme;
  const css = lookCss(look);
  if (css) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) return;
    const target = sameAppLink(event, anchor);
    if (target === null) return;
    event.preventDefault();
    navigate(target);
  });
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Root pages={pages} looks={looks} />);
}
