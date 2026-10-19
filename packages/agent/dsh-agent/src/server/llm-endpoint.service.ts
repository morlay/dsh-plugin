// `llm` 组的宿主实现：转发到本域的 `Llm` 服务（上游 `LlmRuntime` 的 `fromCordis` 行）。
//
// 组名与方法名只出现在装饰器上（`registerRemoteGroup` 按 `${group}/${method}` 拼 endpoint），
// `server/` 里不写 endpoint 字符串。参数形状来自 `endpoint/llm-endpoint.ts`。
import { RemoteHandlers } from "@morlay/zephyr-app";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteGroup, RemoteMethod, asRemoteResult, registerRemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { Llm } from "../contract/llm.contract.ts";
import type {
  LlmDiscoverModelsRequest,
  LlmDiscoverModelsValue,
  LlmListConfigurableProvidersValue,
  LlmListProvidersValue,
} from "../endpoint/llm-endpoint.ts";

/** `llm` 组的宿主实现。 */
@RemoteGroup({ name: "llm" })
@Injectable()
export class LlmEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly llm = inject(Llm);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  /** 全部已注册适配器的路由元数据。 */
  @RemoteMethod()
  listProviders(): Promise<RemoteResultWire<LlmListProvidersValue>> {
    return asRemoteResult(async () => this.llm.listProviders());
  }

  /** 可在设置页配置的 provider 目录（含各自的设置命名空间）。 */
  @RemoteMethod()
  listConfigurableProviders(): Promise<RemoteResultWire<LlmListConfigurableProvidersValue>> {
    return asRemoteResult(async () => this.llm.listConfigurableProviders());
  }

  /**
   * 为一个设置命名空间发现模型。
   *
   * 逐字段判据（上游请求体字段全可选）：只把「确实是字符串」的字段交给上游；
   * `settingsNs` 必须非空字符串、`request` 必须是非 null 对象，否则 `gateway/arguments-invalid`。
   * @param input - wire 实参（整个 args 当一个对象）。
   * @returns 发现到的模型列表。
   */
  @RemoteMethod()
  async discoverModels(
    input: LlmDiscoverModelsRequest,
  ): Promise<RemoteResultWire<LlmDiscoverModelsValue>> {
    return asRemoteResult(async () => {
      const settingsNs = input?.settingsNs;
      if (typeof settingsNs !== "string" || settingsNs.length === 0) {
        throw new RemoteError("gateway/arguments-invalid", "llm/discoverModels 需要字符串 settingsNs", {
          endpoint: "llm/discoverModels",
          field: "settingsNs",
        });
      }
      const raw = input?.request;
      if (typeof raw !== "object" || raw === null) {
        throw new RemoteError("gateway/arguments-invalid", "llm/discoverModels 需要对象 request", {
          endpoint: "llm/discoverModels",
          field: "request",
        });
      }
      const source = raw as Readonly<Record<string, unknown>>;
      const request: { -readonly [K in keyof typeof source]: unknown } = {};
      for (const key of ["provider", "baseURL", "api", "apiKey"] as const) {
        const value = source[key];
        if (typeof value === "string") request[key] = value;
      }
      return this.llm.discoverModels(settingsNs, request);
    });
  }
}
