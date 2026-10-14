import type { ComponentType } from "react";
import type { SettingsSection } from "@/components/settings-shell";
import type { SharedApi } from "@/lib/api";

export type ProjectLevel = "view" | "edit" | "manage";

export interface HostStart {
  readonly locked: boolean;
}

export interface HostAccount {
  readonly title: string;
  readonly subtitle: string;
  readonly heading: string;
  readonly notice?: string;
}

export interface HostPerson {
  readonly userId: string;
  readonly email: string | null;
}

export interface HostUsage {
  readonly manager: boolean;
  readonly people: readonly HostPerson[];
}

export interface HostShare {
  readonly project: string;
  readonly kind: "session" | "preview";
  readonly id: string;
  readonly title: string;
  readonly onClose: () => void;
}

export interface Host {
  readonly start?: () => Promise<HostStart>;
  readonly Overlay?: ComponentType<{ readonly onLocked: () => void }>;
  readonly Locked?: ComponentType;
  readonly LockedSection?: ComponentType;
  readonly useAccount?: () => HostAccount | null;
  readonly MenuItems?: ComponentType<{ readonly onSettings: (section?: string) => void }>;
  readonly MenuEnd?: ComponentType;
  readonly General?: ComponentType<{ readonly locked: boolean }>;
  readonly ModelHelp?: ComponentType;
  readonly generalNote?: string;
  readonly useUsage?: () => HostUsage | null;
  readonly useProjectLevel?: (project: string) => ProjectLevel | null;
  readonly projectSections?: (project: string) => readonly SettingsSection[];
  readonly hiddenSections?: readonly string[];
  readonly Share?: ComponentType<HostShare> | false;
  readonly sharedApi?: () => SharedApi | null;
}
