import { crc32, deflateSync } from "node:zlib";
import { BLUE, INK, logoSvg, MARK, markSvg, PAPER } from "./brand.ts";

const SQUARES = [...MARK.d.matchAll(/M(\d+) (\d+)H(\d+)V(\d+)H\d+Z/g)].map((match) => {
  const [left, top, right, bottom] = match.slice(1).map(Number) as [number, number, number, number];
  return { left: Math.min(left, right), top, right: Math.max(left, right), bottom };
});

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function overlap(from: number, to: number, pixel: number): number {
  return Math.max(0, Math.min(to, pixel + 1) - Math.max(from, pixel));
}

export function markPixels(size: number): Uint8Array {
  const [width, height] = MARK.viewBox.split(" ").slice(2).map(Number) as [number, number];
  const scale = (size * 81) / 128 / height;
  const shiftX = (size - width * scale) / 2 + 15 * scale;
  const shiftY = (size - height * scale) / 2;
  const ink = rgb(BLUE);
  const paper = rgb(PAPER);
  const rows = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (const square of SQUARES) cover += overlap(square.left * scale + shiftX, square.right * scale + shiftX, x) * overlap(square.top * scale + shiftY, square.bottom * scale + shiftY, y);
      cover = Math.min(1, cover);
      rows.set(paper.map((value, channel) => Math.round(value + ((ink[channel] ?? value) - value) * cover)), row + 1 + x * 3);
    }
  }
  return rows;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function markPng(size: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(markPixels(size), { level: 9 })), chunk("IEND", new Uint8Array())]);
}

export function brandFiles(): Record<string, string | Uint8Array> {
  return {
    "chef-logo.svg": logoSvg(INK),
    "chef-logo-dark.svg": logoSvg(PAPER),
    "favicon.svg": markSvg(),
    "logo.png": markPng(256),
    "logo-1024.png": markPng(1024),
  };
}
