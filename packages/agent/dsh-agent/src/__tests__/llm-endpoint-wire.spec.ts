/**
 * `llm` 组的 **wire 名字判据**：我们编译出的 descriptor 必须与上游宿主那份逐字相同。
 *
 * 这一组没有独立契约类（方法直接挂在宿主 service 上），所以类型层没有“两面可比”的对手；
 * 参数**名字**只有这张表能守——`llm/discoverModels` 曾经收一个对象且没声明 `parameters`，
 * descriptor 编出 `{ request }`，网关按上游 descriptor 校验必然 `arguments-invalid`。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import { TYPERT as UPSTREAM_TYPERT } from "@deepseek-ai/dsh-llm/typert";
import type { RemoteDescriptor } from "@morlay/zephyr-app/remote";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { LlmEndpoint } from "@morlay/dsh-agent/server";

/** 上游宿主贡献里一个方法的最小形状。 */
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
 * @param descriptor - 宿主类编译出的 descriptor。
 * @returns `方法名(形参名, …) [stream]`。
 */
function shapeOf(descriptor: RemoteDescriptor): string {
  const names = descriptor.parameters.map((parameter) => parameter.name).join(",");
  return `${descriptor.method}(${names})${descriptor.mode === "stream" ? " [stream]" : ""}`;
}

describe("llm 组的 wire 名字与上游一致", () => {
  test("逐方法比：wire 形参名与流式标记都相同", () => {
    const ours = remoteDescriptorsOf(LlmEndpoint).descriptors.map(shapeOf).sort();
    const upstream = upstreamMethods()
      .map(
        (method) =>
          `${method.method}(${(method.parameters ?? []).map((parameter) => parameter.wire ?? parameter.name).join(",")})${method.mode === "stream" ? " [stream]" : ""}`,
      )
      .sort();
    expect(ours).toEqual(upstream);
  });

  test("`discoverModels` 收的是 `settingsNs` + `request`（不是 `request` 一个对象）：回归判据", () => {
    const discover = remoteDescriptorsOf(LlmEndpoint).descriptors.find(
      (descriptor) => descriptor.method === "discoverModels",
    );
    expect(discover?.parameters.map((parameter) => parameter.name)).toEqual([
      "settingsNs",
      "request",
    ]);
  });
});
