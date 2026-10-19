import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import { InjectionToken } from "@morlay/zephyr";

export const Sessions = new InjectionToken<ISessions>("sessions", {
  host: "@deepseek-ai/dsh-api-session-controller",
});
