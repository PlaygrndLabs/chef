import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { FONTS } from "../../template/shared/fonts.ts";

export const PREVIEW_FONTS_DIR = "preview-fonts";

export interface PreviewFace {
  readonly file: string;
  readonly weight: string;
  readonly style: string;
  readonly unicodeRange: string;
}

export type PreviewFonts = Readonly<Record<string, { readonly family: string; readonly faces: readonly PreviewFace[] }>>;

const FACE = /\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
const SUBSETS = /-(?:latin|arabic)-(?!ext)/;

function field(block: string, name: string): string {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim().replace(/^'|'$/g, "") ?? "";
}

export function previewFonts(modules: string): { readonly manifest: PreviewFonts; readonly files: ReadonlyMap<string, string> } {
  const manifest: Record<string, { family: string; faces: PreviewFace[] }> = {};
  const files = new Map<string, string>();
  for (const [name, font] of Object.entries(FONTS)) {
    const dir = join(modules, font.pkg);
    const faces: PreviewFace[] = [];
    for (const sheet of font.css) {
      for (const [, label, block] of readFileSync(join(dir, sheet), "utf8").matchAll(FACE)) {
        const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block ?? "")?.[1];
        if (!label || !block || !file || !SUBSETS.test(label)) continue;
        files.set(file, join(dir, "files", file));
        faces.push({ file: `${PREVIEW_FONTS_DIR}/${file}`, weight: field(block, "font-weight"), style: field(block, "font-style"), unicodeRange: field(block, "unicode-range") });
      }
    }
    manifest[name] = { family: font.family, faces };
  }
  return { manifest, files };
}

export function previewFontsPlugin(modules: string): Plugin {
  const fonts = () => previewFonts(modules);
  return {
    name: "chef-preview-fonts",
    configureServer(server) {
      const { manifest, files } = fonts();
      server.middlewares.use(`/${PREVIEW_FONTS_DIR}/`, (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
        if (name === "fonts.json") return void res.setHeader("content-type", "application/json").end(JSON.stringify(manifest));
        const path = files.get(name);
        if (!path) return next();
        res.setHeader("content-type", "font/woff2").end(readFileSync(path));
      });
    },
    generateBundle() {
      const { manifest, files } = fonts();
      this.emitFile({ type: "asset", fileName: `${PREVIEW_FONTS_DIR}/fonts.json`, source: JSON.stringify(manifest) });
      for (const [name, path] of files) this.emitFile({ type: "asset", fileName: `${PREVIEW_FONTS_DIR}/${name}`, source: readFileSync(path) });
    },
  };
}
