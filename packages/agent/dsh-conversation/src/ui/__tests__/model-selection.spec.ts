// @vitest-environment happy-dom
/**
 * 输入框旁的模型选择器（上游 `ui-model-selection` client 半）**在装配里接上了没有**。
 *
 * 这一条守的是本包那一行（`ModelSelectionSlots`）的接线，不是上游的选择器逻辑（上游自己的
 * `tests/` 覆盖目录/座位/弹层的状态机）。判据三条：
 *
 * 1. `conversation.input.model` 座位注册出来（选择器「出现」的结构判据；`/model` 弹层在
 *    本装配里由 `commandUi` 空面收下，不渲染——所以座位是唯一上屏入口）；
 * 2. 座位的目录来自 `session/modelCatalog` 的**真 wire 帧**（没有可选项就是这个缺口）；
 * 3. 选中走 `session/selectModel` 的真 wire 帧（「选完不保存」就是这个缺口）。
 *
 * 替身只有两处：`Remote`（传输层，mock server 给固定帧）与 `sessions` / `locale`（兄弟域的端口）。
 * 上游那一行、它建的 `ctx.modelDirectories`、`ModelDirectory` 都是真实现。
 */
import { bootstrapApplication, inject, Injectable, type Context } from "@morlay/zephyr";
import {
  ClientConnection,
  Locale,
  mockTransport,
  provideRenderer,
  Remote,
  SessionRemote,
  Slots,
} from "@morlay/zephyr-app/client";
import { CommandUi } from "@morlay/dsh-command/ui";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SessionController } from "../../contract/index.ts";
import { provideSessionsStore } from "../sessions.provide.ts";

import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { ModelSelectionSlots } from "../model-selection-slots.ts";

/** 宿主的目录帧：两个 provider 分组，`a/m1` 是当前选择。 */
const CATALOG = {
  default: { provider: "a", model: "m1" },
  routableProviders: ["a", "b"],
  groups: [
    {
      id: "a",
      name: "Provider A",
      models: [
        { id: "m1", name: "M1" },
        { id: "m2", name: "M2" },
      ],
    },
    { id: "b", name: "Provider B", models: [{ id: "x1", name: "X1" }] },
  ],
  failures: [],
};

/** 一次 remote 调用的记录（断言「走的是哪条 wire」用）。 */
interface Call {
  readonly endpoint: string;
  readonly payload: unknown;
}

/**
 * 传输层替身：`remote.session` 的两个方法都经过 `mockTransport`，用例因此看到 wire 载荷。
 */
@Injectable()
class FakeRemote extends Remote {
  static calls: Call[] = [];

  /**
   * 下一个实例的宿主应答。`baselineValues` 是 `session/control` 基线里该会话的投影值
   * （缺省给含 `modelSelection` 的那份；给 `{}` 可模拟「目录先建、投影键还没到」）。
   */
  static next: { catalog?: unknown; select?: unknown; baselineValues?: Record<string, unknown> } =
    {};

  /** `remote.session` 上本行要用到的面：两个 unary + 两条流（`control` 由会话行消费）。 */
  private readonly face: {
    modelCatalog(): Promise<unknown>;
    selectModel(request: unknown): Promise<unknown>;
    follow(request: unknown, signal: AbortSignal): AsyncIterable<unknown>;
    control(signal: AbortSignal): AsyncIterable<unknown>;
  };

  /**
   * 每个 `control` 订阅者一条**自己的**队列。
   *
   * 真宿主是广播（`SessionControlController.streams` 逐条 push）：本行与 `Projections` 行各开一条流，
   * 两边都该收到同一帧。共用一条队列会让帧只落到其中一个订阅者手里——那是替身的错，不是被测代码的错。
   */
  private readonly subscribers = new Set<{
    readonly pending: unknown[];
    wake?: (() => void) | undefined;
    /** 这条流被"掐断"（模拟换代时旧 socket 断掉）：循环退出，之后不再收帧。 */
    ended?: boolean;
  }>();

  readonly upstream: Record<string, unknown>;

  /** 传输层：`invoke`（`@RemoteClient` 转发）与 `face` 共用同一个 mock。 */
  private readonly transport: ReturnType<typeof mockTransport>;

  constructor() {
    super();
    const transport = mockTransport({
      "session/modelCatalog": () => FakeRemote.next.catalog ?? { ok: true, value: CATALOG },
      "session/selectModel": (payload) => {
        FakeRemote.calls.push({ endpoint: "session/selectModel", payload });
        return (
          FakeRemote.next.select ?? {
            ok: true,
            value: { selected: { provider: "a", model: "m2" } },
          }
        );
      },
    });
    this.face = {
      modelCatalog: () => {
        FakeRemote.calls.push({ endpoint: "session/modelCatalog", payload: undefined });
        return transport.invoke("session/modelCatalog", {});
      },
      selectModel: (request: unknown) =>
        transport.invoke("session/selectModel", { args: { request } }),
      follow: () => (async function* () {})(),
      control: (signal: AbortSignal) => this.controlFrames(signal),
    };
    this.transport = transport;
    this.upstream = { session: this.face };
    // `Remote` 契约的 `session` 是可选成员（`dsh-session` 的 declaration merging 声明它由 `$mount` 后才有值）：
    // 替身在这里挂同一份面，上游那一行不区分「真 Proxy / 替身」。
    Object.defineProperty(this, "session", { value: this.face, enumerable: true });
  }

  /**
   * 可控的 `session/control` 流：先给一条基线（客户端投影 store 的种子），之后按 `pushFrame` 逐帧吐。
   * @param signal - 订阅方（会话行）的中断信号。
   * @returns 帧流。
   */
  private async *controlFrames(signal: AbortSignal): AsyncIterable<unknown> {
    this.opens += 1;
    const subscriber: {
      readonly pending: unknown[];
      wake?: (() => void) | undefined;
      ended?: boolean;
    } = { pending: [] };
    this.subscribers.add(subscriber);
    // 基线与真宿主同形：宿主 `snapshot(session).values` 里每个已注册投影都有一项（含 `modelSelection`）。
    // 少了这个键，上游 `ModelDirectory.syncInputs` 会判 `projected === undefined` → 永远 `loading`。
    yield {
      type: "baseline",
      value: {
        projections: {
          s1: {
            asOfSeq: -1,
            values: FakeRemote.next.baselineValues ?? {
              modelSelection: { lastUsed: null, next: null },
            },
          },
        },
      },
    };
    while (!signal.aborted && subscriber.ended !== true) {
      const frame = subscriber.pending.shift();
      if (frame !== undefined) {
        yield frame;
        continue;
      }
      await new Promise<void>((resolve) => {
        subscriber.wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      subscriber.wake = undefined;
    }
    this.subscribers.delete(subscriber);
  }

  /**
   * 往 control 流推一帧（模拟宿主广播）。
   * @param frame - 一帧 `SessionControlFrame`。
   */
  /** 当前打开的 `control` 订阅数（用例据此确认"流已开、推帧不会丢"）。 */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * 累计开过几条 `control` 流。
   *
   * 换代后旧流被 abort、新流开起来，`subscriberCount` 会先涨后落（旧流退出有延迟）：
   * 判"有没有重开"要看累计数，不看瞬时数。
   */
  opens = 0;

  /**
   * 掐断所有在途的 `control` 流（换代时旧 socket 断掉的效果）。
   *
   * 不掐断的话，替身上的"旧流"在换代后照样收帧，用例就分不出"有没有重开"。
   */
  dropStreams(): void {
    for (const subscriber of this.subscribers) {
      subscriber.ended = true;
      subscriber.wake?.();
    }
    this.subscribers.clear();
  }

  pushFrame(frame: unknown): void {
    for (const subscriber of this.subscribers) {
      subscriber.pending.push(frame);
      subscriber.wake?.();
    }
  }

  async $mount(): Promise<() => Promise<void>> {
    return async () => {};
  }

  /** `@RemoteClient()` 生成的转发走这里：与 wire 同形（命名参数进、原样结果出）。 */
  async invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.transport.invoke(endpoint, { args });
  }

  async whenMounted(): Promise<void> {}

  async whenNamespace(): Promise<void> {}

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    // 空流 + `dispose`：`Object.assign` 的返回类型就是那个交集，不必再断言。
    return Object.assign((async function* () {})(), { dispose: async (): Promise<void> => {} });
  }
}

/**
 * 把 `remote.session` 发布成**嵌套服务名**。
 *
 * 上游 `ModelDirectoryResolver` 的 `static inject` 里写着 `'remote.session'`，cordis 按名字去 store 读；
 * 真实现是 `RemoteDefault.$mount` 时 `publishNamespace` 发布的。替身不经过那条路，这里补同一份。
 */
@Injectable()
class PublishSessionNamespace {
  private readonly remote = inject(FakeRemote);

  onInit(ctx: Context): void {
    ctx.reflect.provide("remote.session", Reflect.get(this.remote, "session"));
  }
}

/** 连接替身：`generation` 可推进，用来验「换代后重开 `session/control`」。 */
@Injectable()
class FakeConnection extends ClientConnection {
  readonly interactions = "none" as const;

  private id = 1;

  private readonly listeners = new Set<() => void>();

  readonly generation = {
    getSnapshot: () => ({ id: this.id, host: { home: "" } }),
    subscribe: (listener: () => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  /** 推进一代（模拟重连：旧 socket 上的流全断）。 */
  bump(): void {
    this.id += 1;
    // 监听者在回调里可能退订：按快照迭代（`Set` 的迭代器会看到删除）。
    for (const listener of Array.from(this.listeners)) listener();
  }

  readonly isLoopback = true;

  readonly state = { getSnapshot: () => "connected" as const, subscribe: () => () => {} };

  readonly openWebSocket = (): WebSocket => {
    throw new Error("本 spec 不走 socket");
  };

  readonly registerGenerationSource = () => () => {};

  readonly rpc = {};

  reconnect(): void {}

  readonly start = () => ({ stop: () => {} });
}

/** 目录读的替身（`SessionRemote` 契约）：客户端会话行拉目录走它。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  async list(): Promise<unknown> {
    return {
      items: [
        {
          sessionId: "s1",
          id: "s1",
          title: "只有这一条",
          displayTitle: "只有这一条",
          cwd: "/tmp",
          running: false,
          retainedBy: {},
          blank: false,
          updatedAt: 0,
        },
      ],
    };
  }

  async create(): Promise<unknown> {
    return { sessionId: "s1" };
  }

  async readPage(): Promise<unknown> {
    return { records: [], hasMore: false };
  }
}

/** 语言替身：只回一个稳定字符串（文案不是这条用例的判据）。 */
@Injectable()
class FakeLocale extends Locale {
  readonly bind: Locale["bind"] = () =>
    ((key: string) => `model:${key}`) as ReturnType<Locale["bind"]>;

  readonly register: Locale["register"] = () => () => {};

  readonly getSnapshot: Locale["getSnapshot"] = () => ({
    active: "zh" as ReturnType<Locale["getSnapshot"]>["active"],
    locales: [],
    revision: 0,
  });

  readonly subscribe: Locale["subscribe"] = () => () => {};
}

/** 等条件成立（上游注册是异步的：`slots.inject` 等位置声明、目录加载等宿主帧）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 起这一行：真 `Slots`（`provideRenderer`）+ 真上游行 + 两个端口替身。
 * @returns 应用、`Slots` 与卸载函数。
 */
async function boot(options: { baselineValues?: Record<string, unknown> } = {}): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  slots: Slots;
  dispose: () => Promise<void>;
}> {
  FakeRemote.calls = [];
  FakeRemote.next = { ...options };
  const app = await bootstrapApplication({
    providers: [
      ...provideRenderer(),
      FakeRemote,
      // 真客户端会话行：`control` 流由它消费、投影面由它维护——本用例判的就是这一层。
      { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
      ...provideSessionsStore(),
      PublishSessionNamespace,
      FakeConnection,
      FakeLocale,
      // `/model` 弹层注册进命令 UI：座位不用它，但本行注入它，缺了装配期就报。
      {
        provide: CommandUi,
        useFactory: () => ({
          register: () => () => {},
          decorate: () => () => {},
          dismiss: () => {},
        }),
      },
      ModelSelectionSlots,
    ],
    timeoutMs: 8_000,
  });
  // 座位是**按会话**注册的（`scope: 'session'`）：目录行要求会话有 scope 与 binding，
  // 所以先把这条会话拉进目录并 retain 物化 scope（与真机上侧栏选会话同一步）。
  const sessions = app.get(SessionController);
  await sessions.refresh();
  sessions.retain(SessionId("s1"), { source: "gateway" });
  return { app, slots: app.get(Slots), dispose: () => app.dispose() };
}

/** 座位注册项交给渲染器的业务面（`ModelSelectInjected`）。 */
interface SeatInjected {
  readonly available: boolean;
  readonly directory: {
    getSnapshot(): {
      readonly status: string;
      /** 目录当前选中的模型（座位显示的就是它）。 */
      readonly current?: { readonly provider: string; readonly model: string } | null;
      readonly groups: readonly {
        readonly id: string;
        readonly models: readonly { readonly id: string }[];
      }[];
    };
  };
  readonly load: () => void;
  // 上游 `ModelSelectInjected.select` 接受完整的 `ModelSelection`（含 `reasoningEffort`）：
  // 强度是会话级选择的一部分，不是"另一次设置"。
  readonly select: (selection: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  }) => Promise<{ ok: boolean }>;
}

/**
 * 把座位的位置声明出来并等它注册（声明来自 `ui-conversation` 的 `conversation.composer.bar` children；
 * 这里只装渲染面，所以按下游那行的同一形状声明一次——位置没声明时 `slots.inject` 会一直等）。
 * @param slots - 真 `Slots`。
 * @returns 座位的 `inject` 工厂与撤销声明用的函数。
 */
async function seatOf(slots: Slots): Promise<{ injected: SeatInjected; undo: () => void }> {
  const undo = slots.registerDynamic(
    {
      name: "root",
      children: { "conversation.input.model": { kind: "single", scope: "session" } },
    },
    () => null,
  );
  await until(() => slots.entries("conversation.input.model" as never).length > 0);
  const entry = slots.entries("conversation.input.model" as never)[0] as
    | { inject?: (sessionId: unknown) => SeatInjected }
    | undefined;
  expect(entry?.inject, "座位注册项必须带上游那一行的 inject 工厂").toBeDefined();
  // 会话身份在 wire 上就是字符串（`SessionId` 品牌在边界铸）；这里不必为它拖进宿主模块图。
  return { injected: entry!.inject!("s1" as never), undo };
}

// 这一组的**被测面**是「数据一到，座位就跟」：
//
// - 座位（上游 `conversation.input.model`）读的是**每会话一份**的 `ModelDirectory`，
//   它的 `current` 来自 `binding().session.projections.faceOf('modelSelection')`；
// - 那条投影面只由客户端会话行（`SessionControllerDefault`）消费的 `session/control` 流喂养；
// - 所以「切了模型没反应、刷新才好」只可能断在三处之一：流没开、帧没喂、目录不跟。
//   四条用例分别钉：座位注册、目录来源与选中载荷、帧到座位、以及**换代后重开流**。
//
// 替身的边界：`FakeRemote` 只实现 `remote.session` 上本行用到的面（两个 unary + 两条流），
// `control` 是**广播**式的（与宿主 `SessionControlController` 同形：每个订阅者都收到每一帧），
// 并且能被 `dropStreams()` 掐断——换代时旧 socket 上的流就是这么断的。
describe("模型选择器那一行接上了没有", { timeout: 15_000 }, () => {
  test("`conversation.input.model` 座位注册出来（输入框旁的选择器就靠它上屏）", async () => {
    const { slots, dispose } = await boot();
    try {
      const undo = slots.registerDynamic(
        {
          name: "root",
          children: { "conversation.input.model": { kind: "single", scope: "session" } },
        },
        () => null,
      );
      try {
        await until(() => slots.entries("conversation.input.model" as never).length > 0);
        expect(
          slots.entries("conversation.input.model" as never).length,
          "座位没注册 = 输入框旁不会出现模型选择器",
        ).toBeGreaterThan(0);
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });

  test("目录来自 `session/modelCatalog`，选中走 `session/selectModel`", async () => {
    const { slots, dispose } = await boot();
    try {
      const { injected, undo } = await seatOf(slots);
      try {
        expect(injected.available, "普通会话必须允许模型选择").toBe(true);
        injected.load();
        await until(() => injected.directory.getSnapshot().status === "ready");
        const state = injected.directory.getSnapshot();
        expect(state.status, "目录没走到 ready = 座位一直转圈").toBe("ready");
        // 「选项」就是这份目录展开的 provider/model：分组为空时选择器里没有可选项。
        expect(
          state.groups.flatMap((group) => group.models.map((model) => `${group.id}/${model.id}`)),
          "座位里没有可选项 = 目录没接上",
        ).toEqual(["a/m1", "a/m2", "b/x1"]);
        const result = await injected.select({ provider: "a", model: "m2" });
        expect(result.ok, "选中必须被宿主接受").toBe(true);
        const select = FakeRemote.calls.filter((call) => call.endpoint === "session/selectModel");
        expect(select, "选中必须落到 `session/selectModel` 这条 wire 上").toHaveLength(1);
        const payload = select[0]?.payload as { args: { request: unknown } } | undefined;
        expect(payload, "要能读到那条 wire 调用的载荷").toBeDefined();
        expect(payload?.args.request).toMatchObject({
          sessionId: "s1",
          provider: "a",
          model: "m2",
        });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });

  test("宿主推来 `modelSelection` 投影帧后，座位**立即**显示新模型（不许等刷新）", async () => {
    const { app, slots, dispose } = await boot();
    try {
      const { injected, undo } = await seatOf(slots);
      try {
        injected.load();
        await until(() => injected.directory.getSnapshot().status === "ready");
        expect(injected.directory.getSnapshot().current, "帧之前显示的是目录默认").toMatchObject({
          provider: "a",
          model: "m1",
        });
        const remote = app.get(Remote) as FakeRemote;
        await until(() => remote.subscriberCount > 0);
        // 宿主 `agent.model.select` 落的就是这一条事件 → `session/control` 的这一帧。
        remote.pushFrame({
          type: "projection",
          sessionId: "s1",
          seq: 1,
          changes: [
            {
              key: "modelSelection",
              val: { lastUsed: null, next: { provider: "b", model: "x1" } },
            },
          ],
        });
        await until(() => injected.directory.getSnapshot().current?.model === "x1");
        expect(
          injected.directory.getSnapshot().current,
          "投影帧到了座位却不跟 = 用户看到的就是「切了没反应，刷新才好」",
        ).toMatchObject({ provider: "b", model: "x1" });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });

  test("座位先建、投影键后到：目录也要跟上（不是只认建目录那一刻的快照）", async () => {
    // 这一条钉的是候选 A 的机理：基线与帧都来得**晚于**目录构造时，
    // 目录持有的 `binding.session.projections.faceOf('modelSelection')` 会不会跟着更新。
    const { app, slots, dispose } = await boot({ baselineValues: {} });
    try {
      const { injected, undo } = await seatOf(slots);
      try {
        injected.load();
        // 此刻投影键还没到：目录只能停在 loading（上游语义：缺键 = 还不知道选了什么）。
        await until(() => injected.directory.getSnapshot().status === "ready", 300);
        const remote = app.get(Remote) as FakeRemote;
        await until(() => remote.subscriberCount > 0);
        remote.pushFrame({
          type: "projection",
          sessionId: "s1",
          seq: 1,
          changes: [
            {
              key: "modelSelection",
              val: { lastUsed: null, next: { provider: "b", model: "x1" } },
            },
          ],
        });
        await until(() => injected.directory.getSnapshot().status === "ready");
        expect(
          injected.directory.getSnapshot().current,
          "投影键晚到，目录也必须跟上（否则「刷新才有效」）",
        ).toMatchObject({ provider: "b", model: "x1" });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });

  test("换连接代之后重开 `session/control`：重连过的界面也要跟着宿主更新", async () => {
    const { app, slots, dispose } = await boot();
    try {
      const { injected, undo } = await seatOf(slots);
      try {
        injected.load();
        await until(() => injected.directory.getSnapshot().status === "ready");
        const remote = app.get(Remote) as FakeRemote;
        await until(() => remote.subscriberCount > 0);
        const opened = remote.opens;

        // 换代：旧 socket 上的流全断（真机上就是重连 / HMR）。
        remote.dropStreams();
        app.get(FakeConnection).bump();
        await until(() => remote.opens > opened);
        expect(
          remote.opens,
          "换代后必须重开 control 流（不重开 = 重连过的界面冻在旧值，刷新才好）",
        ).toBeGreaterThan(opened);

        remote.pushFrame({
          type: "projection",
          sessionId: "s1",
          seq: 2,
          changes: [
            {
              key: "modelSelection",
              val: { lastUsed: null, next: { provider: "a", model: "m2" } },
            },
          ],
        });
        await until(() => injected.directory.getSnapshot().current?.model === "m2");
        expect(
          injected.directory.getSnapshot().current,
          "重开的流也要把帧喂到座位（否则重连之后模型选择又不动了）",
        ).toMatchObject({ provider: "a", model: "m2" });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });

  test("选强度也走 `session/selectModel`，且把 `reasoningEffort` 带进载荷", async () => {
    const { slots, dispose } = await boot();
    try {
      const { injected, undo } = await seatOf(slots);
      try {
        injected.load();
        await until(() => injected.directory.getSnapshot().status === "ready");
        const result = await injected.select({
          provider: "a",
          model: "m2",
          reasoningEffort: "high",
        });
        expect(result.ok, "带强度的选中也必须被宿主接受").toBe(true);
        const select = FakeRemote.calls.filter((call) => call.endpoint === "session/selectModel");
        expect(select, "强度走同一条 wire").toHaveLength(1);
        const payload = select[0]?.payload as { args: { request: unknown } } | undefined;
        // 强度**必须**出现在载荷里：选择器里选了强度、宿主却收不到，就是"界面上变了、实际没变"。
        expect(payload?.args.request).toMatchObject({
          sessionId: "s1",
          provider: "a",
          model: "m2",
          reasoningEffort: "high",
        });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });
});
