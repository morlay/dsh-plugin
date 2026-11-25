/**
 * 模型菜单里的「启用智能体团队协作」开关**装上了没有**。
 *
 * 判据是这个开关的注册项（`conversation.input.model.options` 下的 `agent-team`）。它注册在
 * 上游 `ui-agent-team` 的 `ctx.inject(['remote','remote.agentTeams'], …)` 里——**那组 remote 没人 `$mount`
 * 时，整块回调永不触发、且不报错**（cordis 的 inject fiber 停在待激活）。用户看到的就是
 * 「菜单里没有开关，也没有报错」。
 *
 * 所以这条 spec 同时钉两件事：
 * 1. `AgentTeamUi.onInit` 真的把 `agentTeams` 那组 remote 挂上了；
 * 2. 挂上之后，开关确实注册进了菜单槽位。
 *
 * **全链路，只替外部世界**：host 侧是真 `provideAgentTeam()`（上游 `TeamService` 适配行 + 工具行 +
 * 那份 descriptor 的提供者登记），client 侧是真 `Remote`（`LocalRemote` 接 host 的执行面）。
 */
import { Injectable, type App } from "@morlay/zephyr";
import { Locale, provideRenderer, Remote, Slots } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { provideApiGateway, provideRemoteAccess, provideTypert } from "@morlay/zephyr-app";
import { bootTwoSided, clientWithTransport } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { AgentTeamUi } from "../agent-team.ui.ts";

/** 等条件成立（槽位注册与上游 `ctx.inject` 都是异步的）。 */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
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

/**
 * 起一双端：host = 真团队两行（含那份 descriptor 的提供者登记），client = 本包的界面行。
 * @returns client app。
 */
async function boot(): Promise<App> {
  const two = await bootTwoSided({
    // host 只要有**端点执行面**（`RemoteHandlers` + 网关）：本 spec 判的是「client 有没有把这一组
    // descriptor 挂上」，不调那一组的端点（端点的真行为在 `agent-team-live.spec.ts` 里判）。
    createHost: () => [...provideTypert(), ...provideApiGateway(), ...provideRemoteAccess()],
    createClient: (host) =>
      clientWithTransport(host, [...provideRenderer(), FakeLocale, AgentTeamUi]),
  });
  if (two.client === undefined) throw new Error("client 没装上");
  const slots = two.client.get(Slots);
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
  return two.client;
}

describe("模型菜单里的「启用智能体团队协作」开关", () => {
  test("AgentTeamUi 挂上 agentTeams 那组 remote，开关才注册进菜单", async () => {
    const app = await boot();
    const remote = app.get(Remote);
    // 上游那份 descriptor 由 `AgentTeamUi` 自己 `$mount`：真 `Remote` 上那一面必须读得到。
    await remote.whenNamespace("agentTeams");
    expect(
      remoteNamespaceOf(remote, "agentTeams"),
      "AgentTeamUi 必须自己 `$mount` 这组 descriptor（否则上游的 ctx.inject 永不触发）",
    ).toBeDefined();
    const slots = app.get(Slots);
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
