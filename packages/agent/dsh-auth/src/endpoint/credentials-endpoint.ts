// `credentials` 这一组的跨端契约（与上游 descriptor 同形）。
//
// 上游真源：`vendor/deepseek-harness/packages/api/settings-controller/src/credentials.ts:70`
// （`CredentialsController`，namespace `credentials`；`describe(refs)` / `set(ref, value)` / `unset(ref)`）。
// 浏览器侧调用：`ui-settings-models` 的 store（describe/set/unset）与 `ui-settings-web-search`。
import { CredentialInfo } from "@deepseek-ai/dsh-credentials";
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/** wire 端点名。 */
export const CREDENTIALS_DESCRIBE_ENDPOINT = "credentials/describe";

/** wire 端点名。 */
export const CREDENTIALS_SET_ENDPOINT = "credentials/set";

/** wire 端点名。 */
export const CREDENTIALS_UNSET_ENDPOINT = "credentials/unset";

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
  async describe(_request: CredentialsDescribeRequest): Promise<RemoteResultWire<Record<string, CredentialInfo>>> {
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
