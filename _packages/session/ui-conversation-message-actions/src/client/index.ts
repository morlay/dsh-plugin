import { toCordis } from "@morlay/zephyr/compat";
import { MessageActions } from "./zephyr.service.ts";

export { MessageActions } from "./zephyr.service.ts";

// 编辑器动作的路径表是两个面共用的协议常量，client 面照旧从这里转出（见 `../shared.ts`）。
export { SESSION_EDITOR_PATHS } from "../shared.ts";

export default toCordis(MessageActions);
