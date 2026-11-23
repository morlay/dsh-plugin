/**
 * 模型菜单里的「启用智能体团队协作」开关**装上了没有**。
 *
 * 判据是这个开关的注册项（`conversation.input.model.options` 下的 `agent-team`）。它注册在
 * 上游 `ui-agent-team` 的 `ctx.inject(['remote','remote.agentTeams'], …)` 里——**那组 remote 没人 `$mount`
 * 时，整块回调永不触发、且不报错**（cordis 的 inject fiber 停在待激活）。用户看到的就是
 * 「菜单里没有开关，也没有报错」。
 *
 * 所以这条 spec 同时钉两件事：
 * 1. `AgentTeamUi.onInit` 真的把 `agentTeams` 那组 `TYPERT_REMOTE` 挂上了；
 * 2. 挂上之后，开关确实注册进了菜单槽位。
 *
 * 替身的边界：`FakeRemote.$mount` 复刻 `RemoteDefault.publishNamespace` 的**唯一关键行为**——
 * 按 descriptor 把 `remote.<namespace>` 发布成服务名（不发布，上游的 `ctx.inject` 就等不到）。
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
import { AgentTeamUi } from "../agent-team.ui.ts";

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

/** `Remote` 的替身：`$mount` 时按 descriptor 发布 `remote.<namespace>`（与 `RemoteDefault` 同形）。 */
@Injectable()
class FakeRemote extends Remote {
  /** 挂过的 namespace（判"有没有挂"）。 */
  readonly mounted: string[] = [];

  readonly upstream: Record<string, unknown> = {};

  private ctx: Context | undefined;

  onInit(ctx: Context): void {
    this.ctx = ctx;
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
      // 这一组的方法面（本 spec 只关心"名字在不在"）：`setEnabled` 是它唯一的方法。
      const face = { setEnabled: async () => ({ ok: true, value: undefined }) };
      const dispose = root?.reflect.provide(`remote.${namespace}`, face);
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
    ((key: string) => `team:${key}`) as ReturnType<Locale["bind"]>;

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
 * 起这一行，并声明它要注册的那个菜单槽位。
 * @returns `Slots` 与 `Remote` 替身。
 */
async function boot(): Promise<{ slots: Slots; remote: FakeRemote }> {
  const app = await bootstrapApplication({
    providers: [...provideRenderer(), FakeRemote, FakeLocale, AgentTeamUi],
    timeoutMs: 10_000,
  });
  opened.push(app);
  const slots = app.get(Slots);
  // 位置由上游 `ui-model-selection` 声明（`conversation.input.model.options`，list/session）；
  // 本 spec 只装 agent-team 这一行，所以按同一形状声明一次，否则上游的注册会一直等位置。
  // 三处位置（形状照抄声明方）：
  // - `shell.overlay`：上游那个开关的注册**包在** `slots.inject('shell.overlay', function* () {…})` 里，
  //   位置不声明，里面那层 `conversation.input.model.options` 的注册根本不会跑；
  // - `conversation.input.model.options`：`ui-model-selection` 声明的菜单槽位（开关落在它下面）；
  // - `conversation.session.header.actions.subagent.footer`：任务板那一格（顺带钉它一起注册）。
  slots.registerDynamic(
    {
      name: "root",
      children: {
        "shell.overlay": { kind: "list", scope: "root" },
        "conversation.input.model.options": { kind: "list", scope: "session" },
        "conversation.session.header.actions.subagent.footer": { kind: "list", scope: "session" },
      },
    },
    () => null,
  );
  return { slots, remote: app.get(FakeRemote) };
}

describe("模型菜单里的「启用智能体团队协作」开关", () => {
  it("AgentTeamUi 挂上 agentTeams 那组 remote，开关才注册进菜单", async () => {
    const { slots, remote } = await boot();
    expect(remote.mounted, "AgentTeamUi 必须自己 `$mount` 这组 descriptor").toContain("agentTeams");
    await until(() => slots.entries("conversation.input.model.options" as never).length > 0);
    const entries = slots.entries("conversation.input.model.options" as never) as readonly {
      readonly options?: { readonly id?: string };
    }[];
    expect(
      entries.map((entry) => entry.options?.id),
      "菜单槽位里必须有 agent-team 那一条（没有 = 用户说的「又没装配上」）",
    ).toEqual(["agent-team"]);
  });
});
