import { createContext, useContext, useEffect, useMemo, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { homeOf, lookOf, pageTitle } from "./meta.ts";
import { bySpecificity, isPage, matchPath } from "./paths.ts";
import { Link, navigate, sameAppLink, useLocation } from "./router.tsx";
import { FONT_ROLES, fontStack, isFont, type FontName, type FontRole } from "./fonts.ts";
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
  readonly bare?: boolean;
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
  readonly materials?: { readonly [name: string]: string };
  readonly gate?: string;
  readonly references?: readonly string[];
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
  window.parent.postMessage({ chef: "page", path: location.pathname + location.search, title: document.title, pages: listed, look: LOOK_PREVIEW }, "*");
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
      {(look.brand || nav.length) && !found?.page.bare ? (
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

const LOOK_PREVIEW = 1;

export interface FontFaceData {
  readonly data: ArrayBuffer;
  readonly weight?: string;
  readonly style?: string;
  readonly unicodeRange?: string;
}

export interface LookPreview {
  readonly look: Look | null;
  readonly scheme: "light" | "dark" | null;
  readonly fonts: readonly { readonly family: string; readonly faces: readonly FontFaceData[] }[];
}

export function lookPreview(data: unknown): LookPreview | null {
  if (!data || typeof data !== "object" || (data as { chef?: unknown }).chef !== "look") return null;
  const { look, scheme, fonts } = data as { look?: unknown; scheme?: unknown; fonts?: unknown };
  return {
    look: look && typeof look === "object" ? (look as Look) : null,
    scheme: scheme === "light" || scheme === "dark" ? scheme : null,
    fonts: Array.isArray(fonts) ? fonts.filter((font): font is LookPreview["fonts"][number] => typeof font?.family === "string" && Array.isArray(font.faces)) : [],
  };
}

export function fontVars(fonts: Look["fonts"]): string {
  const vars = FONT_ROLES.flatMap((role) => {
    const name = fonts?.[role];
    return isFont(name) ? [`--font-${role}:${fontStack(name)}`] : [];
  });
  return vars.length ? `:root{${vars.join(";")}}` : "";
}

const loadedFaces = new Set<string>();

function addFonts(fonts: LookPreview["fonts"]): void {
  if (typeof FontFace === "undefined") return;
  for (const font of fonts) {
    for (const face of font.faces) {
      const key = [font.family, face.weight, face.style, face.unicodeRange].join("|");
      if (loadedFaces.has(key) || !(face.data instanceof ArrayBuffer)) continue;
      loadedFaces.add(key);
      const descriptors: FontFaceDescriptors = { display: "swap" };
      if (face.weight) descriptors.weight = face.weight;
      if (face.style) descriptors.style = face.style;
      if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange;
      try {
        document.fonts.add(new FontFace(font.family, face.data, descriptors));
      } catch {
        loadedFaces.delete(key);
      }
    }
  }
}

function usePreview(looks: readonly Look[]): LookPreview | null {
  const [preview, setPreview] = useState<LookPreview | null>(null);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const next = lookPreview(event.data);
      if (!next) return;
      addFonts(next.fonts);
      setPreview(next.look || next.scheme ? next : null);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);
  useEffect(() => {
    let style = document.getElementById("chef-look-preview");
    const scheme = preview?.scheme ?? (preview?.look ? lookOf([...looks, preview.look]).scheme : lookOf(looks).scheme);
    if (scheme === "light" || scheme === "dark") document.documentElement.dataset.scheme = scheme;
    else delete document.documentElement.dataset.scheme;
    if (!preview?.look) return void style?.remove();
    if (!style) {
      style = document.createElement("style");
      style.id = "chef-look-preview";
      document.head.appendChild(style);
    }
    const look = lookOf([...looks, preview.look]);
    style.textContent = [lookCss(look), fontVars(look.fonts)].filter(Boolean).join("\n");
  }, [preview, looks]);
  return preview;
}

function Root({ pages, looks }: { readonly pages: readonly Page[]; readonly looks: readonly Look[] }) {
  const preview = usePreview(looks);
  const look = useMemo(() => lookOf(preview?.look ? [...looks, preview.look] : looks), [looks, preview]);
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
