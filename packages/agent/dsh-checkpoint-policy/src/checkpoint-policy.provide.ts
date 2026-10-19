import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionCheckpointPolicy } from "./checkpoint-policy.service.ts";

const providers = (): ProviderList => [SessionCheckpointPolicy];

export const provideSessionCheckpointPolicy = provide(providers());
