export interface SandboxSize {
  readonly vcpu: number;
  readonly memoryMib: number;
  readonly diskMb: number;
}

export const SANDBOX_SIZES: readonly SandboxSize[] = [
  { vcpu: 1, memoryMib: 3072, diskMb: 12_000 },
  { vcpu: 1, memoryMib: 6144, diskMb: 12_000 },
  { vcpu: 2, memoryMib: 8192, diskMb: 16_000 },
  { vcpu: 4, memoryMib: 12_288, diskMb: 20_000 },
];

export function sizeStep(step: number | null | undefined): number {
  return Math.min(Math.max(Math.trunc(step ?? 0), 0), SANDBOX_SIZES.length - 1);
}

export function sandboxSize(step: number | null | undefined): SandboxSize {
  return SANDBOX_SIZES[sizeStep(step)] as SandboxSize;
}

export function nextStep(step: number): number | null {
  return step + 1 < SANDBOX_SIZES.length ? step + 1 : null;
}

export function sizeLabel(size: SandboxSize): string {
  return `${size.memoryMib / 1024} GiB memory, ${size.vcpu} vCPU`;
}

export function oomKills(vmstat: string): number | null {
  const match = /^oom_kill (\d+)$/m.exec(vmstat);
  return match ? Number(match[1]) : null;
}

export function exitedForMemory(exit: string | null): boolean {
  return exit !== null && /out of memory|\boom\b|memory limit/i.test(exit);
}

export function busySeconds(stat: string): number | null {
  const match = /^cpu\s+(.+)$/m.exec(stat);
  if (!match?.[1]) return null;
  const [user = 0, nice = 0, system = 0, , , irq = 0, softirq = 0] = match[1].trim().split(/\s+/).map(Number);
  const busy = (user + nice + system + irq + softirq) / 100;
  return Number.isFinite(busy) ? busy : null;
}
