import { createContext, useContext } from "react";
import type { ProjectApi } from "./api";
import type { ProjectData } from "./live";
import type { FeatureNode, SessionNode } from "./model";
import type { Selection } from "./selection";

export interface Workspace {
  readonly data: ProjectData;
  readonly api: ProjectApi;
  readonly selection: Selection;
  readonly select: (patch: Partial<Selection>) => void;
  readonly features: readonly FeatureNode[];
  readonly sessions: readonly SessionNode[];
  readonly feature: FeatureNode | null;
  readonly session: SessionNode | null;
  readonly openSession: (id: string) => void;
  readonly openFeature: (id: string) => void;
  readonly focusComposer: () => void;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace needs a WorkspaceContext provider");
  return value;
}
