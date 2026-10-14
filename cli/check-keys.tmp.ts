import { chromium } from "playwright";
const base = "https://chef-dev.playgrndlabs.workers.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
await page.goto(`${base}/`);
const field = page.locator('form[action="/login"] input[name="password"]');
if (await field.count()) {
  await field.fill(process.env["CHEF_PASSWORD"] ?? "");
  await Promise.all([page.waitForNavigation(), page.locator('form[action="/login"] button').click()]);
}
const settings = (await (await page.request.get(`${base}/api/settings`)).json()) as { llm: { kind: string; keyHint: string; source: string } | null; voice: { kind: string; keyHint: string } | null; models: Record<string, string> };
console.log("api llm", settings.llm?.kind, settings.llm?.source, "hint shape", /^….{4}$/.test(settings.llm?.keyHint ?? ""));
console.log("api voice", settings.voice?.kind ?? "none", "voice model", settings.models["voice"]);
await page.goto(`${base}/?settings=app.models`);
const dialog = page.locator('[data-dialog="settings"]');
await dialog.waitFor({ timeout: 30_000 });
await dialog.getByLabel("Voice model").waitFor({ timeout: 30_000 });
console.log("ui voice model field", await dialog.getByLabel("Voice model").inputValue());
const llm = dialog.locator('#settings-llm [data-current="llm"]');
console.log("ui llm masked", await llm.locator("[data-key-hint]").count(), "text dots", (await llm.innerText()).includes("••••"), "replace", await llm.getByRole("button", { name: "Replace" }).count());
console.log("ui voice provider group", await dialog.locator("#settings-voice").count(), "voice tab", await dialog.locator('[data-settings-nav="voice"]').count());
console.log("ui save disabled", await dialog.locator("#settings-llm").getByRole("button", { name: "Save" }).isDisabled());
await browser.close();
