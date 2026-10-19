import { toCordis } from "@morlay/zephyr/compat";
import { SessionEditorModule } from "./index.ts";

// dsh 行入口：会话编辑的 HTTP 面 + client 槽位注册都挂在同一行。
export const sessionEditorRow = toCordis(SessionEditorModule);

export default sessionEditorRow;
