import { describe, expect, it } from "vitest";
import { addressWith, currentAddress } from "../../src/lib/address.ts";

const at = (search: string, pathname = "/", hash = "") => ({ pathname, search, hash });

describe("writing the address bar", () => {
  it("leaves no question mark once the last setting is gone", () => {
    expect(addressWith(new URLSearchParams(), at("?settings=app.general"))).toBe("/");
    expect(addressWith(new URLSearchParams(""), at("?connect=new", "/app"))).toBe("/app");
  });

  it("keeps the remaining settings, the path and the hash", () => {
    expect(addressWith(new URLSearchParams({ project: "shop", panel: "app" }), at("", "/app", "#top"))).toBe("/app?project=shop&panel=app#top");
  });

  it("matches the current address when nothing changed", () => {
    const place = at("?project=shop");
    expect(addressWith(new URLSearchParams(place.search), place)).toBe(currentAddress(place));
    expect(addressWith(new URLSearchParams(), at(""))).toBe(currentAddress(at("")));
  });
});
