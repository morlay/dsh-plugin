import { FileSystem } from "@morlay/dsh-base/fs";
import { SessionStore, SessionPersistence } from "@morlay/dsh-base/session";
import { SandboxPolicy, Subprocess } from "@morlay/dsh-base/sandbox";
import { RemoteAccess, Typert } from "@morlay/dsh-base/typert";
import { WorkspaceRegistry } from "@morlay/dsh-base/workspace";
import { StorageDomain } from "@morlay/dsh-base/storage";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import WorkspacePlugin from "@deepseek-ai/dsh-workspace";
import WorkspaceFilesPlugin from "@deepseek-ai/dsh-api-workspace-files";
import WorkspaceControllerPlugin from "@deepseek-ai/dsh-api-workspace-controller";
import * as WorkspaceChangesPlugin from "@deepseek-ai/dsh-workspace-changes";

// 绑定契约令牌：消费方 `inject(WorkspaceRegistry)`（session / persistence）与 `inject(Workspace)` 都解析到
// 同一个上游实例；单参形式只登记适配类自己的令牌，外部按契约注入时会以为「装配里没有提供者」。
@Injectable()
export class Workspace extends fromCordis(WorkspaceRegistry, WorkspacePlugin) {
  storageDomain = inject(StorageDomain);

  sessionPersistence = inject(SessionPersistence);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      storageDomain: this.storageDomain,
      sessionPersistence: this.sessionPersistence,
    });
  }
}

@Injectable()
export class WorkspaceFiles extends fromCordis(WorkspaceFilesPlugin) {
  fs = inject(FileSystem);

  sandboxPolicy = inject(SandboxPolicy);

  sessions = inject(SessionStore);

  typert = inject(Typert);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      fs: this.fs,
      sandboxPolicy: this.sandboxPolicy,
      sessions: this.sessions,
      typert: this.typert,
    });
  }
}

@Injectable()
export class WorkspaceController extends fromCordis(WorkspaceControllerPlugin) {
  remoteAccess = inject(RemoteAccess);

  typert = inject(Typert);

  workspaceRegistry = inject(Workspace);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      remoteAccess: this.remoteAccess,
      typert: this.typert,
      workspaceRegistry: this.workspaceRegistry,
    });
  }
}

@Injectable()
export class WorkspaceChanges extends fromCordis(WorkspaceChangesPlugin) {
  subprocess = inject(Subprocess);

  fs = inject(FileSystem);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { subprocess: this.subprocess, fs: this.fs });
  }
}
