// web 运行时的契约：令牌按服务语义命名（上游注册名 `web`）。
import type WebRuntimeService from "@deepseek-ai/dsh-web";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "web" })
export abstract class Web {
  abstract readonly registerSearchProvider: WebRuntimeService["registerSearchProvider"];

  abstract readonly registerFetchProvider: WebRuntimeService["registerFetchProvider"];

  abstract readonly search: WebRuntimeService["search"];

  abstract readonly fetch: WebRuntimeService["fetch"];

  abstract readonly fetchReady: WebRuntimeService["fetchReady"];

  abstract readonly searchReady: WebRuntimeService["searchReady"];

  /** 当前可用的搜索 / 抓取 provider（诊断与选择器用）。 */
  abstract readonly listProviders: WebRuntimeService["listProviders"];

  /** 上游基类挂的 remote 绑定（gateway 靠它发现端点）。 */
  abstract readonly typertRemote: WebRuntimeService["typertRemote"];
}

/**
 * 覆盖守卫（严格）：上游 `WebRuntimeService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type WebCovered = AssertTrue<AssertCoveredStrict<WebRuntimeService, Web>>;
