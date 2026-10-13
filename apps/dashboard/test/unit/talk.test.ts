import { describe, expect, it } from "vitest";
import { clampSpot } from "../../src/lib/talk.ts";

describe("talk button position", () => {
  const area = { width: 800, height: 600 };

  it("keeps a position that fits", () => {
    expect(clampSpot({ right: 24, bottom: 112 }, area, 56)).toEqual({ right: 24, bottom: 112 });
  });

  it("keeps the button inside the area when dragged past an edge", () => {
    expect(clampSpot({ right: -40, bottom: 900 }, area, 56)).toEqual({ right: 8, bottom: 536 });
  });

  it("pulls the button back in when the area shrinks", () => {
    expect(clampSpot({ right: 700, bottom: 500 }, { width: 400, height: 300 }, 56)).toEqual({ right: 336, bottom: 236 });
  });
});
