import { FileSystem } from "@morlay/dsh-base/fs";
import { Commands } from "@morlay/dsh-base/commands";
import { SessionQuery } from "@morlay/dsh-base/session-query";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { Agents, AgentDefaultModel } from "@morlay/dsh-base/agent";
import { Attachments } from "@morlay/dsh-base/runtime";

import { Llm } from "@morlay/dsh-base/llm";
import { RemoteAccess, Typert } from "@morlay/dsh-base/typert";
import { SessionStore } from "@morlay/dsh-base/session";
import { WorkspaceRegistry } from "@morlay/dsh-base/workspace";
import { FileUploads } from "../file-upload/file-upload.service.ts";
import { Connection } from "@morlay/dsh-base/connection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as SessionLogDownloadPlugin from "@deepseek-ai/dsh-session-log-export";
import SessionReferencePlugin from "@deepseek-ai/dsh-session-reference";
import * as SessionStatsPlugin from "@deepseek-ai/dsh-session-stats";
import * as SessionTurnOutlinePlugin from "@deepseek-ai/dsh-session-turn-outline";
import SessionControllerPlugin from "@deepseek-ai/dsh-api-session-controller";
import { SessionController } from "./session-controller.contract.ts";

@Injectable()
export class SessionLogDownload extends fromCordis(SessionLogDownloadPlugin) {
  commands = inject(Commands);

  connection = inject(Connection);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { commands: this.commands, connection: this.connection });
  }
}

@Injectable()
export class SessionReference extends fromCordis(SessionReferencePlugin) {
  sessionQuery = inject(SessionQuery);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sessionQuery: this.sessionQuery });
  }
}

@Injectable()
export class SessionStats extends fromCordis(SessionStatsPlugin) {
  sessionProjections = inject(SessionProjections);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sessionProjections: this.sessionProjections });
  }
}

@Injectable()
export class SessionTurnOutline extends fromCordis(SessionTurnOutlinePlugin) {
  sessionProjections = inject(SessionProjections);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sessionProjections: this.sessionProjections });
  }
}

@Injectable()
export class SessionControllerDefault extends fromCordis(SessionController, SessionControllerPlugin) {
  // 字段名带 `dep` 前缀：上游类有同名成员，直接同名会和它的类型合并冲突。
  depAgentDefaultModel = inject(AgentDefaultModel);

  depAgents = inject(Agents);

  depAttachments = inject(Attachments);

  depFileUploads = inject(FileUploads);

  depFs = inject(FileSystem);

  depLlm = inject(Llm);

  depRemoteAccess = inject(RemoteAccess);

  depSessions = inject(SessionStore);

  depSessionProjections = inject(SessionProjections);

  depSessionQuery = inject(SessionQuery);

  depTypert = inject(Typert);

  depWorkspaceRegistry = inject(WorkspaceRegistry);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agentDefaultModel: this.depAgentDefaultModel,
      agents: this.depAgents,
      attachments: this.depAttachments,
      fileUploads: this.depFileUploads,
      fs: this.depFs,
      llm: this.depLlm,
      remoteAccess: this.depRemoteAccess,
      sessions: this.depSessions,
      sessionProjections: this.depSessionProjections,
      sessionQuery: this.depSessionQuery,
      typert: this.depTypert,
      workspaceRegistry: this.depWorkspaceRegistry,
    });
  }
}
