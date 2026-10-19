// `fileUploads` 的契约面语义：上游 `FileUploads` 的单槽 resolver——重复登记直接抛错、disposer 只撤自己
// 那次登记；以及这条行确实把上游实例接了上来（构造期会往 connection 登记 HTTP 上传路由）。
//
// 假件只有别的包的契约面（agent 目录 / 附件存储 / 连接）；命令注册表用真实现（上游 `CommandRuntime`
// 构造没有依赖）。本包的行是真的：不假实现、不断实现身份。
import { FILE_UPLOAD_PATH } from "@deepseek-ai/dsh-client-file-upload/src/protocol.ts";
import { CommandRegistryDefault } from "@morlay/dsh-command";
import { AgentDirectory } from "@morlay/dsh-agent";
import { AttachmentError, AttachmentStore } from "@morlay/dsh-attachment";
import { FileUploadStore } from "@morlay/dsh-upload";
import { provideUpload } from "@morlay/dsh-upload/server";
import { Connection, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 假 agent 目录：这条 spec 不解析会话，只要满足上游 `static inject` 的名字。
 *
 * 契约面是上游 `AgentRegistry` 的全部成员，所以逐条兑现——`get` / `list` 给空值（本 spec 只用到这两个），
 * 其余通道一律「没接」（抛错，不静默返回空值）。
 */
@Injectable()
class FakeAgentDirectory extends AgentDirectory {
  private readonly notWired = (): never => {
    throw new Error("upload spec 不碰 agent 目录");
  };

  get currentInitiator(): AgentDirectory["currentInitiator"] {
    return this.notWired();
  }

  get requireInitiator(): AgentDirectory["requireInitiator"] {
    return this.notWired();
  }

  get withInitiator(): AgentDirectory["withInitiator"] {
    return this.notWired();
  }

  get withoutInitiator(): AgentDirectory["withoutInitiator"] {
    return this.notWired();
  }

  get setFactory(): AgentDirectory["setFactory"] {
    return this.notWired();
  }

  get create(): AgentDirectory["create"] {
    return this.notWired();
  }

  get resume(): AgentDirectory["resume"] {
    return this.notWired();
  }

  get register(): AgentDirectory["register"] {
    return this.notWired();
  }

  get enter(): AgentDirectory["enter"] {
    return this.notWired();
  }

  get announce(): AgentDirectory["announce"] {
    return this.notWired();
  }

  get isOwnedBy(): AgentDirectory["isOwnedBy"] {
    return this.notWired();
  }

  get roots(): AgentDirectory["roots"] {
    return this.notWired();
  }

  get turnBoundaryOf(): AgentDirectory["turnBoundaryOf"] {
    return this.notWired();
  }

  get(): ReturnType<AgentDirectory["get"]> {
    return undefined;
  }

  list(): ReturnType<AgentDirectory["list"]> {
    return [];
  }
}

/**
 * 假附件存储：上传路径不在本 spec 的断言范围里（上游只在真正 `upload` 时才读它）。
 *
 * 契约面是上游 `AttachmentStore` 的**全部**成员，所以这里逐条兑现——用到的三条给出真行为，
 * 图片与其它的通道一律「没接」（抛错，不静默返回空值）。
 */
@Injectable()
class FakeAttachmentStore extends AttachmentStore {
  /** 没接的通道：明确失败，不静默返回空值。 */
  private readonly notWired = (): never => {
    throw new Error("upload spec 不碰附件通道");
  };

  get imageLimits(): AttachmentStore["imageLimits"] {
    return this.notWired();
  }

  readonly saveFile: AttachmentStore["saveFile"] = async () => this.notWired();

  readonly saveFileStream: AttachmentStore["saveFileStream"] = async () => this.notWired();

  readonly readFileStream: AttachmentStore["readFileStream"] = () => this.notWired();

  readonly fileHostPath: AttachmentStore["fileHostPath"] = () => undefined;

  readonly saveImage: AttachmentStore["saveImage"] = async () => this.notWired();

  readonly saveImages: AttachmentStore["saveImages"] = async () => this.notWired();

  readonly validateImage: AttachmentStore["validateImage"] = async () => this.notWired();

  readonly readImage: AttachmentStore["readImage"] = async () => this.notWired();

  readonly readImageRequest: AttachmentStore["readImageRequest"] = async () => this.notWired();

  readonly imageHostPath: AttachmentStore["imageHostPath"] = () => this.notWired();

  readonly admitEncodedFile: AttachmentStore["admitEncodedFile"] = async () => this.notWired();

  readonly admitPromptContent: AttachmentStore["admitPromptContent"] = async () => this.notWired();

  /** 类型谓词按上游同一判据兑现（`instanceof AttachmentError`），不用「抛错」冒充。 */
  readonly isAttachmentError: AttachmentStore["isAttachmentError"] = (error): error is AttachmentError =>
    error instanceof AttachmentError;
}

/** 假连接面：只兑现上游构造期用到的那一处——往宿主登记一条 streaming 路由。 */
@Injectable()
class FakeConnection extends Connection {
  readonly routes: { readonly path: string }[] = [];

  readonly interactions = "none" as const;

  readonly generation = {
    getSnapshot: () => ({ id: 0, host: { home: "/tmp" } }),
    subscribe: () => () => {},
  };

  readonly isLoopback = true;

  readonly state = {
    getSnapshot: () => undefined,
    subscribe: () => () => {},
  };

  readonly rpc = {};

  readonly fetch = {
    register: (route: { readonly path: string }): (() => void) => {
      this.routes.push(route);
      return () => {};
    },
  };

  readonly openWebSocket = (): never => {
    throw new Error("spec: 不建连");
  };

  reconnect(): void {
    // spec：没有长连接可重连。
  }

  readonly registerGenerationSource = (): (() => void) => () => {};

  readonly start = (): { stop(): void } => ({ stop: () => {} });
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 10_000);

async function boot(): Promise<{ app: App; connection: FakeConnection }> {
  const app = await bootstrapApplication({
    providers: [...provideUpload(),
    FakeAgentDirectory, FakeAttachmentStore, FakeConnection, CommandRegistryDefault, RemoteHandlersDefault],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { app, connection: app.get(FakeConnection) };
}

describe("fileUploads：上游单槽 resolver 语义", () => {
  it("装配期把上游的上传路由登记进连接面（这一行接的是上游实例）", async () => {
    const { app, connection } = await boot();
    expect(typeof app.get(FileUploadStore).registerAgentResolver).toBe("function");
    expect(connection.routes.map((route) => route.path)).toEqual([FILE_UPLOAD_PATH]);
  });

  it("已登记时再次登记直接抛错；注销后可重新登记", async () => {
    const { app } = await boot();
    const uploads = app.get(FileUploadStore);
    const resolve = async (): Promise<never> => {
      throw new Error("spec: 不解析会话");
    };

    const dispose = uploads.registerAgentResolver(resolve);
    expect(() => uploads.registerAgentResolver(resolve)).toThrow(/already registered/u);

    dispose();
    expect(() => uploads.registerAgentResolver(resolve)()).not.toThrow();
  });

  it("disposer 只撤自己那次登记：别人已经接管时它不再动槽位", async () => {
    const { app } = await boot();
    const uploads = app.get(FileUploadStore);
    const first = async (): Promise<never> => {
      throw new Error("spec: 第一版解析器");
    };
    const second = async (): Promise<never> => {
      throw new Error("spec: 第二版解析器");
    };

    const disposeFirst = uploads.registerAgentResolver(first);
    disposeFirst();
    const disposeSecond = uploads.registerAgentResolver(second);
    // 旧 disposer 再跑一次不抛，也不会把后登记的那一个摘掉。
    expect(() => disposeFirst()).not.toThrow();
    expect(() => uploads.registerAgentResolver(second)).toThrow(/already registered/u);
    disposeSecond();
  });
});
