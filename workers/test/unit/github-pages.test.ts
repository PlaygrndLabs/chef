import { describe, expect, it } from "vitest";
import { manifestPage, safeReturn } from "../../src/github-pages.ts";

describe("GitHub connect pages", () => {
  it("only returns to paths on this chef", () => {
    expect(safeReturn("/?project=todo&connect=github")).toBe("/?project=todo&connect=github");
    expect(safeReturn("https://evil.example")).toBe("/");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn(null)).toBe("/");
  });

  it("posts the manifest to GitHub with its JSON escaped into the form", async () => {
    const html = await manifestPage("https://github.com/settings/apps/new?state=a&b", { name: `x"><script>` }).text();
    expect(html).toContain(`action="https://github.com/settings/apps/new?state=a&amp;b"`);
    expect(html).toContain(`value="{&quot;name&quot;:&quot;x\\&quot;&gt;&lt;script&gt;&quot;}"`);
    expect(html).not.toContain(`x"><script>`);
  });
});
