import { provide, type ProviderList } from "@morlay/zephyr";
import { CommandCompact } from "./command.service.ts";

const providers = (): ProviderList => [CommandCompact];

export const provideCommandCompact = provide(providers());
