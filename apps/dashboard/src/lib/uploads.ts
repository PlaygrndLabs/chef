export const IMAGE_LINE = /^Reference image: (uploads\/[0-9a-f]{20}\.(?:png|jpg|webp|gif|avif))$/;

export function withImages(text: string, paths: readonly string[]): string {
  if (!paths.length) return text;
  const lines = paths.map((path) => `Reference image: ${path}`).join("\n");
  return `${text || "Design from this image."}\n\n${lines}`;
}

export function splitImages(text: string): { readonly text: string; readonly images: readonly string[] } {
  const images: string[] = [];
  const kept = text.split("\n").filter((line) => {
    const found = IMAGE_LINE.exec(line.trim())?.[1];
    if (found) images.push(found);
    return !found;
  });
  return { text: kept.join("\n").trim(), images };
}
