import { toCordis } from "@morlay/zephyr/compat";
import { ConversationManager } from "./zephyr.service.ts";
import type { ConversationManagerKey } from "./locales.ts";

export type { ConversationManagerFace, ConversationManagerPorts } from "./controller.ts";
export { ConversationManagerController, ConversationManagerRequestError } from "./controller.ts";
export type { ConversationManagerIconProps } from "./ConversationManagerIcon.tsx";
export type { ConversationManagerPageProps } from "./ConversationManagerPage.tsx";
export type { ConversationManagerKey } from "./locales.ts";
export { ConversationManager, NS, PANEL_ID, PANEL_ORDER } from "./zephyr.service.ts";

export default toCordis(ConversationManager);
