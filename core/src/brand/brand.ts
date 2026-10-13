export const BLUE = "#004dfc";

export const MARK = { viewBox: "-45 0 270 270", d: "M90 0H180V90H90ZM0 90H90V180H0ZM90 180H180V270H90Z" };

export const WORDMARK = { viewBox: "0 0 848 270", width: 848, height: 270, d: "M379 103.4A92 80 0 1 0 385 216.38L351 189.44A46 40 0 1 1 347 132.18ZM396.5 237.5V24.5H441.5V95.72A65 48 0 0 1 552 130V237.5H506V155.5A32.25 34 0 0 0 441.5 155.5V237.5ZM727.68 190A85.25 80.5 0 1 1 731.61 176.5H609.71A40.5 44.5 0 0 0 679.48 190ZM610.21 146A40.5 44.5 0 0 1 685.79 146ZM754.5 237.5V138H740.5V98H754.5V95A60 77.5 0 0 1 814.5 17.5H847.5V44L813 68Q800 77.5 800 95V98H837V138H800V237.5Z" };

export function wordmarkSvg(attributes = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK.viewBox}" fill="currentColor" role="img" aria-label="chef"${attributes ? ` ${attributes}` : ""}><path fill="${BLUE}" d="${MARK.d}"/><path fill-rule="evenodd" d="${WORDMARK.d}"/></svg>`;
}

export function markSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}"><path fill="${BLUE}" d="${MARK.d}"/></svg>`;
}

export function faviconDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg())}`;
}
