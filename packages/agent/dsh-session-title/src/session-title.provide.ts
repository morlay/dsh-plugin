import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { SessionTitleDefault } from "./session-title.service.ts";

const providers = (): ProviderList => [configure(SessionTitleDefault, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })([SessionTitleDefault])];

export const provideSessionTitle = provide(providers());
