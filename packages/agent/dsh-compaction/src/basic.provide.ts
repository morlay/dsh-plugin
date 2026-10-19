import { provide, type ProviderList } from "@morlay/zephyr";
import { CompactionBasic } from "./basic.service.ts";

const providers = (): ProviderList => [CompactionBasic];

export const provideCompactionBasic = provide(providers());
