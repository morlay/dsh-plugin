import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionLogDeepseek } from "./session-log.service.ts";

const providers = (): ProviderList => [SessionLogDeepseek];

export const provideSessionLogDeepseek = provide(providers());
