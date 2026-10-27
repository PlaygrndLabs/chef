import { describe, expect, it } from "vitest";
import { designOf, readLookLiteral } from "../../src/design/design.ts";

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
      "features/shop/frontend/look.ts": `export const look = { fonts: { body: "Geist" }, colors: { light: { accent: "#ff6fb5" } }, gate: "21 or older", references: ["https://ploy.ai", "https://linear.app"] } as const;`,
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
      radius: null,
      accent: null,
      width: null,
      gate: "21 or older",
      references: ["https://ploy.ai", "https://linear.app"],
      sources: ["features/brand/look.ts", "features/broken/look.ts", "features/shop/frontend/look.ts"],
      unread: ["features/broken/look.ts"],
    });
  });

  it("is empty for a project without a look", () => {
    expect(designOf({ "features/todo/page.tsx": "" })).toMatchObject({ brand: null, sources: [], unread: [], fonts: {}, references: [] });
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
