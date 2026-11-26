// `permissionPresets` 这一组的跨端契约：权限面板读的预设目录、写一次预设。
//
// 上游真源：`vendor/deepseek-harness/packages/interaction/permission-presets/src/index.ts:182`
// （`PermissionPresetService`，namespace `permissionPresets`）：`catalog(): PermissionCatalog`（**同步裸值**）、
// `setPreset(request): PermissionSelection`。wire 名见它的 `lib/typert.host.ts`（`catalog` 无形参、`setPreset` 收 `request`）。
//
// 应答是**裸值**：`RemoteResult` 由桥与客户端面各包一层，宿主不再包。类型从上游派生（不手抄）。
import type { PermissionCatalog, PermissionPresetService as PermissionPresetsHost } from "@deepseek-ai/dsh-permission-presets";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn } from "@morlay/zephyr-app/typert";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";

/** `permissionPresets/setPreset` 的请求（上游 `setPreset` 的第一个形参）。 */
export type PermissionPresetsSetRequest = Parameters<PermissionPresetsHost["setPreset"]>[0];

/** `permissionPresets/setPreset` 的应答（上游 `setPreset` 的返回）。 */
export type PermissionPresetsSetValue = ReturnType<PermissionPresetsHost["setPreset"]>;

/**
 * 组名（`permissionPresets`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function permissionPresetsGroupName(): string {
  return groupNameOf(PermissionPresetsEndpoint);
}

/** `permissionPresets` 组：预设目录与写一次预设。 */
@RemoteGroup({ name: "permissionPresets" })
export class PermissionPresetsEndpoint {
  /**
   * 读当前可选的全部预设（贡献顺序）。
   * @returns 目录（上游 `PermissionCatalog`；失败是异常）。
   */
  @RemoteMethod({ parameters: [] })
  async catalog(): Promise<PermissionCatalog> {
    throw new Error("permissionPresets/catalog：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 设一个预设（wire 名 `setPreset`，形参名 `request`）。
   * @param _request - 目标会话与预设名。
   * @returns 结算后的选择。
   */
  @RemoteMethod({ parameters: ["request"] })
  async setPreset(_request: PermissionPresetsSetRequest): Promise<PermissionPresetsSetValue> {
    throw new Error("permissionPresets/setPreset：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * 覆盖守卫：契约对上**宿主类** `PermissionPresetService` 的 wire 面（形参与返回双向）。
 * 本组无 `signal`、无 lookup 形参，投影只有 `AsyncReturn`（`catalog` 同步返回也要提升成 Promise）。
 */
type PermissionPresetsWire = AsyncReturn<PermissionPresetsHost>;

export type PermissionPresetsEndpointCovered = AssertTrue<
  AssertWireFace<Pick<PermissionPresetsWire, "catalog" | "setPreset">, PermissionPresetsEndpoint>
>;
