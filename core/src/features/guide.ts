export const MAP_PROMPT = "Explore this project and add its current features to the feature list";

export const MAP_SUGGESTION = {
  title: "Map the current features",
  why: "Explores the code and fills the feature list with what the app already does, each with how to reach it.",
  prompt: MAP_PROMPT,
} as const;

export function isMapRequest(prompt: string): boolean {
  const text = prompt.trim();
  if (text === MAP_PROMPT || /^\/map\b/i.test(text)) return true;
  if (text.length > 160 || /\b(build|implement|fix|delete|remove)\b/i.test(text)) return false;
  return /\b(map|explore|scan|populate|fill|discover)\b/i.test(text) && /\bfeatures?\b/i.test(text) && /\b(current|existing|feature (list|tree|map))\b/i.test(text);
}
