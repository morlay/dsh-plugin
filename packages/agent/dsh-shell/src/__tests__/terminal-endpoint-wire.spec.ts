/**
 * `terminal` 组的 **wire 形状判据**：我们编译出的 descriptor 必须与上游**宿主**那份逐字相同。
 *
 * 为什么：真机上 `terminal/environment` 报过
 * `gateway/arguments-invalid: args fields do not match the descriptor: missing "agentId"; unexpected "request"`
 * ——契约没声明 `parameters` 时 `remoteDescriptorsOf` 把第一个实参包成 `{ request }`，而网关按**上游**
 * descriptor 校验（那份要求位置形参 `agentId`）。只要两边不是逐字相同，真机就炸。
 *
 * 基准选**宿主**贡献（`@deepseek-ai/dsh-api-terminal-controller/typert`），不是 remote 贡献：网关校验用的是
 * 宿主那份（带 `wire` 的 lookup 投影），remote 那份是给客户端用的另一面。
 *
 * 判据：每个方法的「wire 名列表 + 流式标记」逐条相等；方法多了或少了也红。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import { TYPERT as UPSTREAM_TERMINAL_TYPERT } from "@deepseek-ai/dsh-api-terminal-controller/typert";
import type { RemoteDescriptor } from "@morlay/zephyr-app/remote";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { TerminalEndpoint } from "@morlay/dsh-shell/endpoint";

/** 上游宿主贡献里一个方法的最小形状（只取判据要的那几个字段）。 */
interface UpstreamMethod {
  readonly method: string;
  readonly mode?: string;
  readonly scope?: { readonly wire?: string };
  readonly parameters?: readonly { readonly name: string; readonly wire?: string }[];
}

/**
 * 上游宿主贡献里的方法表。
 * @returns 方法名 → 最小形状。
 */
function upstreamMethods(): readonly UpstreamMethod[] {
  // 宿主贡献的顶层键是 `invocations`（不是 `descriptors`）：网关校验读的就是它。
  const contribution = UPSTREAM_TERMINAL_TYPERT as { readonly invocations?: readonly UpstreamMethod[] };
  return contribution.invocations ?? [];
}

/**
 * wire 名列表（上游取 `wire ?? name`；契约侧的 `name` 就是 wire 名）。
 * @param method - 上游一个方法。
 * @returns 逗号拼起来的 wire 名。
 */
function wireNamesOf(method: UpstreamMethod): string {
  // **只看 `parameters`**：`scope.wire` 是上下文绑定（同一件事的另一个写法），把它算进来会把 agent 数两遍。
  return (method.parameters ?? []).map((parameter) => parameter.wire ?? parameter.name).join(",");
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

describe("terminal 组的 wire 形状与上游宿主 descriptor 一致", () => {
  test("逐方法比：wire 形参名与流式标记都相同", () => {
    const ours = remoteDescriptorsOf(TerminalEndpoint).descriptors.map(shapeOf).sort();
    const upstream = upstreamMethods()
      .map((method) => `${method.method}(${wireNamesOf(method)})${method.mode === "stream" ? " [stream]" : ""}`)
      .sort();
    expect(ours).toEqual(upstream);
  });

  test("`environment` 收的是 `agentId`（不是 `request`）：真机那条 arguments-invalid 的回归判据", () => {
    const environment = remoteDescriptorsOf(TerminalEndpoint).descriptors.find(
      (descriptor) => descriptor.method === "environment",
    );
    expect(environment?.parameters.map((parameter) => parameter.name)).toEqual(["agentId"]);
  });
});