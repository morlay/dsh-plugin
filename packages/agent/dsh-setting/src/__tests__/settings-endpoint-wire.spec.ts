/**
 * `settings` 组的 **wire 名字判据**：我们编译出的 descriptor 必须与上游宿主那份逐字相同。
 *
 * 类型层抓不到名字（`ns` / `patch` / `ops` / `section` / `expectedRevision` 在类型上都是普通值），只有这张表
 * 能守。这组是**多位置形参**，名字错就是真机上的 `arguments-invalid`（与 `commands/execute` 同一类）。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import { TYPERT as UPSTREAM_TYPERT } from "@deepseek-ai/dsh-api-settings-controller/typert";
import type { RemoteDescriptor } from "@morlay/zephyr-app/remote";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { SettingsEndpoint } from "@morlay/dsh-setting/endpoint";

/** 上游宿主贡献里一个方法的最小形状。 */
interface UpstreamMethod {
  readonly method: string;
  readonly mode?: string;
  readonly parameters?: readonly { readonly name: string; readonly wire?: string }[];
}

/**
 * 上游宿主贡献里的方法表，只留 `settings` 这一组（同包还有 `credentials`）。
 * @returns 方法表。
 */
function upstreamMethods(): readonly UpstreamMethod[] {
  const contribution = UPSTREAM_TYPERT as {
    readonly invocations?: readonly (UpstreamMethod & { readonly id?: string })[];
  };
  return (contribution.invocations ?? []).filter((method) => (method.id ?? "").includes("#settings/"));
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

describe("settings 组的 wire 名字与上游一致", () => {
  test("逐方法比：wire 形参名与流式标记都相同", () => {
    const ours = remoteDescriptorsOf(SettingsEndpoint).descriptors.map(shapeOf).sort();
    const upstream = upstreamMethods()
      .map(
        (method) =>
          `${method.method}(${(method.parameters ?? []).map((parameter) => parameter.wire ?? parameter.name).join(",")})${method.mode === "stream" ? " [stream]" : ""}`,
      )
      .sort();
    expect(ours).toEqual(upstream);
  });

  test("`mutate` 收的是 `ns` / `ops` / `expectedRevision` 三个位置形参：回归判据", () => {
    const mutate = remoteDescriptorsOf(SettingsEndpoint).descriptors.find(
      (descriptor) => descriptor.method === "mutate",
    );
    expect(mutate?.parameters.map((parameter) => parameter.name)).toEqual([
      "ns",
      "ops",
      "expectedRevision",
    ]);
  });
});
