// `fileUploads/upload` 的 wire 端点：**真**走上游 `FileUploads.upload` → 真附件存储（临时 `dshHome`）。
//
// 判据：一段真字节串经 base64 从 wire 进来，落成的内容寻址 id 与「同一段字节直接 `saveFile`」得到的 id
// 相同，而且两次上传得到同一个 id——证明它没在端点里造假，确实进了附件存储。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession } from "@morlay/dsh-session/server";
import { provideAttachment, AttachmentStore, AttachmentStoreDefault } from "@morlay/dsh-attachment";
import { CommandRegistryDefault } from "@morlay/dsh-command";
import { provideUpload } from "@morlay/dsh-upload/server";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { Connection, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";

const SESSION = "s1";

/** 一份 agent 的形状（`@deepseek-ai/dsh-agent#Agent` 是外部类型）。 */
type AgentHandle = NonNullable<ReturnType<AgentDirectory["get"]>>;

/**
 * 假 agent：`session` 用**真 `Session`**（`Agent.session` 要的是那个类——它带私有成员、按名义类型比对，
 * 任何结构体都满足不了），`options` / `model` / `inbox` 这三个本 spec 不碰的字段一读就抛。
 *
 * 上游 `FileUploads` 只读 `agent.session`（WeakMap 键 + `header.origin`）与 `agent.id`（身份比对）。
 * @param session - 真会话实例。
 * @returns 满足 `Agent` 的替身。
 */
function agentOf(session: ReturnType<SessionStore["get"]>): AgentHandle {
  if (session === undefined) throw new Error("upload spec: 会话没建成");
  const notTouched = (name: string): never => {
    throw new Error(`upload spec 不碰 agent.${name}`);
  };
  return {
    id: SessionId(SESSION),
    session,
    // `Agent` 被 `runtime-types.ts` 增强出这些成员；本 spec 一个都不碰，一读/一调就抛。
    get options(): never {
      return notTouched("options");
    },
    get model(): never {
      return notTouched("model");
    },
    get inbox(): never {
      return notTouched("inbox");
    },
    get status(): never {
      return notTouched("status");
    },
    get ctx(): never {
      return notTouched("ctx");
    },
    cancel: () => notTouched("cancel"),
    whenIdle: () => notTouched("whenIdle"),
    runMaintenance: () => notTouched("runMaintenance"),
    send: () => notTouched("send"),
    followup: () => notTouched("followup"),
    steer: () => notTouched("steer"),
    inject: () => notTouched("inject"),
  };
}

/** 本用例的假 agent（`boot` 里用真会话建好；`get`/`list` 必须回**同一个对象**，上游按身份比对）。 */
let currentAgent: AgentHandle | undefined;

/** 本 spec 碰不到的成员：一调就抛，不静默返回空值。 */
function unused(): never {
  throw new Error("upload spec 不碰这个成员");
}

/** 假 agent 目录：`get` 必须回**同一个对象**（上游按身份比对，`stage()` 会查它）；其余成员按契约补齐。 */
@Injectable()
class FakeAgentDirectory extends AgentDirectory {
  readonly currentInitiator: AgentDirectory["currentInitiator"] = () => undefined;

  readonly requireInitiator: AgentDirectory["requireInitiator"] = unused;

  readonly withInitiator: AgentDirectory["withInitiator"] = unused;

  readonly withoutInitiator: AgentDirectory["withoutInitiator"] = unused;

  readonly setFactory: AgentDirectory["setFactory"] = unused;

  readonly create: AgentDirectory["create"] = unused;

  readonly resume: AgentDirectory["resume"] = unused;

  readonly register: AgentDirectory["register"] = unused;

  readonly enter: AgentDirectory["enter"] = unused;

  readonly announce: AgentDirectory["announce"] = unused;

  readonly isOwnedBy: AgentDirectory["isOwnedBy"] = () => false;

  readonly roots: AgentDirectory["roots"] = () => [];

  readonly get: AgentDirectory["get"] = (sessionId) => {
    const agent = currentAgent;
    return String(sessionId) === SESSION && agent !== undefined ? agent : undefined;
  };

  readonly list: AgentDirectory["list"] = () => (currentAgent === undefined ? [] : [currentAgent]);

  readonly turnBoundaryOf: AgentDirectory["turnBoundaryOf"] = unused;
}

/** 假连接面：上游构造期会往宿主登记一条流式上传路由。 */
@Injectable()
class FakeConnection extends Connection {
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

  readonly fetch = { register: (): (() => void) => () => {} };

  readonly openWebSocket = (): never => {
    throw new Error("spec: 不建连");
  };

  reconnect(): void {}

  readonly registerGenerationSource = (): (() => void) => () => {};

  readonly start = (): { stop(): void } => ({ stop: () => {} });
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 起一套真附件存储（临时 `dshHome`）+ 真上传行 + 本包的 wire 端点。 */
async function boot(): Promise<{ app: App; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-upload-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSession(),
    
      // 真附件存储：落在这次用例的临时目录里。
      ...provideAttachment(configure(AttachmentStoreDefault, { dshHome: root })),
      // 上游 `FileUploads` 构造期要一个命令注册表（回执解析器）与一条 HTTP 路由的登记处。
      CommandRegistryDefault,
      // wire 端点要一张 handler 表（`fileUploads/upload` 注册在它上面）。
      RemoteHandlersDefault,
      FakeAgentDirectory,
      FakeConnection,
      ...provideUpload(),
    ],
    timeoutMs: 10_000,
  });
  opened.push(app);
  // 真会话：`Agent.session` 要的是 `Session` 类实例，替身造不出全形。
  currentAgent = agentOf(app.get(SessionStore).create(SessionId(SESSION)));
  return { app, root };
}

/** wire 回的 `FileUploadValue`：只取本 spec 断言的两项（附件引用的内容寻址 id 叫 `attachmentId`）。 */
interface UploadValueWire {
  readonly receiptId: string;
  readonly file: { readonly attachmentId: string };
}

/** wire 回的 `RemoteResult`：按判别式收窄，不靠断言。 */
function uploadValueOf(value: unknown): UploadValueWire | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("ok" in value) || value.ok !== true) return undefined;
  if (!("value" in value) || typeof value.value !== "object" || value.value === null) return undefined;
  const payload = value.value;
  if (!("receiptId" in payload) || typeof payload.receiptId !== "string") return undefined;
  if (!("file" in payload) || typeof payload.file !== "object" || payload.file === null) return undefined;
  const file = payload.file;
  if (!("attachmentId" in file) || typeof file.attachmentId !== "string") return undefined;
  return { receiptId: payload.receiptId, file: { attachmentId: file.attachmentId } };
}

describe("fileUploads/upload 的 wire 端点", () => {
  it("base64 上传落成内容寻址 id：与直接落盘同一个 id，两次上传也同一个", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const handlers = app.get(RemoteHandlers);
    const store = app.get(AttachmentStore);
    const bytes = new TextEncoder().encode("上传正文\n");

    const first = uploadValueOf(
      await handlers.invoke("fileUploads/upload", {
        agent: SESSION,
        request: { data: Buffer.from(bytes).toString("base64"), name: "note.txt" },
      }),
    );
    const second = uploadValueOf(
      await handlers.invoke("fileUploads/upload", {
        agent: SESSION,
        request: { data: Buffer.from(bytes).toString("base64"), name: "note.txt" },
      }),
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.receiptId).not.toEqual(second?.receiptId);

    // 内容寻址：同一段字节直接 `saveFile` 得到同一个 `attachmentId`。
    const saved = await store.saveFile({ data: bytes, name: "note.txt" });
    expect(first?.file.attachmentId).toEqual(saved.attachmentId);
    expect(second?.file.attachmentId).toEqual(first?.file.attachmentId);
  });

  it("会话没有 agent 时回结构化失败（不是裸异常）", { timeout: 20_000 }, async () => {
    const { app } = await boot();
    const handlers = app.get(RemoteHandlers);
    const result = await handlers.invoke("fileUploads/upload", {
      agent: "nope",
      request: { data: Buffer.from(new Uint8Array([1])).toString("base64") },
    });
    expect(typeof result).toBe("object");
    expect(result).toMatchObject({ ok: false });
  });
});
