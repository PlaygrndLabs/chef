import { describe, expect, it } from "vitest";
import { exitedForMemory, nextStep, oomKills, SANDBOX_SIZES, sandboxSize, sizeLabel } from "../../src/sandbox-size.ts";

describe("sandbox sizes", () => {
  it("start with 3 GiB on one vCPU and grow to the largest custom instance", () => {
    expect(sandboxSize(undefined)).toEqual({ vcpu: 1, memoryMib: 3072, diskMb: 12_000 });
    expect(sizeLabel(sandboxSize(0))).toBe("3 GiB memory, 1 vCPU");
    expect(nextStep(0)).toBe(1);
    expect(nextStep(SANDBOX_SIZES.length - 1)).toBeNull();
    expect(sandboxSize(99)).toEqual(SANDBOX_SIZES.at(-1));
    expect(sandboxSize(-1)).toEqual(SANDBOX_SIZES[0]);
  });

  it("keep within what Cloudflare allows a custom instance", () => {
    for (const size of SANDBOX_SIZES) {
      expect(size.vcpu).toBeGreaterThanOrEqual(1);
      expect(size.vcpu).toBeLessThanOrEqual(4);
      expect(size.memoryMib).toBeGreaterThanOrEqual(size.vcpu * 3072);
      expect(size.memoryMib).toBeLessThanOrEqual(12_288);
      expect(size.diskMb).toBeLessThanOrEqual(20_000);
    }
  });

  it("read the kernel's out of memory kills and exits", () => {
    expect(oomKills("pgfault 12\noom_kill 3\npgmajfault 1\n")).toBe(3);
    expect(oomKills("pgfault 12\n")).toBeNull();
    expect(exitedForMemory("the container ran out of memory")).toBe(true);
    expect(exitedForMemory("OOM killed")).toBe(true);
    expect(exitedForMemory("its main process exited")).toBe(false);
    expect(exitedForMemory(null)).toBe(false);
  });
});
