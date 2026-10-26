export interface Font {
  readonly family: string;
  readonly pkg: string;
  readonly css: readonly string[];
  readonly fallback: string;
}

const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const SERIF = 'ui-serif,Georgia,Cambria,"Times New Roman",serif';
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const CONDENSED = `Impact,"Arial Narrow",${SANS}`;

function variable(name: string, css: string, fallback: string): Font {
  const slug = name.toLowerCase().replace(/ /g, "-");
  return { family: `${name} Variable`, pkg: `@fontsource-variable/${slug}`, css: [css], fallback };
}

function fixed(name: string, css: readonly string[], fallback: string): Font {
  return { family: name, pkg: `@fontsource/${name.toLowerCase().replace(/ /g, "-")}`, css, fallback };
}

export const FONTS = {
  Anton: fixed("Anton", ["400.css"], CONDENSED),
  Archivo: variable("Archivo", "standard.css", SANS),
  "Bebas Neue": fixed("Bebas Neue", ["400.css"], CONDENSED),
  "Big Shoulders Display": variable("Big Shoulders Display", "index.css", CONDENSED),
  "Bricolage Grotesque": variable("Bricolage Grotesque", "standard.css", SANS),
  "DM Sans": variable("DM Sans", "index.css", SANS),
  "DM Serif Display": fixed("DM Serif Display", ["400.css", "400-italic.css"], SERIF),
  Fraunces: variable("Fraunces", "index.css", SERIF),
  Geist: variable("Geist", "index.css", SANS),
  "Geist Mono": variable("Geist Mono", "index.css", MONO),
  "IBM Plex Mono": fixed("IBM Plex Mono", ["400.css", "500.css", "700.css"], MONO),
  "IBM Plex Sans": variable("IBM Plex Sans", "standard.css", SANS),
  Inter: variable("Inter", "index.css", SANS),
  "Instrument Serif": fixed("Instrument Serif", ["400.css", "400-italic.css"], SERIF),
  "JetBrains Mono": variable("JetBrains Mono", "index.css", MONO),
  Manrope: variable("Manrope", "index.css", SANS),
  Outfit: variable("Outfit", "index.css", SANS),
  "Playfair Display": variable("Playfair Display", "index.css", SERIF),
  "Source Serif 4": variable("Source Serif 4", "index.css", SERIF),
  "Space Grotesk": variable("Space Grotesk", "index.css", SANS),
  Syne: variable("Syne", "index.css", SANS),
  Unbounded: variable("Unbounded", "index.css", SANS),
  Vazirmatn: variable("Vazirmatn", "index.css", SANS),
} as const satisfies Record<string, Font>;

export type FontName = keyof typeof FONTS;

export type FontRole = "display" | "body" | "mono";

export const FONT_ROLES: readonly FontRole[] = ["display", "body", "mono"];

export const FONTS_PATH = "/fonts.css";

export function isFont(name: unknown): name is FontName {
  return typeof name === "string" && Object.hasOwn(FONTS, name);
}

export function fontStack(name: FontName): string {
  const font: Font = FONTS[name];
  return `"${font.family}",${font.fallback}`;
}
