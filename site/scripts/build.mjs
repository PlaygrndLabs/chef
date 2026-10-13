import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
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
cpSync(join(site, "public"), out, { recursive: true });
