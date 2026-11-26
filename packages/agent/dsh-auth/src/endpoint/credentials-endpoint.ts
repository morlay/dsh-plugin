// `credentials` 这一组的跨端契约：组名、方法名，与 wire 的形参 / 应答类型。
//
// 上游真源：`vendor/deepseek-harness/packages/api/settings-controller/src/credentials.ts:71`
// （`CredentialsController`，namespace `credentials`）：`describe(refs)` / `set(ref, value)` / `unset(ref)`，
// **位置形参、裸值**（`RemoteResult` 是客户端面 `faceOf` 的包装，不进契约）。
//
// 本组的宿主实现是**我们自己的**（`server/credentials-endpoint.service.ts`）：它接上游 `CredentialProvider`，
// 补上 wire 那三条义务（批量扇出上限、字段投影、引用名语法）。
//
// 浏览器侧的 `remote.credentials` 面由上游那份 remote 挂（`dsh-setting` 的 `remoteDescriptor`），所以
// 上游消费方（`ui-settings-models` / `ui-settings-web-search`）读到的就是上游的 wire 形状——我们的宿主
// 必须按同一形状收参数、回**裸值**，否则会被包第二层（`{ok,value:{ok,value}}`）。
import type { CredentialInfo } from "@deepseek-ai/dsh-credentials/types";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn } from "@morlay/zephyr-app/typert";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";
// 上游宿主类从**包根**取（它在包根的导出里；`import type` 运行期零边，浏览器半安全）。
import type { CredentialsController as CredentialsControllerHost } from "@deepseek-ai/dsh-api-settings-controller";

/**
 * 组名（`credentials`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function credentialsGroupName(): string {
  return groupNameOf(CredentialsEndpoint);
}

/** `credentials` 组：批量读引用视图、写一个、删一个（任何方法都不回传密钥值）。 */
@RemoteGroup({ name: "credentials" })
export class CredentialsEndpoint {
  /**
   * 批量描述若干引用（一次调用把设置页每行的状态取齐）。
   * @param _refs - 引用名列表（wire 名 `refs`）。
   * @returns 按引用名归并的视图。
   */
  @RemoteMethod({ parameters: ["refs"] })
  async describe(_refs: string[]): Promise<Record<string, CredentialInfo>> {
    throw new Error("credentials/describe：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 存一个引用值（只写不读）。
   * @param _ref - 引用名（wire 名 `ref`）。
   * @param _value - 非空密钥值（wire 名 `value`）。
   */
  @RemoteMethod({ parameters: ["ref", "value"] })
  async set(_ref: string, _value: string): Promise<void> {
    throw new Error("credentials/set：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 删除一个引用。
   * @param _ref - 引用名（wire 名 `ref`）。
   */
  @RemoteMethod({ parameters: ["ref"] })
  async unset(_ref: string): Promise<void> {
    throw new Error("credentials/unset：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * 覆盖守卫：契约对上**宿主类** `CredentialsController` 的 wire 面。
 *
 * 本组没有 `signal`（三个方法都没有取消参数）也没有 lookup 形参，所以投影只有一步 `AsyncReturn`
 * （`set` / `unset` 回 `Promise<void>`，`describe` 回 `Promise<Record<…>>`）。
 */
export type CredentialsEndpointCovered = AssertTrue<
  AssertWireFace<
    Pick<AsyncReturn<CredentialsControllerHost>, "describe" | "set" | "unset">,
    CredentialsEndpoint
  >
>;
