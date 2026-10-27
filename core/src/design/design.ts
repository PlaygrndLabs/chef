import type { Tree } from "../git/tree.ts";

export type FontRoleName = "display" | "body" | "mono";

export interface DesignView {
  readonly brand: string | null;
  readonly description: string | null;
  readonly scheme: "light" | "dark" | null;
  readonly fonts: Partial<Record<FontRoleName, string>>;
  readonly colors: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
  readonly radius: string | null;
  readonly accent: string | null;
  readonly width: string | null;
  readonly gate: string | null;
  readonly references: readonly string[];
  readonly sources: readonly string[];
  readonly unread: readonly string[];
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

export function designOf(tree: Tree): DesignView {
  const sources = Object.keys(tree)
    .filter((path) => LOOK_FILE.test(path))
    .sort();
  const unread: string[] = [];
  let design: DesignView = { brand: null, description: null, scheme: null, fonts: {}, colors: { light: {}, dark: {} }, radius: null, accent: null, width: null, gate: null, references: [], sources, unread };
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
      radius: text(look["radius"]) ?? design.radius,
      accent: text(look["accent"]) ?? design.accent,
      width: text(look["width"]) ?? design.width,
      gate: text(look["gate"]) ?? design.gate,
      references: [...new Set([...design.references, ...references])],
    };
  }
  return design;
}
