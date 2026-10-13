import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faviconDataUri, wordmarkSvg } from "@chef/core/brand";

describe("brand", () => {
  it("uses the chef mark as the dashboard favicon", () => {
    expect(readFileSync(new URL("../../index.html", import.meta.url), "utf8")).toContain(`<link rel="icon" href="${faviconDataUri()}">`);
  });

  it("draws the wordmark in the current text color", () => {
    expect(wordmarkSvg()).toMatch(/^<svg [^>]*fill="currentColor"[^>]*aria-label="chef"/);
  });
});
