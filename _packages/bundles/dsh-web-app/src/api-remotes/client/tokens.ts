import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
import { InjectionToken } from "@morlay/zephyr";

export const Remote = new InjectionToken<ClientRemote>("remote", {
  host: "@deepseek-ai/dsh-api-gateway",
});
