// `credentials` 这一组的跨端契约（与上游 descriptor 同形）。
//
// 上游真源：`vendor/deepseek-harness/packages/api/settings-controller/src/credentials.ts:70`
// （`CredentialsController`，namespace `credentials`；`describe(refs)` / `set(ref, value)` / `unset(ref)`）。
// 浏览器侧调用：`ui-settings-models` 的 store（describe/set/unset）与 `ui-settings-web-search`。
// 只取类型：走上游的 `types` 子路径 + `import type`（值导入会给端点面收一条到宿主根的边，
// 而 `./endpoint` 被浏览器半引用，必须 client-safe）。
import type { CredentialInfo } from "@deepseek-ai/dsh-credentials/types";
import {
  RemoteGroup,
  RemoteMethod,
  remoteGroupNameOf,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";

/**
 * 组名（`credentials`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function credentialsGroupName(): string {
  const group = remoteGroupNameOf(CredentialsEndpoint);
  if (group === undefined) throw new Error("CredentialsEndpoint 没有 @RemoteGroup：组名取不到");
  return group;
}

/** wire 端点名。 */

/** wire 端点名。 */

/** wire 端点名。 */

/** `credentials/describe` 的命名参数（descriptor 的参数名是 `refs`）。 */
export interface CredentialsDescribeRequest {
  readonly refs: readonly string[];
}

/** `credentials/set` 的命名参数。 */
export interface CredentialsSetRequest {
  readonly ref: string;
  readonly value: string;
}

/** `credentials/unset` 的命名参数。 */
export interface CredentialsUnsetRequest {
  readonly ref: string;
}

/** `credentials` 组：批量读引用视图、写一个、删一个（任何方法都不回传密钥值）。 */
@RemoteGroup({ name: "credentials" })
export class CredentialsEndpoint {
  /**
   * 批量描述若干引用（一次调用把设置页每行的状态取齐）。
   * @param request - 引用名列表。
   * @returns 按引用名归并的视图。
   */
  @RemoteMethod()
  async describe(
    _request: CredentialsDescribeRequest,
  ): Promise<RemoteResultWire<Record<string, CredentialInfo>>> {
    throw new Error("credentials/describe：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 存一个引用值（只写不读）。
   * @param request - 引用名与非空值。
   */
  @RemoteMethod()
  async set(_request: CredentialsSetRequest): Promise<RemoteResultWire<void>> {
    throw new Error("credentials/set：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 删除一个引用。
   * @param request - 引用名。
   */
  @RemoteMethod()
  async unset(_request: CredentialsUnsetRequest): Promise<RemoteResultWire<void>> {
    throw new Error("credentials/unset：契约类未实现（宿主侧要在子类里实现它）");
  }
}
