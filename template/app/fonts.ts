import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FONT_ROLES, FONTS, fontStack, isFont, type Font, type FontName, type FontRole } from "../shared/fonts.ts";

export interface FontAssets {
  readonly css: string;
  readonly files: ReadonlyMap<string, string>;
}

const FILE_URL = /url\(\.\/files\/([^)]+)\)/g;

export function chosenFonts(fonts: Partial<Record<FontRole, unknown>> | undefined): Partial<Record<FontRole, FontName>> {
  const chosen: Partial<Record<FontRole, FontName>> = {};
  for (const role of FONT_ROLES) {
    const name = fonts?.[role];
    if (isFont(name)) chosen[role] = name;
  }
  return chosen;
}

export async function fontAssets(fonts: Partial<Record<FontRole, unknown>> | undefined, modules: string): Promise<FontAssets> {
  const chosen = chosenFonts(fonts);
  const files = new Map<string, string>();
  const faces: string[] = [];
  for (const name of new Set(Object.values(chosen))) {
    const font: Font = FONTS[name];
    for (const sheet of font.css) {
      const dir = join(modules, font.pkg);
      const text = await readFile(join(dir, sheet), "utf8");
      faces.push(
        text.replace(FILE_URL, (_, file: string) => {
          files.set(file, join(dir, "files", file));
          return `url(/fonts/${file})`;
        }),
      );
    }
  }
  const vars = FONT_ROLES.flatMap((role) => (chosen[role] ? [`--font-${role}:${fontStack(chosen[role])}`] : []));
  return { css: [...faces, vars.length ? `:root{${vars.join(";")}}` : ""].join("\n").trim(), files };
}
