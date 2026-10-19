// `permissionPresets` 组的**宿主侧实现**：转发到上游 `PermissionPresetService.catalog()`。
import { PermissionCatalog } from "@deepseek-ai/dsh-permission-presets";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult, RemoteGroup, registerRemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import { Permission } from "../contract/permission.contract.ts";
import { PermissionPresetsEndpoint } from "../endpoint/permission-presets-endpoint.ts";

/** `permissionPresets` 组的宿主实现。 */
@RemoteGroup()
export class PermissionPresetsEndpointDefault extends PermissionPresetsEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly permission = inject(Permission);

  private stop = (): void => {};

  onInit(): void {
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async catalog(): Promise<RemoteResultWire<PermissionCatalog>> {
    return await asRemoteResult(async () => this.permission.catalog());
  }
}
