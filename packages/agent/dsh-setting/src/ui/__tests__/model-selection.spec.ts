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
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { Locale, mockTransport, Remote, provideRenderer, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { describe, expect, it } from "vitest";
import { ModelSelectionSlots } from "../model-selection-slots.ts";

/** 宿主的目录帧：两个 provider 分组，`a/m1` 是当前选择。 */
const CATALOG = {
  default: { provider: "a", model: "m1" },
  routableProviders: ["a", "b"],
  groups: [
    { id: "a", name: "Provider A", models: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }] },
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

  static next: { catalog?: unknown; select?: unknown } = {};

  /** `remote.session` 上本行要用到的两个方法（上游那一行只调这两个）。 */
  private readonly face: {
    modelCatalog(): Promise<unknown>;
    selectModel(request: unknown): Promise<unknown>;
  };

  readonly upstream: Record<string, unknown>;

  constructor() {
    super();
    const transport = mockTransport({
      "session/modelCatalog": () => FakeRemote.next.catalog ?? { ok: true, value: CATALOG },
      "session/selectModel": (payload) => {
        FakeRemote.calls.push({ endpoint: "session/selectModel", payload });
        return FakeRemote.next.select ?? { ok: true, value: { selected: { provider: "a", model: "m2" } } };
      },
    });
    this.face = {
      modelCatalog: () => {
        FakeRemote.calls.push({ endpoint: "session/modelCatalog", payload: undefined });
        return transport.invoke("session/modelCatalog", {});
      },
      selectModel: (request: unknown) => transport.invoke("session/selectModel", { args: { request } }),
    };
    this.upstream = { session: this.face };
    // `Remote` 契约的 `session` 是可选成员（`dsh-session` 的 declaration merging 声明它由 `$mount` 后才有值）：
    // 替身在这里挂同一份面，上游那一行不区分「真 Proxy / 替身」。
    Object.defineProperty(this, "session", { value: this.face, enumerable: true });
  }

  async $mount(): Promise<() => Promise<void>> {
    return async () => {};
  }

  async whenMounted(): Promise<void> {}

  async whenNamespace(): Promise<void> {}

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    const empty = (async function* () {})() as unknown as AsyncIterable<unknown> & {
      dispose(): Promise<void>;
    };
    return Object.assign(empty, { dispose: async () => {} });
  }
}

/** 会话目录替身：只有上游那一行真读的三个成员（`scope` / `binding` / `subagentAddress`）。 */
@Injectable()
class FakeSessions extends SessionController {
  readonly list = {
    getSnapshot: () => ({ ids: ["s1"], byId: {}, phase: "ready" as const, projectionsBySession: {} }),
    subscribe: () => () => {},
  };

  /** 本装配没有子代理：上游那一行据此判断「这个会话能不能用模型 RPC」。 */
  subagentAddress(): undefined {
    return undefined;
  }

  scope(): NonNullable<ReturnType<SessionController["scope"]>> {
    return {
      sessionId: "s1" as NonNullable<ReturnType<SessionController["scope"]>>["sessionId"],
      effect: () => () => {},
      get: () => undefined,
      on: () => () => {},
      emit: () => {},
      off: () => {},
      inject: () => undefined,
    };
  }

  // 其余成员这条用例不读：照契约给「明确失败」，避免假件悄悄返回 undefined。
  create(): never {
    throw new Error("FakeSessions.create 未实现");
  }

  readonly searchResultLimit = 0;

  search(): never {
    throw new Error("FakeSessions.search 未实现");
  }

  fork(): never {
    throw new Error("FakeSessions.fork 未实现");
  }

  async refresh(): Promise<never> {
    throw new Error("FakeSessions.refresh 未实现");
  }

  scopeOf(): undefined {
    return undefined;
  }

  async refreshProjections(): Promise<never> {
    throw new Error("FakeSessions.refreshProjections 未实现");
  }

  sessionOf(): undefined {
    return undefined;
  }

  get(): undefined {
    return undefined;
  }

  retainInfo() {
    return { getSnapshot: () => undefined, subscribe: () => () => {} };
  }

  retain(): never {
    throw new Error("FakeSessions.retain 未实现");
  }

  async using(): Promise<never> {
    throw new Error("FakeSessions.using 未实现");
  }

  /** 稳定的一份 binding：上游 `ctx.modelDirectories` 按 binding 的**对象身份**缓存每会话目录。 */
  private readonly bindingOf = {
    session: {
      projections: {
        // `modelSelection` 的持久投影（本仓会话数据面目前给的是恒空 observable，见回报；
        // 这里给「还没选过」的真实形状，让目录能走到 ready）。
        faceOf: () => ({ getSnapshot: () => ({ lastUsed: null, next: null }), subscribe: () => () => {} }),
      },
      getSnapshot: () => ({ blank: true }),
    },
  };

  binding(): unknown {
    return this.bindingOf;
  }
}

/** 语言替身：只回一个稳定字符串（文案不是这条用例的判据）。 */
@Injectable()
class FakeLocale extends Locale {
  readonly bind: Locale["bind"] = () => ((key: string) => `model:${key}`) as ReturnType<Locale["bind"]>;

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
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  slots: Slots;
  dispose: () => Promise<void>;
}> {
  FakeRemote.calls = [];
  FakeRemote.next = {};
  const app = await bootstrapApplication({
    providers: [...provideRenderer(),
    FakeRemote, FakeSessions, FakeLocale, ModelSelectionSlots],
    timeoutMs: 8_000,
  });
  return { app, slots: app.get(Slots), dispose: () => app.dispose() };
}

/** 座位注册项交给渲染器的业务面（`ModelSelectInjected`）。 */
interface SeatInjected {
  readonly available: boolean;
  readonly directory: {
    getSnapshot(): {
      readonly status: string;
      readonly groups: readonly { readonly id: string; readonly models: readonly { readonly id: string }[] }[];
    };
  };
  readonly load: () => void;
  readonly select: (selection: { provider: string; model: string }) => Promise<{ ok: boolean }>;
}

/**
 * 把座位的位置声明出来并等它注册（声明来自 `ui-conversation` 的 `conversation.composer.bar` children；
 * 这里只装渲染面，所以按下游那行的同一形状声明一次——位置没声明时 `slots.inject` 会一直等）。
 * @param slots - 真 `Slots`。
 * @returns 座位的 `inject` 工厂与撤销声明用的函数。
 */
async function seatOf(slots: Slots): Promise<{ injected: SeatInjected; undo: () => void }> {
  const undo = slots.registerDynamic({
    name: "root",
    children: { "conversation.input.model": { kind: "single", scope: "session" } },
  }, () => null);
  await until(() => slots.entries("conversation.input.model" as never).length > 0);
  const entry = slots.entries("conversation.input.model" as never)[0] as
    | { inject?: (sessionId: unknown) => SeatInjected }
    | undefined;
  expect(entry?.inject, "座位注册项必须带上游那一行的 inject 工厂").toBeDefined();
  // 会话身份在 wire 上就是字符串（`SessionId` 品牌在边界铸）；这里不必为它拖进宿主模块图。
  return { injected: entry!.inject!("s1" as never), undo };
}

describe("模型选择器那一行接上了没有", { timeout: 15_000 }, () => {
  it("`conversation.input.model` 座位注册出来（输入框旁的选择器就靠它上屏）", async () => {
    const { slots, dispose } = await boot();
    try {
      const undo = slots.registerDynamic({
        name: "root",
        children: { "conversation.input.model": { kind: "single", scope: "session" } },
      }, () => null);
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

  it("目录来自 `session/modelCatalog`，选中走 `session/selectModel`", async () => {
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
        expect(payload?.args.request).toMatchObject({ sessionId: "s1", provider: "a", model: "m2" });
      } finally {
        undo();
      }
    } finally {
      await dispose();
    }
  });
});
