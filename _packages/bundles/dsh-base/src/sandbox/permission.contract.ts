// 权限预设契约：令牌按服务语义命名（上游注册名 `permission`）。
import type PermissionPresetService from "@deepseek-ai/dsh-permission-presets";
import { Injectable } from "@morlay/zephyr";

interface PermissionFace {
  readonly catalog: PermissionPresetService["catalog"];
  readonly current: PermissionPresetService["current"];
  readonly resolve: PermissionPresetService["resolve"];
  readonly optionOf: PermissionPresetService["optionOf"];
}

@Injectable()
export abstract class Permission implements PermissionFace {
  abstract readonly catalog: PermissionFace["catalog"];

  abstract readonly current: PermissionFace["current"];

  abstract readonly resolve: PermissionFace["resolve"];

  abstract readonly optionOf: PermissionFace["optionOf"];
}
