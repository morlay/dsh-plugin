// web 运行时的契约：令牌按服务语义命名（上游注册名 `web`）。
import type WebRuntimeService from "@deepseek-ai/dsh-web";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `WebRuntime` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.web.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type WebCovered = AssertTrue<AssertCovered<WebRuntimeService, Web>>;

@Injectable()
export abstract class Web {
  abstract readonly registerSearchProvider: WebRuntimeService["registerSearchProvider"];

  abstract readonly registerFetchProvider: WebRuntimeService["registerFetchProvider"];

  abstract readonly search: WebRuntimeService["search"];

  abstract readonly fetch: WebRuntimeService["fetch"];

  abstract readonly fetchReady: WebRuntimeService["fetchReady"];

  abstract readonly searchReady: WebRuntimeService["searchReady"];
}
