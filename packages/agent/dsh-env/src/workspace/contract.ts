// workspace 注册表契约：令牌按服务语义命名（上游注册名 `workspaceRegistry`）。
import type WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
import { Injectable } from "@morlay/zephyr";

interface WorkspaceRegistryFace {
  readonly archivedSessionIds: WorkspaceRegistryService["archivedSessionIds"];
  readonly initializeDefault: WorkspaceRegistryService["initializeDefault"];
  readonly get: WorkspaceRegistryService["get"];
  readonly list: WorkspaceRegistryService["list"];
  readonly delete: WorkspaceRegistryService["delete"];
  readonly archiveSession: WorkspaceRegistryService["archiveSession"];
  readonly unarchiveSession: WorkspaceRegistryService["unarchiveSession"];
}

@Injectable()
export abstract class WorkspaceRegistry implements WorkspaceRegistryFace {
  abstract readonly archivedSessionIds: WorkspaceRegistryFace["archivedSessionIds"];

  abstract readonly initializeDefault: WorkspaceRegistryFace["initializeDefault"];

  abstract readonly get: WorkspaceRegistryFace["get"];

  abstract readonly list: WorkspaceRegistryFace["list"];

  abstract readonly delete: WorkspaceRegistryFace["delete"];

  abstract readonly archiveSession: WorkspaceRegistryFace["archiveSession"];

  abstract readonly unarchiveSession: WorkspaceRegistryFace["unarchiveSession"];
}
