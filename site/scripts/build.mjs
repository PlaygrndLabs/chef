import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const dashboard = join(site, "..", "apps", "dashboard", "dist");
const out = join(site, "dist");

if (!existsSync(join(dashboard, "index.html"))) {
  console.error("build the dashboard first: pnpm build");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(dashboard, out, { recursive: true });
renameSync(join(out, "index.html"), join(out, "app.html"));
const app = readFileSync(join(out, "app.html"), "utf8");
if (!app.includes("<head>")) throw new Error("the dashboard page has no <head>");
writeFileSync(join(out, "app.html"), app.replace("<head>", '<head>\n<meta name="chef-host" content="site">'));
cpSync(join(site, "public"), out, { recursive: true });
