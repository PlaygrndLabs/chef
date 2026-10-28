export type MainSection = "app" | "design" | "history";

export const OPEN_DESIGN = "chef:design";

export function rememberedSection(project: string): MainSection {
  try {
    const saved = localStorage.getItem(`chef:main:${project}`);
    return saved === "history" || saved === "design" ? saved : "app";
  } catch {
    return "app";
  }
}

export function rememberSection(project: string, section: MainSection): void {
  try {
    localStorage.setItem(`chef:main:${project}`, section);
  } catch {
    return;
  }
}

export function openDesign(project: string): void {
  rememberSection(project, "design");
  window.setTimeout(() => window.dispatchEvent(new Event(OPEN_DESIGN)), 0);
}
