/**
 * 用户故事：**会话里跑着后台任务时，会话面板里有「后台任务」一节，能看见它们、也能 kill。**
 *
 * 判据落在两个后果上：
 * 1. 模型起了一个后台任务（宿主侧 `job_list` / `job` 那族工具已经在跑），界面上出现入口——
 *    上游 0.2.3 起它住在 `conversation.session.panel.section` 的 `id: 'background-jobs'` 一节
 *    （0.2.2 的头部动作位 `conversation.session.header.actions` 已不再注册），运行中的指示点
 *    在 `conversation.session.panel.indicator` 的 `id: 'background-jobs.running'`；
 * 2. 这条入口的数据来源真的挂上了：`job` 那组 remote 由客户端形态的 `onInit` `$mount`（不挂则列表永远空）。
 *
 * 反向用例同样重要：只装数据面（`JobEndpointClient` + `JobsClient`）而不装列表（`JobListSlots`）时，两处都是空的
 * ——否则「装上了」这件事无从判断，用户看到的就是「后台在跑，界面上什么都没有」。
 *
 * **全链路，只替外部世界**：host 侧是真 `LocalJobRegistry` + 真上游 `JobController` + 真 `JobEndpointDefault`，
 * client 侧是真 `Remote`（`LocalRemote` 接 host 的执行面）；不替换自己的传输层。
 * 渲染不在本 spec 的判据里（任务行、输出面板由上游 `JobListAction` 负责，我们不重写组件）。
 */
import { Locale, provideRenderer, Remote, Slots } from "@morlay/zephyr-app/client";
import { remoteNamespaceOf } from "@morlay/zephyr-app/client/remote";
import { provideTypert } from "@morlay/zephyr-app";
import { provideApiGateway } from "@morlay/zephyr-app";
import { bootTwoSided, clientWithTransport } from "@morlay/zephyr-app/testing";
import { Injectable } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { App } from "@morlay/zephyr";
import { JobControllerRow, JobRegistryDefault } from "../../index.ts";
import { JobEndpointDefault } from "../../server/index.ts";
import { JobEndpointClient } from "../job-endpoint.client.ts";
import { JobsClient } from "../jobs-client.service.ts";
import { provideJobUi } from "../job.provide.ts";

/** 等条件成立（槽位注册与上游 `ctx.inject` 都是异步的）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
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

/**
 * 起一双端：host = 真注册表 + 真 `job/*` 端点，client = 本包的浏览器半。
 *
 * 生命周期由 `bootTwoSided` 自己收（`onTestFinished`）。
 * @param providers - client 侧要装的业务行（默认整份 `provideJobUi()`）。
 * @returns client app。
 */
async function boot(
  providers: readonly Parameters<typeof clientWithTransport>[1][number][] = [...provideJobUi()],
): Promise<App> {
  const two = await bootTwoSided({
    createHost: () => [
      ...provideTypert(),
      ...provideApiGateway(),
      JobRegistryDefault,
      JobControllerRow,
      JobEndpointDefault,
    ],
    createClient: (host) =>
      clientWithTransport(host, [...provideRenderer(), FakeLocale, ...providers]),
  });
  if (two.client === undefined) throw new Error("client 没装上");
  return two.client;
}

/** 某一位置上的注册项（只取判据要的 `id`）。 */
function idsAt(slots: Slots, name: string): readonly (string | undefined)[] {
  const entries = slots.entries(name as never) as readonly {
    readonly options?: { readonly id?: string };
  }[];
  return entries.map((entry) => entry.options?.id);
}

/**
 * 把会话面板的两个位置声明出来（上游 `ui-session-panel` 声明的同一形状）。
 * @param slots - client 的 `Slots`。
 */
function declarePositions(slots: Slots): void {
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
}

describe("用户故事：后台任务在界面上可见、可 kill", () => {
  test("模型起了后台任务之后：面板里有任务一节，且它的数据面已挂上", async () => {
    const app = await boot();
    const remote = app.get(Remote);
    // 客户端形态的 `onInit` 挂上了 `job` 那组 descriptor：真 `Remote` 上那一面必须读得到。
    await remote.whenNamespace("job");
    expect(
      remoteNamespaceOf(remote, "job"),
      "客户端形态必须自己 `$mount` job 那组 descriptor（否则列表永远空）",
    ).toBeDefined();
    const slots = app.get(Slots);
    declarePositions(slots);
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

  test("反向：只装数据面不装列表时，用户看不到任何入口", async () => {
    const app = await boot([JobEndpointClient, JobsClient]);
    const slots = app.get(Slots);
    declarePositions(slots);
    // 等一轮异步装配，确认不是"还没跑到"。
    await until(() => false, 200);
    expect(idsAt(slots, "conversation.session.panel.section")).toEqual([]);
    expect(idsAt(slots, "conversation.session.panel.indicator")).toEqual([]);
    expect(slots.keys(), "位置被碰过、但没人注册").toContain("conversation.session.panel.section");
  });
});
