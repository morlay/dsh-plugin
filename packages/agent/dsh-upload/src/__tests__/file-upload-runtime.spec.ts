// `ctx.fileUpload` 的**注册落点**（真机 bug 的回归）。
//
// 上游 `file-upload` 的 apply 只做一件事——`ctx.plugin(FileUploadRuntime)`：那个 fiber 挂在本行下面，
// 而 cordis 的严格读（`ctx.fileUpload`）只认**祖先 fiber** 的 provision 或根 ctx 上的注册。会话界面的
// `ConversationController` 里 `this.ctx` 是会话 scope ctx（`ClientSessions.createScope` 建的），沿链只到根，
// 于是抛 `cannot get property "fileUpload" without inject`——真机现象是「粘贴图片 → chip 变红、没有上传请求」。
// 这个 spec 用**同一形状**的 ctx 复现那条读法（no-op 子插件 + `fiber.ctx.extend`，与 `createScope` 一致）。
import { FileUpload } from "../ui/file-upload.contract.ts";
import { provideFileUploadUi } from "../ui/file-upload.provide.ts";
import { ClientConnection, Remote, RemoteDefault } from "@morlay/zephyr-app/client";
import { Connection } from "@morlay/zephyr-app/contract";
import { bootstrapApplication, inject, Injectable, type App, type Context } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 假连接面（**宿主面**）：上传行构造期会往宿主登记一条流式路由。 */
@Injectable()
class FakeHostConnection extends Connection {
  readonly rpc: Connection["rpc"] = {
    handle: () => async () => {},
    intercept: () => async () => {},
  } as Connection["rpc"];

  readonly fetch: Connection["fetch"] = {
    register:
      (_route: Parameters<Connection["fetch"]["register"]>[0]): (() => Promise<void>) =>
      async () => {},
  };

  createSharedFetchHandler(): never {
    throw new Error("spec: 不建共享分派器");
  }

  admit(_request: never): never {
    throw new Error("spec: 不接连接");
  }

  readonly browserPeer = {} as Connection["browserPeer"];
}

/** 假连接面（**浏览器面**）：`Remote` 行构造期只用到这一面的形状（本 spec 不建连）。 */
@Injectable()
class FakeConnection extends ClientConnection {
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
    register:
      (_route: Parameters<Connection["fetch"]["register"]>[0]): (() => void) =>
      () => {},
  };

  readonly openWebSocket = (): never => {
    throw new Error("spec: 不建连");
  };

  reconnect(): void {
    // spec：没有长连接可重连。
  }

  readonly registerGenerationSource = (): (() => Promise<void>) => async () => {};

  readonly start = (): { stop(): void } => ({ stop: () => {} });
}

/** 读面：上游按名字取的那两个方法（`ctx.fileUpload` 的严格读只关心这个）。 */
interface FileUploadFace {
  readonly name?: string;
  readonly upload?: unknown;
  readonly uploadImage?: unknown;
}

/** `Remote` 契约不列 namespace：`remote.fileUploads` 按它的形状断言一次。 */
interface RemoteWithFileUploads {
  readonly fileUploads?: { readonly upload?: unknown };
}

/**
 * 消费方行（会话界面的替身）：在自己这一行的 fiber 下建一个更深的 ctx，再按名字严格读 `fileUpload`。
 *
 * `inject(FileUpload)` 只为**排序**（提供者先 mount）与「同一个实例」的判据，读服务本身走 cordis store。
 */
@Injectable()
class FileUploadReader {
  private readonly face = inject(FileUpload);

  /** 按名字严格读到的面（读不到时上游那条链就是抛错）。 */
  strict?: FileUploadFace;

  onInit(ctx: Context): void {
    // 比本行**更深一层**的 ctx：上游 `ClientSessions.createScope` 就是从行 fiber 派生一个
    // no-op 插件 fiber 再 `fiber.ctx.extend` —— 无论哪种，读服务的 fiber 链都只到根。
    const scoped = ctx.extend({}) as Context & { readonly fileUpload?: FileUploadFace };
    this.strict = scoped.fileUpload;
  }

  /** 契约令牌拿到的面。 */
  get contract(): FileUpload {
    return this.face;
  }
}

/**
 * 装配「上传运行时 + 一个消费方行」。
 * @returns 应用、消费方行的实例与 remote 面。
 */
async function boot(): Promise<{
  app: App;
  reader: FileUploadReader;
  remote: Remote & RemoteWithFileUploads;
}> {
  const app = await bootstrapApplication({
    providers: [
      FakeConnection,
      FakeHostConnection,
      RemoteDefault,
      FileUploadReader,
      ...provideFileUploadUi(),
    ],
    timeoutMs: 10_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return {
    app,
    reader: app.get(FileUploadReader),
    remote: app.get(Remote) as Remote & RemoteWithFileUploads,
  };
}

describe("ctx.fileUpload 的注册落点（深层 fiber 按名字读得到）", () => {
  test("会话 scope 那种 ctx 上 fileUpload 严格读得到，且带着上传方法", async () => {
    const { reader } = await boot();
    expect(
      reader.strict,
      "按名字读不到 = 会话界面里 this.ctx.fileUpload 抛 cannot get property",
    ).toBeDefined();
    expect(typeof reader.strict?.uploadImage).toBe("function");
    expect(typeof reader.strict?.upload).toBe("function");
  });

  test("按名字读到的服务名就是 fileUpload，契约令牌那一份也带着两个上传方法", async () => {
    const { reader } = await boot();
    expect(reader.strict?.name).toBe("fileUpload");
    expect(typeof reader.contract.upload).toBe("function");
    expect(typeof reader.contract.uploadImage).toBe("function");
  });

  test("remote.fileUploads（字节上传的 remote 面）在行 mount 之后就位", async () => {
    const { remote } = await boot();
    expect(typeof remote.fileUploads?.upload).toBe("function");
  });
});
