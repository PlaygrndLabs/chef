import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, test } from "node:test";
import { closeBrowser } from "./browser.ts";
import { reference, summary } from "./ref.ts";

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
  } finally {
    server.close();
  }
});
