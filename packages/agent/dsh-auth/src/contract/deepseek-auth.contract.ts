// deepseekAuth 契约：令牌按服务语义命名（上游注册名 `deepseekAuth`）。
import type { DeepSeekAuth } from "@deepseek-ai/dsh-deepseek-auth";
import { Injectable } from "@morlay/zephyr";
import type { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/**
 * 契约面：上游 `DeepSeekAuth` 的**全部**公开成员。
 *
 * 上游的 DeepSeek 路由（`llm-deepseek-api-key` / `llm-deepseek-account` / `web-deepseek-api`）都按
 * `ctx.deepseekAuth.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type DeepSeekAuthCovered = AssertTrue<AssertCovered<DeepSeekAuth, DeepSeekAuthToken>>;

@Injectable({ name: "deepseekAuth" })
export abstract class DeepSeekAuthToken {
  abstract readonly connect: DeepSeekAuth["connect"];

  abstract readonly routeKind: DeepSeekAuth["routeKind"];

  abstract readonly candidates: DeepSeekAuth["candidates"];

  abstract readonly authorize: DeepSeekAuth["authorize"];
}
