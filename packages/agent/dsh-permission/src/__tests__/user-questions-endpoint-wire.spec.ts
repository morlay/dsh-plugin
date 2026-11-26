/**
 * `userQuestions` 组的 **wire 名字判据**：我们编译出的 descriptor 必须与上游宿主那份逐字相同。
 *
 * 类型层抓不到名字（`agentId` / `callId` / `answer` 在类型上都是普通值），只有这张表能守——
 * `userQuestions/answer` 曾经编出 `{ request }`，网关按上游 descriptor 校验必然 `arguments-invalid`
 * （与 `terminal/environment`、`commands/execute` 同一类）。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import { TYPERT as UPSTREAM_TYPERT } from "@deepseek-ai/dsh-user-questions/typert";
import type { RemoteDescriptor } from "@morlay/zephyr-app/remote";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { UserQuestionsEndpoint } from "@morlay/dsh-permission/endpoint";

/** 上游宿主贡献里一个方法的最小形状（只取判据要的字段）。 */
interface UpstreamMethod {
  readonly method: string;
  readonly mode?: string;
  readonly parameters?: readonly { readonly name: string; readonly wire?: string }[];
}

/**
 * 上游宿主贡献里的方法表（顶层键是 `invocations`，网关校验读的就是它）。
 * @returns 方法表。
 */
function upstreamMethods(): readonly UpstreamMethod[] {
  const contribution = UPSTREAM_TYPERT as { readonly invocations?: readonly UpstreamMethod[] };
  return contribution.invocations ?? [];
}

/**
 * 我们编译出的形状签名。
 * @param descriptor - 契约编译出的 descriptor。
 * @returns `方法名(形参名, …) [stream]`。
 */
function shapeOf(descriptor: RemoteDescriptor): string {
  const names = descriptor.parameters.map((parameter) => parameter.name).join(",");
  return `${descriptor.method}(${names})${descriptor.mode === "stream" ? " [stream]" : ""}`;
}

describe("userQuestions 组的 wire 名字与上游一致", () => {
  test("逐方法比：wire 形参名与流式标记都相同", () => {
    const ours = remoteDescriptorsOf(UserQuestionsEndpoint).descriptors.map(shapeOf).sort();
    const upstream = upstreamMethods()
      .map(
        (method) =>
          `${method.method}(${(method.parameters ?? []).map((parameter) => parameter.wire ?? parameter.name).join(",")})${method.mode === "stream" ? " [stream]" : ""}`,
      )
      .sort();
    expect(ours).toEqual(upstream);
  });

  test("`answer` 收的是 `agentId` / `callId` / `answer`（不是 `request`）：真机那条 arguments-invalid 的回归判据", () => {
    const answer = remoteDescriptorsOf(UserQuestionsEndpoint).descriptors.find(
      (descriptor) => descriptor.method === "answer",
    );
    expect(answer?.parameters.map((parameter) => parameter.name)).toEqual([
      "agentId",
      "callId",
      "answer",
    ]);
  });
});
