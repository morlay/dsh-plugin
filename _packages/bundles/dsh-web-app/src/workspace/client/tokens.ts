import type { UiWorkspace as UiWorkspaceFace } from "@deepseek-ai/dsh-client-ui-workspace/client";
import { InjectionToken } from "@morlay/zephyr";

export const UiWorkspace = new InjectionToken<UiWorkspaceFace>("uiWorkspace", {
  host: "@deepseek-ai/dsh-client-ui-workspace",
});
