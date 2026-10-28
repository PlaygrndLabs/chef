import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designChanges, designOf, designRequest, draftOf, fontCatalog, kitColors, readLookLiteral } from "../../src/design/design.ts";

const TEMPLATE = join(import.meta.dirname, "..", "..", "..", "template", "shared");

describe("readLookLiteral", () => {
  it("reads a look written as a plain literal", () => {
    const source = `// the app's look
export const look = {
  brand: "Ashgrove",
  scheme: 'light',
  fonts: { display: "Anton", body: "Inter" },
  colors: { light: { bg: "#f4f4f4", "primary-fg": \`#ffffff\` } },
  radius: "1.5rem", /* rounded */
  references: ["https://ploy.ai"],
  count: 2,
  wide: true,
} as const;
`;
    expect(readLookLiteral(source)).toEqual({
      brand: "Ashgrove",
      scheme: "light",
      fonts: { display: "Anton", body: "Inter" },
      colors: { light: { bg: "#f4f4f4", "primary-fg": "#ffffff" } },
      radius: "1.5rem",
      references: ["https://ploy.ai"],
      count: 2,
      wide: true,
    });
  });

  it("reads a typed look and skips what it cannot work out", () => {
    const source = `import type { Look } from "../../shared/app.tsx";
import { base } from "./base.ts";
const ink = "#111";
export const look: Look = {
  ...base,
  brand: \`Ash \${"grove"}\`,
  accent: ink,
  style: \`.hero { color: red; }\`,
  colors: { light: { fg: shade("#000", 0.2), bg: "#fff" } },
};
`;
    expect(readLookLiteral(source)).toEqual({ style: ".hero { color: red; }", colors: { light: { bg: "#fff" } } });
  });

  it("gives null when there is no look", () => {
    expect(readLookLiteral("export const pages = [];")).toBeNull();
    expect(readLookLiteral("export const look = makeLook();")).toBeNull();
  });
});

describe("designOf", () => {
  it("merges every feature's look in path order", () => {
    const design = designOf({
      "features/brand/look.ts": `export const look = { brand: "Ashgrove", fonts: { display: "Anton", body: "Inter" }, colors: { light: { bg: "#f4f4f4", fg: "#111" }, dark: { bg: "#000" } }, references: ["https://ploy.ai"] } as const;`,
      "features/shop/frontend/look.ts": `export const look = { fonts: { body: "Geist" }, colors: { light: { accent: "#ff6fb5" } }, materials: { hero: "linear-gradient(var(--blush), var(--bg))" }, gate: "21 or older", references: ["https://ploy.ai", "https://linear.app"] } as const;`,
      "features/broken/look.ts": `export const look = build();`,
      "features/shop/frontend/page.tsx": `export const look = { brand: "Not a look file" };`,
      "shared/look.ts": `export const look = { brand: "Not a feature" };`,
    });
    expect(design).toEqual({
      brand: "Ashgrove",
      description: null,
      scheme: null,
      fonts: { display: "Anton", body: "Geist" },
      colors: { light: { bg: "#f4f4f4", fg: "#111", accent: "#ff6fb5" }, dark: { bg: "#000" } },
      materials: { hero: "linear-gradient(var(--blush), var(--bg))" },
      radius: null,
      accent: null,
      width: null,
      gate: "21 or older",
      references: ["https://ploy.ai", "https://linear.app"],
      sources: ["features/brand/look.ts", "features/broken/look.ts", "features/shop/frontend/look.ts"],
      unread: ["features/broken/look.ts"],
      kit: { light: {}, dark: {} },
      catalog: [],
    });
  });

  it("is empty for a project without a look", () => {
    expect(designOf({ "features/todo/page.tsx": "" })).toMatchObject({ brand: null, sources: [], unread: [], fonts: {}, references: [] });
  });
});

describe("the design manager", () => {
  it("reads the kit's own colors and the font catalog from the project", () => {
    const kit = kitColors(readFileSync(join(TEMPLATE, "theme.ts"), "utf8"));
    expect(kit.light).toMatchObject({ bg: "#fafafa", fg: "#09090b", primary: "#18181b", accent: "#4f46e5" });
    expect(kit.dark).toMatchObject({ bg: "#09090b", fg: "#fafafa", accent: "#818cf8" });
    expect(kit.light["radius"]).toBeUndefined();
    const catalog = fontCatalog(readFileSync(join(TEMPLATE, "fonts.ts"), "utf8"));
    expect(catalog).toContainEqual({ name: "Anton", kind: "condensed" });
    expect(catalog).toContainEqual({ name: "Fraunces", kind: "serif" });
    expect(catalog).toContainEqual({ name: "Big Shoulders Display", kind: "condensed" });
    expect(catalog).toContainEqual({ name: "JetBrains Mono", kind: "mono" });
    expect(catalog.length).toBeGreaterThanOrEqual(20);
  });

  it("lists what the draft changed and asks Chef to write it into the look", () => {
    const design = designOf({ "features/brand/look.ts": `export const look = { brand: "Fernhouse", fonts: { display: "Fraunces" }, colors: { light: { bg: "#f6f1e7", primary: "#2c4a34" }, dark: {} }, radius: "1.25rem" } as const;` });
    const draft = draftOf(design);
    expect(designChanges(design, draft)).toEqual([]);
    expect(designRequest([])).toBeNull();
    const changes = designChanges(design, { ...draft, scheme: "dark", fonts: { display: "Anton", body: "Inter" }, colors: { light: { ...draft.colors.light, primary: "#e8743b" }, dark: { bg: "#14261d" } }, materials: { hero: "linear-gradient(var(--bg), var(--primary))" }, radius: "0.25rem" });
    expect(changes).toEqual([
      { what: "scheme", from: null, to: "dark" },
      { what: "display font", from: "Fraunces", to: "Anton" },
      { what: "body font", from: null, to: "Inter" },
      { what: "light color primary", from: "#2c4a34", to: "#e8743b" },
      { what: "dark color bg", from: null, to: "#14261d" },
      { what: "material hero", from: null, to: "linear-gradient(var(--bg), var(--primary))" },
      { what: "corners", from: "1.25rem", to: "0.25rem" },
    ]);
    const request = designRequest(changes) ?? "";
    expect(request.startsWith("/chore Update the design system")).toBe(true);
    expect(request).toContain('- scheme: follow the visitor\'s setting -> "dark"');
    expect(request).toContain('- light color primary: "#2c4a34" -> "#e8743b"');
    expect(request).toContain('- body font: not set -> "Inter"');
  });
});

describe("withReferenceImages", () => {
  it("carries the request's attached images into a part that lost them", async () => {
    const { withReferenceImages } = await import("../../src/orchestrator/orchestrator.ts");
    const whole = "Build a shop and a landing\n\nReference image: uploads/0123456789abcdef0123.png";
    expect(withReferenceImages("Build the landing", whole)).toBe("Build the landing\n\nReference image: uploads/0123456789abcdef0123.png");
    expect(withReferenceImages(whole, whole)).toBe(whole);
    expect(withReferenceImages("Build the shop", "Build a shop")).toBe("Build the shop");
  });
});
