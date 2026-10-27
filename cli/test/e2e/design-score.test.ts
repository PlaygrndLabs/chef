import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { LlmEndpoint } from "@chef/adapters/anthropic";
import { designTable, scoreDesign } from "../../src/design-score.ts";

function pngSize(file: string): [number, number] {
  const png = readFileSync(file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("design score", () => {
  it("cuts main's app shots into tiles, asks the judge and keeps the build's time and spend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chef-design-"));
    const browser = await chromium.launch();
    const shots: string[] = [];
    const take = async (name: string, width: number, height: number, color: string) => {
      const page = await browser.newPage({ viewport: { width, height: 400 } });
      await page.setContent(`<body style="margin:0"><div style="height:${height}px;background:linear-gradient(${color},#000)"></div></body>`);
      const file = `${String(shots.length + 1).padStart(3, "0")}-${name}.png`;
      await page.screenshot({ path: join(dir, file), fullPage: true });
      await page.close();
      shots.push(file);
    };
    await take("look-desktop", 1440, 900, "#f4f4f4");
    await take("look-desktop-after-click", 1440, 2600, "#ffb8fc");
    await take("look-desktop-dark", 1440, 2600, "#111111");
    await take("look-phone", 390, 2000, "#c0ffee");
    await take("project-design", 1440, 900, "#ffffff");
    await browser.close();
    writeFileSync(join(dir, "report.json"), JSON.stringify({ shots }));
    writeFileSync(join(dir, "events.jsonl"), [{ event: { type: "route.decided", at: 1_000 } }, { event: { type: "main.merged", at: 151_000 } }].map((e) => JSON.stringify(e)).join("\n"));
    writeFileSync(join(dir, "usage.json"), JSON.stringify({ usage: { spent: 0.4567 } }));

    interface Sent {
      readonly messages: readonly { readonly content: readonly { readonly type: string; readonly text?: string }[] }[];
    }
    const sent: Sent[] = [];
    const parse = async (body: Sent) => {
      sent.push(body);
      return { stop_reason: "end_turn", parsed_output: { typography: 7, color: 8, layout: 6, polish: 5, phone: 6, fit: 9, verdict: "Close to a real brand site.", fixes: ["Add product photos"] } };
    };
    const llm = { client: { messages: { parse } }, via: "custom", serverFallbacks: false } as unknown as LlmEndpoint;
    const result = await scoreDesign({ dir, name: "landing", request: "A landing page", llm, model: "judge" });

    expect(result.error).toBeNull();
    expect(result.mergeSeconds).toBe(150);
    expect(result.spent).toBe(0.46);
    expect(result.scores?.overall).toBe(6.8);
    const content = sent[0]?.messages[0]?.content ?? [];
    expect(content.filter((part) => part.type === "image")).toHaveLength(6);
    const text = content.at(-1)?.text ?? "";
    expect(text).toContain("1. desktop, the gate a first-time visitor sees");
    expect(text).toContain("2. desktop, light, part 1 of 3 from the top");
    expect(text).toContain("5. desktop with the visitor's setting on dark, top");
    expect(text).toContain("6. phone, the first 3 screens side by side, left to right");
    expect(pngSize(join(dir, "judged-2.png"))).toEqual([1440, 1000]);
    expect(pngSize(join(dir, "judged-4.png"))).toEqual([1440, 600]);
    expect(pngSize(join(dir, "judged-6.png"))).toEqual([390 * 3 + 32, 844]);

    const table = designTable([result, { name: "dashboard", request: "x", mergeSeconds: null, spent: null, scores: null, error: "no screenshots" }]);
    expect(table).toContain("## Design benchmark: 6.8 / 10");
    expect(table).toContain("| landing | **6.8** | 7 | 8 | 6 | 5 | 6 | 9 | 2m30s | $0.46 |");
    expect(table).toContain("| dashboard | **–** |");
    expect(table).toContain("**dashboard**: not scored: no screenshots");
  });
});
