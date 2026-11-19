/**
 * 后台任务的浏览器半**装上了没有**。
 *
 * 判据是会话头部动作位里的那条注册项（`conversation.session.header.actions` 的 `job-list`）。
 * 宿主半（注册表 + `job_list` 一族工具行 + `remote.job` 的宿主面）是另一棵树上的事：缺了这半边，
 * 模型照样能起后台任务，界面上却没有入口、也没有 kill——「跑着的东西看不见」。
 *
 * 这条 spec 同时钉三件事：
 * 1. `JobsClient.onInit` 真的把 `job` 那组 `TYPERT_REMOTE` 挂上了（上游 `apply` 里 `const { job } = remote`
 *    是属性读，挂上之前是空）；
 * 2. 挂上之后，任务列表确实注册进了头部动作位；
 * 3. **反向**：只装数据面（`JobsClient`）而不装列表（`JobListSlots`）时，头部动作位是空的——否则
 *    "装了"这件事就无从判断。
 *
 * 替身的边界：`FakeRemote` 复刻 `RemoteDefault` 的两处关键行为——`$mount` 按 descriptor 发布
 * `remote.<namespace>` 服务名，以及 `remote.<namespace>` 这个**属性读**（真实现是 Proxy 回落）。
 */
import { bootstrapApplication, Injectable, type App, type Context } from "@morlay/zephyr";
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
    const root = this.ctx?.root ?? this.ctx;
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
  // 头部动作位由上游 `ui-conversation` 声明（`conversation.session.header.actions`，list/session）；
  // 本 spec 只装 job 那两行，所以按同一形状声明一次，否则上游的注册会一直等位置。
  slots.registerDynamic(
    {
      name: "root",
      children: {
        "conversation.session.header.actions": { kind: "list", scope: "session" },
      },
    },
    () => null,
  );
  return { slots, remote: app.get(FakeRemote) };
}

/** 头部动作位里的注册项（只取判据要的 `id`）。 */
function jobActionIds(slots: Slots): readonly (string | undefined)[] {
  const entries = slots.entries("conversation.session.header.actions" as never) as readonly {
    readonly options?: { readonly id?: string };
  }[];
  return entries.map((entry) => entry.options?.id);
}

describe("会话头部的后台任务列表", () => {
  it("装 provideJobUi()：job 那组 remote 被挂上，列表注册进头部动作位", async () => {
    const { slots, remote } = await boot();
    expect(remote.mounted, "JobsClient 必须自己 `$mount` job 那组 descriptor").toContain("job");
    await until(() => jobActionIds(slots).length > 0);
    expect(
      jobActionIds(slots),
      "头部动作位里必须有 job-list（没有 = 后台任务在界面上看不见）",
    ).toEqual(["job-list"]);
  });

  it("反向：只装数据面不装列表，头部动作位是空的", async () => {
    const { slots } = await boot([JobsClient]);
    // 等一轮异步装配，确认不是"还没跑到"。
    await until(() => false, 200);
    expect(jobActionIds(slots)).toEqual([]);
    expect(slots.keys(), "位置被碰过、但没人注册").toContain("conversation.session.header.actions");
  });
});
