import { readdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BLUE, PAPER } from "../../src/brand/brand.ts";
import { brandFiles, markPixels, markPng } from "../../src/brand/files.ts";

const assets = new URL("../../../docs/assets/", import.meta.url);

function pixelsOf(png: Uint8Array): Uint8Array {
  const bytes = Buffer.from(png);
  const parts: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT") parts.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  return inflateSync(Buffer.concat(parts));
}

function colorAt(pixels: Uint8Array, size: number, x: number, y: number): string {
  const at = y * (size * 3 + 1) + 1 + x * 3;
  return `#${[...pixels.subarray(at, at + 3)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

describe("brand files", () => {
  it("keeps the README's logo files exactly as the brand draws them", () => {
    const files = brandFiles();
    expect(readdirSync(assets).sort()).toEqual(Object.keys(files).sort());
    for (const [name, content] of Object.entries(files)) {
      const saved = readFileSync(new URL(name, assets));
      if (typeof content === "string") expect(saved.toString("utf8"), name).toBe(`${content}\n`);
      else expect(Buffer.from(pixelsOf(saved)).equals(Buffer.from(pixelsOf(content))), name).toBe(true);
    }
  });

  it("draws the mark as square blue blocks on white, with no rounded corners", () => {
    const size = 1024;
    const pixels = markPixels(size);
    expect(colorAt(pixels, size, 0, 0)).toBe(PAPER);
    expect(colorAt(pixels, size, size - 1, size - 1)).toBe(PAPER);
    expect(colorAt(pixels, size, 300, 500)).toBe(BLUE);
    expect(colorAt(pixels, size, 455, 188)).toBe(BLUE);
    expect(colorAt(pixels, size, 799, 835)).toBe(BLUE);
    expect(colorAt(pixels, size, 600, 500)).toBe(PAPER);
  });

  it("writes a real PNG of the asked size", () => {
    const png = Buffer.from(markPng(256));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
    expect(Buffer.from(pixelsOf(png)).equals(Buffer.from(markPixels(256)))).toBe(true);
  });
});
