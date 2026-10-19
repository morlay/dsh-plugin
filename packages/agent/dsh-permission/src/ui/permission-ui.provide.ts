import { provide } from "@morlay/zephyr";
import { UiPermission } from "./ui-permission.service.ts";

/** permission 的浏览器半：上游 UI 行（组件未导出，按转发方式挂载）。 */
export const providePermissionUi = provide([UiPermission]);
