export const BLUE = "#004dfc";

export const INK = "#16171a";

export const PAPER = "#ffffff";

export const MARK = { viewBox: "-15 0 270 270", d: "M96 0H240V70H96ZM0 70H96V200H0ZM96 200H240V270H96Z" };

export const WORDMARK = { viewBox: "0 0 943 270", width: 943, height: 270, d: "M474 103.4A92 80 0 1 0 480 216.38L446 189.44A46 40 0 1 1 442 132.18ZM491.5 237.5V24.5H536.5V95.72A65 48 0 0 1 647 130V237.5H601V155.5A32.25 34 0 0 0 536.5 155.5V237.5ZM822.68 190A85.25 80.5 0 1 1 826.61 176.5H704.71A40.5 44.5 0 0 0 774.48 190ZM705.21 146A40.5 44.5 0 0 1 780.79 146ZM849.5 237.5V138H835.5V98H849.5V95A60 77.5 0 0 1 909.5 17.5H942.5V44L908 68Q895 77.5 895 95V98H932V138H895V237.5Z" };

export function wordmarkSvg(attributes = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK.viewBox}" fill="currentColor" role="img" aria-label="chef"${attributes ? ` ${attributes}` : ""}><path fill="${BLUE}" d="${MARK.d}"/><path fill-rule="evenodd" d="${WORDMARK.d}"/></svg>`;
}

export function markSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}"><path fill="${BLUE}" d="${MARK.d}"/></svg>`;
}

export function faviconDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg())}`;
}

export function logoSvg(ink: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK.viewBox}" width="${WORDMARK.width / 4}" height="${WORDMARK.height / 4}" role="img" aria-label="chef"><path fill="${BLUE}" d="${MARK.d}"/><path fill="${ink}" fill-rule="evenodd" d="${WORDMARK.d}"/></svg>`;
}
