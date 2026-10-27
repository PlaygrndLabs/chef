import { describe, expect, it } from "vitest";
import { splitImages, withImages } from "../../src/lib/uploads.ts";

describe("attached images in a prompt", () => {
  it("adds one reference line per image and reads them back out", () => {
    const text = withImages("Make the landing look like this", ["uploads/0123456789abcdef0123.png", "uploads/fedcba9876543210fedc.jpg"]);
    expect(text).toBe("Make the landing look like this\n\nReference image: uploads/0123456789abcdef0123.png\nReference image: uploads/fedcba9876543210fedc.jpg");
    expect(splitImages(text)).toEqual({ text: "Make the landing look like this", images: ["uploads/0123456789abcdef0123.png", "uploads/fedcba9876543210fedc.jpg"] });
  });

  it("gives an image with no words a request of its own and leaves other text alone", () => {
    expect(withImages("", ["uploads/0123456789abcdef0123.webp"])).toBe("Design from this image.\n\nReference image: uploads/0123456789abcdef0123.webp");
    expect(withImages("Just words", [])).toBe("Just words");
    expect(splitImages("Reference image: uploads/../secret.png")).toEqual({ text: "Reference image: uploads/../secret.png", images: [] });
  });
});
