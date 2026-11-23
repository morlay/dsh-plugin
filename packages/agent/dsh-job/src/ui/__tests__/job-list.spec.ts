/**
 * 用户故事：**会话里跑着后台任务时，会话面板里有「后台任务」一节，能看见它们、也能 kill。**
 *
 * 判据落在两个后果上：
 * 1. 模型起了一个后台任务（宿主侧 `job_list` / `job` 那族工具已经在跑），界面上出现入口——
 *    上游 0.2.3 起它住在 `conversation.session.panel.section` 的 `id: 'background-jobs'` 一节
 *    （0.2.2 的头部动作位 `conversation.session.header.actions` 已不再注册），运行中的指示点
 *    在 `conversation.session.panel.indicator` 的 `id: 'background-jobs.running'`；
 * 2. 这条入口的数据来源真的挂上了：`job` 那组 remote 由本行 `$mount`（不挂则列表永远空）。
 *
 * 反向用例同样重要：只装数据面（`JobsClient`）而不装列表（`JobListSlots`）时，两处都是空的
 * ——否则「装上了」这件事无从判断，用户看到的就是「后台在跑，界面上什么都没有」。
 *
 * 替身的边界：`FakeRemote` 复刻 `RemoteDefault` 的两处关键行为——`$mount` 按 descriptor 发布
 * `remote.<namespace>` 服务名，以及 `remote.<namespace>` 这个**属性读**（真实现是 Proxy 回落）；
 * 渲染不在本 spec 的判据里（任务行、输出面板由上游 `JobListAction` 负责，我们不重写组件）。
 */
import {
  bootstrapApplication,
  Injectable,
  rootContextKey,
  type App,
  type Context,
} from "@morlay/zephyr";
import { Locale, provideRenderer, Remote, Slots } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { JobsClient } from "../jobs-client.service.ts";
import { provideJobUi } from "../job.provide.ts";

/** 一条 descriptor 的最小形状（`TYPERT_REMOTE.descriptors` 的子集）。 */
interface Descriptor {
  readonly namespace?: string;
  readonly method?: string;
}

/** 等条件成立（槽位注册与上游 `ctx.inject` 都是异步的）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** `job` 那组 remote 的调用面（本 spec 不触发，只要求可读）。 */
const JOB_FACE = {
  list: () => {
    throw new Error("本 spec 不开 roster 流");
  },
  follow: () => {
    throw new Error("本 spec 不开观察流");
  },
  kill: async () => ({ ok: true as const, value: { outcome: "requested" } }),
};

/** `Remote` 的替身：`$mount` 发布 `remote.<ns>` 服务名，`remote.<ns>` 可属性读。 */
@Injectable()
class FakeRemote extends Remote {
  /** 挂过的 namespace（判"有没有挂"）。 */
  readonly mounted: string[] = [];

  /** 契约要的那份宿主侧登记表：本 spec 不读，给空表。 */
  readonly upstream: Record<string, unknown> = {};

  private readonly faces = new Map<string, unknown>();

  private ctx: Context | undefined;

  onInit(ctx: Context): void {
    this.ctx = ctx;
  }

  /** 属性读那一面（`RemoteDefault` 是 Proxy 回落，这里直接给 getter）。 */
  get job(): unknown {
    return this.faces.get("job");
  }

  async $mount(contribution: unknown): Promise<() => Promise<void>> {
    const descriptors =
      (contribution as { descriptors?: readonly Descriptor[] } | undefined)?.descriptors ?? [];
    const disposed: Array<() => void> = [];
    const root = this.ctx === undefined ? undefined : this.ctx[rootContextKey];
    for (const descriptor of descriptors) {
      const namespace = String(descriptor.namespace);
      if (this.mounted.includes(namespace)) continue;
      this.mounted.push(namespace);
      if (namespace === "job") this.faces.set("job", JOB_FACE);
      const dispose = root?.reflect.provide(
        `remote.${namespace}`,
        this.faces.get(namespace) ?? JOB_FACE,
      );
      if (typeof dispose === "function") disposed.push(dispose);
    }
    return async () => {
      for (const dispose of disposed) dispose();
    };
  }

  async invoke(): Promise<unknown> {
    throw new Error("本 spec 不走 wire");
  }

  async whenMounted(): Promise<void> {}

  async whenNamespace(): Promise<void> {}

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    throw new Error("本 spec 不走流");
  }
}

/** 语言替身：本 spec 只看注册项，不看文案。 */
@Injectable()
class FakeLocale extends Locale {
  readonly bind: Locale["bind"] = () =>
    ((key: string) => `job:${key}`) as ReturnType<Locale["bind"]>;

  readonly register: Locale["register"] = () => () => {};

  readonly getSnapshot: Locale["getSnapshot"] = () => ({
    active: "zh" as ReturnType<Locale["getSnapshot"]>["active"],
    locales: [],
    revision: 0,
  });

  readonly subscribe: Locale["subscribe"] = () => () => {};
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起一行（可指定清单），并声明它要注册的那个头部动作位。
 * @param providers - 要装的行。
 * @returns `Slots` 与 `Remote` 替身。
 */
async function boot(
  providers: readonly Parameters<typeof bootstrapApplication>[0]["providers"][number][] = [
    ...provideJobUi(),
  ],
): Promise<{ slots: Slots; remote: FakeRemote }> {
  const app = await bootstrapApplication({
    providers: [...provideRenderer(), FakeRemote, FakeLocale, ...providers],
    timeoutMs: 10_000,
  });
  opened.push(app);
  const slots = app.get(Slots);
  // 两个位置由上游 `ui-session-panel` 声明（`conversation.session.panel.section` 与 `.indicator`，
  // 都是 list/session）；本 spec 只装 job 那两行，所以按同一形状声明一次，否则上游的注册会一直等位置。
  slots.registerDynamic(
    {
      name: "root",
      children: {
        "conversation.session.panel.section": { kind: "list", scope: "session" },
        "conversation.session.panel.indicator": { kind: "list", scope: "session", inline: true },
      },
    },
    () => null,
  );
  return { slots, remote: app.get(FakeRemote) };
}

/** 某一位置上的注册项（只取判据要的 `id`）。 */
function idsAt(slots: Slots, name: string): readonly (string | undefined)[] {
  const entries = slots.entries(name as never) as readonly {
    readonly options?: { readonly id?: string };
  }[];
  return entries.map((entry) => entry.options?.id);
}

describe("用户故事：后台任务在界面上可见、可 kill", () => {
  it("模型起了后台任务之后：面板里有任务一节，且它的数据面已挂上", async () => {
    const { slots, remote } = await boot();
    expect(remote.mounted, "JobsClient 必须自己 `$mount` job 那组 descriptor").toContain("job");
    await until(() => idsAt(slots, "conversation.session.panel.section").length > 0);
    expect(
      idsAt(slots, "conversation.session.panel.section"),
      "会话面板里必须有 background-jobs 一节（没有 = 后台任务在界面上看不见）",
    ).toEqual(["background-jobs"]);
    expect(
      idsAt(slots, "conversation.session.panel.indicator"),
      "运行中的指示点必须在面板开关上",
    ).toEqual(["background-jobs.running"]);
  });

  it("反向：只装数据面不装列表时，用户看不到任何入口", async () => {
    const { slots } = await boot([JobsClient]);
    // 等一轮异步装配，确认不是"还没跑到"。
    await until(() => false, 200);
    expect(idsAt(slots, "conversation.session.panel.section")).toEqual([]);
    expect(idsAt(slots, "conversation.session.panel.indicator")).toEqual([]);
    expect(slots.keys(), "位置被碰过、但没人注册").toContain("conversation.session.panel.section");
  });
});
