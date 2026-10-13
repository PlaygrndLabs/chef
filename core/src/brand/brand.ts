export const BLUE = "#004dfc";

export const MARK = { viewBox: "-15 0 270 270", d: "M96 0H240V70H96ZM0 70H96V200H0ZM96 200H240V270H96Z" };

export const WORDMARK = { viewBox: "0 0 908 270", width: 908, height: 270, d: "M439 103.4A92 80 0 1 0 445 216.38L411 189.44A46 40 0 1 1 407 132.18ZM456.5 237.5V24.5H501.5V95.72A65 48 0 0 1 612 130V237.5H566V155.5A32.25 34 0 0 0 501.5 155.5V237.5ZM787.68 190A85.25 80.5 0 1 1 791.61 176.5H669.71A40.5 44.5 0 0 0 739.48 190ZM670.21 146A40.5 44.5 0 0 1 745.79 146ZM814.5 237.5V138H800.5V98H814.5V95A60 77.5 0 0 1 874.5 17.5H907.5V44L873 68Q860 77.5 860 95V98H897V138H860V237.5Z" };

export function wordmarkSvg(attributes = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK.viewBox}" fill="currentColor" role="img" aria-label="chef"${attributes ? ` ${attributes}` : ""}><path fill="${BLUE}" d="${MARK.d}"/><path fill-rule="evenodd" d="${WORDMARK.d}"/></svg>`;
}

export function markSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}"><path fill="${BLUE}" d="${MARK.d}"/></svg>`;
}

export function faviconDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg())}`;
}
