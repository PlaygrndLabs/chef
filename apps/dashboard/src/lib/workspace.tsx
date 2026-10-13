import { createContext, useContext } from "react";
import type { ProjectApi, SettingsView } from "./api";
import type { ProjectData } from "./live";
import type { FeatureNode, SessionNode } from "./model";
import type { Selection, SettingsScope } from "./selection";

export interface AppSettings {
  readonly settings: SettingsView | null;
  readonly setSettings: (settings: SettingsView) => void;
  readonly available: boolean;
}

export interface Workspace {
  readonly data: ProjectData;
  readonly api: ProjectApi;
  readonly selection: Selection;
  readonly select: (patch: Partial<Selection>) => void;
  readonly features: readonly FeatureNode[];
  readonly sessions: readonly SessionNode[];
  readonly feature: FeatureNode | null;
  readonly session: SessionNode | null;
  readonly projects: readonly string[];
  readonly panelExpanded: boolean;
  readonly expandPanel: (on: boolean) => void;
  readonly addProject: () => void;
  readonly openSession: (id: string) => void;
  readonly openFeature: (id: string) => void;
  readonly focusComposer: () => void;
  readonly openSettings: (scope: SettingsScope, section?: string, item?: string | null) => void;
  readonly app: AppSettings;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useOptionalWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace needs a WorkspaceContext provider");
  return value;
}
