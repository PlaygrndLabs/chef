import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FeatureFrontmatter, type FeatureSpec } from "./schema.ts";

export type ParseResult = { ok: true; spec: FeatureSpec } | { ok: false; errors: string[] };

export function parseFeature(source: string): ParseResult {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) return { ok: false, errors: ["missing frontmatter block delimited by ---"] };
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? "");
  } catch (error) {
    return { ok: false, errors: [`invalid YAML: ${(error as Error).message}`] };
  }
  const result = FeatureFrontmatter.safeParse(data);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  }
  return { ok: true, spec: { ...result.data, body: (match[2] ?? "").trim() } };
}

export function renderFeature(spec: FeatureSpec): string {
  const { body, ...frontmatter } = spec;
  const ordered = {
    id: frontmatter.id,
    title: frontmatter.title,
    status: frontmatter.status,
    entrypoint: frontmatter.entrypoint,
    ...(frontmatter.flow ? { flow: frontmatter.flow } : {}),
    revision: frontmatter.revision,
    ...(frontmatter.shared.length > 0 ? { shared: frontmatter.shared } : {}),
    acceptance: frontmatter.acceptance,
  };
  return `---\n${stringifyYaml(ordered).trimEnd()}\n---\n\n${body.trim()}\n`;
}
