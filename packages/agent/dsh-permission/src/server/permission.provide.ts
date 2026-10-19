import { configure, provide, type ProviderEntry } from "@morlay/zephyr";
import { PERMISSION_PRESETS, type PermissionMode } from "../permission-mode.ts";
import { ApprovalDefault } from "../approval.service.ts";
import { PermissionDefault } from "../permission.service.ts";
import { PermissionPresetsEndpointDefault } from "./permission-presets-endpoint.service.ts";
import { UserQuestionsEndpointDefault } from "./user-questions-endpoint.service.ts";
import { UserQuestionQueueDefault } from "../user-question-queue.service.ts";

/**
 * 权限域的五行。默认档位 `workspace-write`。
 *
 * 装配面要换档位：`providePermission(configure(ApprovalDefault, { policy }), configure(PermissionDefault, { defaultPreset: mode, presets: PERMISSION_PRESETS }))`。
 */
export const providePermission = provide([
  configure(ApprovalDefault, { policy: PERMISSION_PRESETS["workspace-write"].approval })([ApprovalDefault]),
  // 默认档位显式给：不靠「沙箱默认值 + 批准默认值」反推（两边默认值漂移时反推会得到另一个档位）。
  configure(PermissionDefault, { presets: PERMISSION_PRESETS, defaultPreset: "workspace-write" })([PermissionDefault]),
  // 用户提问的队列：`userQuestions/*` 两条远端端点转发到它。
  UserQuestionQueueDefault,
  // 浏览器侧（`ui-user-questions` / `ui-permission-presets`）按 descriptor 调的两组：
  // 没有这两个宿主实现，mux 会把调用报成「没有实现」。
  UserQuestionsEndpointDefault,
  PermissionPresetsEndpointDefault,
]);

/**
 * 按**档位**装配：一个档位同时写沙箱模式与批准策略两个开关（装配面只传 mode）。
 * @param mode - `read-only` / `workspace-write` / `danger-full-access`。
 * @returns provider 清单。
 */
export function providePermissionFor(mode: PermissionMode): ProviderEntry[] {
  return providePermission(
    configure(ApprovalDefault, { policy: PERMISSION_PRESETS[mode].approval }),
    configure(PermissionDefault, { presets: PERMISSION_PRESETS, defaultPreset: mode }),
  );
}
