// `llm` 组的宿主实现：转发到本域的 `Llm` 服务（上游 `LlmRuntime` 的 `fromCordis` 行）。
//
// 组名与方法名只出现在装饰器上（`registerRemoteGroup` 按 `${group}/${method}` 拼 endpoint），
// `server/` 里不写 endpoint 字符串。参数形状来自 `endpoint/llm-endpoint.ts`。
import { RemoteHandlers } from "@morlay/zephyr-app";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import {
  RemoteGroup,
  RemoteMethod,
  registerRemoteGroup,
} from "@morlay/zephyr-app/remote";

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

  /** 全部已注册适配器的路由元数据（裸值；失败是异常）。 */
  @RemoteMethod({ parameters: [] })
  async listProviders(): Promise<LlmListProvidersValue> {
    return this.llm.listProviders();
  }

  /** 可在设置页配置的 provider 目录（含各自的设置命名空间）。 */
  @RemoteMethod({ parameters: [] })
  async listConfigurableProviders(): Promise<LlmListConfigurableProvidersValue> {
    return this.llm.listConfigurableProviders();
  }

  /**
   * 为一个设置命名空间发现模型。
   *
   * wire 是**两个位置形参**（`settingsNs` / `request`，见上游 `llm/lib/typert.host.ts:49`）——曾经这里
   * 收一个对象且没声明 `parameters`，descriptor 编出 `{ request }`，网关按上游 descriptor 校验必炸
   * （与 `commands/execute` / `terminal/environment` 同一类）。
   *
   * 逐字段判据（上游请求体字段全可选）：只把「确实是字符串」的字段交给上游；`settingsNs` 必须非空字符串、
   * `request` 必须是非 null 对象，否则 `gateway/bad-request`。
   * @param settingsNs - 设置命名空间（wire 名 `settingsNs`）。
   * @param request - 发现请求体（wire 名 `request`）。
   * @returns 发现到的模型列表。
   */
  @RemoteMethod({ parameters: ["settingsNs", "request"] })
  async discoverModels(
    settingsNs: string,
    request: LlmDiscoverModelsRequest["request"],
  ): Promise<LlmDiscoverModelsValue> {
    // wire 的形状由网关按 descriptor 校验（strict codec）；到这里就是上游那份请求类型，直接转发。
    return this.llm.discoverModels(settingsNs, request);
  }
}
