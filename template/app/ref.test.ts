import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { browser, closeBrowser } from "./browser.ts";
import { reference, referenceOf, summary, uploadAddress } from "./ref.ts";

const anton = join(import.meta.dirname, "..", "node_modules", "@fontsource", "anton", "files", "anton-latin-400-normal.woff2");

const page = `<!doctype html><html><head><title>Mystery Co</title><style>
@font-face{font-family:"Mystery Display";src:url(/display.woff2) format("woff2")}
body{margin:0;background:#f4f4f4;color:#212121;font-family:Inter,sans-serif}
h1{font-family:"Mystery Display";font-size:120px;text-transform:uppercase;margin:0}
.block{background:#ffb8fc;border-radius:32px;height:400px;margin:24px}
a.btn{display:inline-block;background:#111111;color:#ffffff;border-radius:999px;padding:12px 24px}
</style></head><body><h1>Big words</h1><p>Plain body copy that runs long enough to be the body text of the page.</p><a class="btn" href="#">Start</a><div class="block"></div></body></html>`;

after(closeBrowser);

test("a reference site gives its fonts with the closest ones Chef ships, its colors, buttons and corners", async () => {
  const font = await readFile(anton);
  const server = createServer((req, res) => {
    if (req.url === "/display.woff2") res.writeHead(200, { "content-type": "font/woff2" }).end(font);
    else res.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const ref = await reference(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    assert.equal(ref.title, "Mystery Co");
    assert.equal(ref.fonts.display?.family, "Mystery Display");
    assert.equal(ref.fonts.display?.upper, true);
    assert.equal(ref.fonts.display?.closest, "Anton");
    assert.equal(ref.fonts.body?.closest, "Inter");
    assert.deepEqual([ref.colors.bg, ref.colors.fg], ["#f4f4f4", "#212121"]);
    assert.ok(ref.colors.accents.includes("#ffb8fc"), ref.colors.accents.join(" "));
    assert.deepEqual(ref.button, { bg: "#111111", fg: "#ffffff", pill: true });
    assert.equal(ref.radius, 32);
    assert.match(summary(ref), /"display": "Anton"/);
    assert.match(summary(ref), /"references": \[\s*"http:\/\/127\.0\.0\.1:\d+\/"\s*\]/);
  } finally {
    server.close();
  }
});

async function picture(html: string): Promise<Buffer> {
  const context = await (await browser()).newContext({ viewport: { width: 1200, height: 800 } });
  try {
    const page = await context.newPage();
    await page.setContent(html);
    return await page.screenshot();
  } finally {
    await context.close();
  }
}

const mockup = `<body style="margin:0;background:#f4f4f4;font-family:sans-serif;color:#212121">
<h1 style="font-size:140px;margin:40px;font-weight:900">BIG WORDS</h1>
<p style="font-size:28px;margin:40px">Body copy in the same dark ink, long enough to count as text.</p>
<div style="display:flex;gap:24px;margin:40px"><div style="background:#ffb8fc;width:360px;height:220px;border-radius:24px"></div><div style="background:#c8f560;width:360px;height:220px;border-radius:24px"></div><div style="background:#ffffff;width:300px;height:220px;border-radius:24px"></div></div></body>`;

test("a screenshot or mockup gives its page, text, surface and accent colors and a starting look", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ref-image-"));
  const file = join(dir, "mockup.png");
  await writeFile(file, await picture(mockup));
  const ref = await referenceOf(file, join(dir, "out"));
  assert.equal(ref.kind, "image");
  assert.equal(ref.title, "1200x800 image");
  assert.equal(ref.colors.bg, "#f4f4f4");
  assert.equal(ref.colors.fg, "#212121");
  assert.deepEqual(ref.colors.accents.slice(0, 2).sort(), ["#c8f560", "#ffb8fc"]);
  assert.deepEqual(ref.colors.surfaces, ["#ffffff"]);
  assert.deepEqual(ref.shots, [join(dir, "out", "ref-image.png")]);
  const text = summary(ref);
  assert.match(text, /an image has no font names/);
  assert.match(text, /"scheme": "light"/);
  assert.doesNotMatch(text, /"fonts"/);
});

test("an image address without an extension is read as an image, and a dark one gives a dark look", async () => {
  const png = await picture(`<body style="margin:0;background:#0b0b0f;color:#f5f5f5;font:64px sans-serif"><p style="margin:60px">Night mode copy that is long enough</p><div style="background:#7c5cff;height:200px;margin:60px"></div></body>`);
  const server = createServer((_req, res) => res.writeHead(200, { "content-type": "image/png" }).end(png));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const ref = await referenceOf(`http://127.0.0.1:${(server.address() as AddressInfo).port}/shot`);
    assert.equal(ref.kind, "image");
    assert.equal(ref.colors.bg, "#0b0b0f");
    assert.equal(ref.colors.fg, "#f5f5f5");
    assert.deepEqual(ref.colors.accents, ["#7c5cff"]);
    assert.match(summary(ref), /"scheme": "dark",\s*"colors": \{\s*"dark": \{\s*"bg": "#0b0b0f"/);
  } finally {
    server.close();
  }
});

test("uploads/name points at the address where the sandbox reads uploaded files", () => {
  assert.equal(uploadAddress("uploads/abc-123.png"), "http://198.18.0.4/abc-123.png");
  assert.equal(uploadAddress("https://ploy.ai"), "https://ploy.ai");
});
