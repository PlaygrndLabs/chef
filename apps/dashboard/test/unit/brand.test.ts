import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faviconDataUri, LETTER, wordmarkSvg } from "@chef/core/brand";

describe("brand", () => {
  it("uses the chef mark as the dashboard favicon", () => {
    expect(readFileSync(new URL("../../index.html", import.meta.url), "utf8")).toContain(`<link rel="icon" href="${faviconDataUri()}">`);
  });

  it("shows the chef mark while the dashboard loads", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toMatch(/<div id="splash"[^>]*>.*<\/div>\n<div id="root"><\/div>/);
    expect(html).toContain(`d="${LETTER.d}"`);
  });

  it("draws the wordmark in the current text color", () => {
    expect(wordmarkSvg()).toMatch(/^<svg [^>]*fill="currentColor"[^>]*aria-label="chef"/);
  });
});
