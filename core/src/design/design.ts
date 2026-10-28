import type { Tree } from "../git/tree.ts";

export type FontRoleName = "display" | "body" | "mono";

export interface DesignView {
  readonly brand: string | null;
  readonly description: string | null;
  readonly scheme: "light" | "dark" | null;
  readonly fonts: Partial<Record<FontRoleName, string>>;
  readonly colors: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
  readonly materials: Readonly<Record<string, string>>;
  readonly radius: string | null;
  readonly accent: string | null;
  readonly width: string | null;
  readonly gate: string | null;
  readonly references: readonly string[];
  readonly sources: readonly string[];
  readonly unread: readonly string[];
  readonly kit: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
  readonly catalog: readonly CatalogFont[];
}

export interface CatalogFont {
  readonly name: string;
  readonly kind: "sans" | "serif" | "mono" | "condensed";
}

export interface DesignDraft {
  readonly brand: string | null;
  readonly scheme: "light" | "dark" | null;
  readonly fonts: Partial<Record<FontRoleName, string>>;
  readonly colors: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
  readonly materials: Readonly<Record<string, string>>;
  readonly radius: string | null;
  readonly width: string | null;
}

export interface DesignChange {
  readonly what: string;
  readonly from: string | null;
  readonly to: string | null;
}

type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };

const LOOK_FILE = /^features\/[a-z][a-z0-9-]*\/(?:[a-z][a-z0-9-]*\/)?look\.ts$/;

class Reader {
  private at = 0;
  constructor(private readonly text: string) {}

  private skip(): void {
    for (;;) {
      const rest = this.text.slice(this.at);
      const space = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
      if (!space) return;
      this.at += space[0].length;
    }
  }

  private peek(): string {
    this.skip();
    return this.text[this.at] ?? "";
  }

  private eat(char: string): boolean {
    if (this.peek() !== char) return false;
    this.at++;
    return true;
  }

  value(): Value {
    const next = this.peek();
    if (next === "{") return this.object();
    if (next === "[") return this.array();
    if (next === '"' || next === "'" || next === "`") return this.string(next);
    const literal = /^(?:-?\d+(?:\.\d+)?|true|false|null)\b/.exec(this.text.slice(this.at));
    if (literal) {
      this.at += literal[0].length;
      const word = literal[0];
      return word === "true" ? true : word === "false" ? false : word === "null" ? null : Number(word);
    }
    this.other();
    return undefined;
  }

  private other(): void {
    let depth = 0;
    while (this.at < this.text.length) {
      const char = this.text[this.at] as string;
      if (char === '"' || char === "'" || char === "`") {
        this.string(char);
        continue;
      }
      if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) {
        if (depth === 0) return;
        depth--;
      } else if ((char === "," || char === ";") && depth === 0) return;
      this.at++;
    }
  }

  private string(quote: string): string | undefined {
    this.at++;
    let out = "";
    let plain = true;
    while (this.at < this.text.length) {
      const char = this.text[this.at] as string;
      if (char === "\\") {
        const escaped = this.text[this.at + 1] ?? "";
        out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        this.at += 2;
        continue;
      }
      if (char === quote) {
        this.at++;
        return plain ? out : undefined;
      }
      if (quote === "`" && char === "$" && this.text[this.at + 1] === "{") {
        plain = false;
        this.at += 2;
        let depth = 1;
        while (this.at < this.text.length && depth > 0) {
          const inner = this.text[this.at] as string;
          if (inner === "{") depth++;
          else if (inner === "}") depth--;
          this.at++;
        }
        continue;
      }
      out += char;
      this.at++;
    }
    return undefined;
  }

  private array(): Value[] {
    this.eat("[");
    const out: Value[] = [];
    while (this.peek() && !this.eat("]")) {
      out.push(this.value());
      this.eat(",");
    }
    return out;
  }

  private object(): { [key: string]: Value } {
    this.eat("{");
    const out: { [key: string]: Value } = {};
    while (this.peek() && !this.eat("}")) {
      if (this.text.startsWith("...", this.at)) {
        this.at += 3;
        this.other();
        this.eat(",");
        continue;
      }
      const next = this.peek();
      let key: string | undefined;
      if (next === '"' || next === "'") key = this.string(next);
      else {
        const word = /^[A-Za-z_$][\w$-]*/.exec(this.text.slice(this.at));
        if (!word) {
          this.other();
          this.eat(",");
          continue;
        }
        key = word[0];
        this.at += word[0].length;
      }
      if (this.eat(":")) {
        const value = this.value();
        if (key !== undefined && value !== undefined) out[key] = value;
      }
      this.eat(",");
    }
    return out;
  }
}

export function readLookLiteral(source: string): { [key: string]: Value } | null {
  const start = /export\s+const\s+look\b[^=]*=/.exec(source);
  if (!start) return null;
  const value = new Reader(source.slice(start.index + start[0].length)).value();
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value: Value): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function strings(value: Value): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

const COLOR_VALUE = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|hsl|oklch)a?\()/;

function cssVars(block: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of (block ?? "").matchAll(/--([a-z][a-z0-9-]*)\s*:\s*([^;]+)/g)) if (name && value && COLOR_VALUE.test(value.trim())) out[name] = value.trim();
  return out;
}

export function kitColors(theme: string): DesignView["kit"] {
  return { light: cssVars(/:root\{([^}]*)\}/.exec(theme)?.[1]), dark: cssVars(/:root\[data-scheme=dark\]\{([^}]*)\}/.exec(theme)?.[1]) };
}

const KINDS: Readonly<Record<string, CatalogFont["kind"]>> = { SANS: "sans", SERIF: "serif", MONO: "mono", CONDENSED: "condensed" };

export function fontCatalog(fonts: string): readonly CatalogFont[] {
  const block = /export\s+const\s+FONTS\s*=\s*\{([\s\S]*?)\n\}/.exec(fonts)?.[1] ?? "";
  return [...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w]*))\s*:\s*(?:fixed|variable)\([\s\S]*?,\s*([A-Z]+)\s*\),?\s*$/gm)].flatMap(([, quoted, plain, kind]) => {
    const name = quoted ?? plain;
    return name ? [{ name, kind: KINDS[kind ?? ""] ?? "sans" }] : [];
  });
}

export function draftOf(design: DesignView): DesignDraft {
  return { brand: design.brand, scheme: design.scheme, fonts: design.fonts, colors: design.colors, materials: design.materials, radius: design.radius, width: design.width };
}

const ROLES: readonly FontRoleName[] = ["display", "body", "mono"];

export function designChanges(design: DesignView, draft: DesignDraft): readonly DesignChange[] {
  const changes: DesignChange[] = [];
  const add = (what: string, from: string | null | undefined, to: string | null | undefined) => {
    if ((from ?? null) !== (to ?? null)) changes.push({ what, from: from ?? null, to: to ?? null });
  };
  add("brand", design.brand, draft.brand);
  add("scheme", design.scheme, draft.scheme);
  for (const role of ROLES) add(`${role} font`, design.fonts[role], draft.fonts[role]);
  for (const scheme of ["light", "dark"] as const) {
    const names = [...new Set([...Object.keys(design.colors[scheme]), ...Object.keys(draft.colors[scheme])])];
    for (const name of names) add(`${scheme} color ${name}`, design.colors[scheme][name], draft.colors[scheme][name]);
  }
  for (const name of [...new Set([...Object.keys(design.materials), ...Object.keys(draft.materials)])]) add(`material ${name}`, design.materials[name], draft.materials[name]);
  add("corners", design.radius, draft.radius);
  add("width", design.width, draft.width);
  return changes;
}

const said = (value: string | null, what: string) => (value === null ? (what === "scheme" ? "follow the visitor's setting" : "not set") : JSON.stringify(value));

export function designRequest(changes: readonly DesignChange[]): string | null {
  if (!changes.length) return null;
  const lines = changes.map((change) => `- ${change.what}: ${said(change.from, change.what)} -> ${said(change.to, change.what)}`);
  return `/chore Update the design system to what was chosen in the Design manager. Set each value in the app's look, in the look.ts that sets it now (or the first feature's look.ts when none does), keep every other value as it is, and run \`npm run app -- look\` until it reports no FAIL.\n${lines.join("\n")}`;
}

export function designOf(tree: Tree): DesignView {
  const sources = Object.keys(tree)
    .filter((path) => LOOK_FILE.test(path))
    .sort();
  const unread: string[] = [];
  let design: DesignView = { brand: null, description: null, scheme: null, fonts: {}, colors: { light: {}, dark: {} }, materials: {}, radius: null, accent: null, width: null, gate: null, references: [], sources, unread, kit: kitColors(tree["shared/theme.ts"] ?? ""), catalog: fontCatalog(tree["shared/fonts.ts"] ?? "") };
  for (const path of sources) {
    const look = readLookLiteral(tree[path] ?? "");
    if (!look) {
      unread.push(path);
      continue;
    }
    const colors = look["colors"] && typeof look["colors"] === "object" && !Array.isArray(look["colors"]) ? look["colors"] : {};
    const scheme = look["scheme"] === "light" || look["scheme"] === "dark" ? look["scheme"] : null;
    const references = Array.isArray(look["references"]) ? look["references"].filter((ref): ref is string => typeof ref === "string") : [];
    design = {
      ...design,
      brand: text(look["brand"]) ?? design.brand,
      description: text(look["description"]) ?? design.description,
      scheme: scheme ?? design.scheme,
      fonts: { ...design.fonts, ...strings(look["fonts"] ?? null) },
      colors: { light: { ...design.colors.light, ...strings(colors["light"] ?? null) }, dark: { ...design.colors.dark, ...strings(colors["dark"] ?? null) } },
      materials: { ...design.materials, ...strings(look["materials"] ?? null) },
      radius: text(look["radius"]) ?? design.radius,
      accent: text(look["accent"]) ?? design.accent,
      width: text(look["width"]) ?? design.width,
      gate: text(look["gate"]) ?? design.gate,
      references: [...new Set([...design.references, ...references])],
    };
  }
  return design;
}
