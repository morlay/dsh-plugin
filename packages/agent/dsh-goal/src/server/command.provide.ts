import { provide, type ProviderList } from "@morlay/zephyr";
import { CommandGoal } from "../command.service.ts";

const providers = (): ProviderList => [CommandGoal];

export const provideCommandGoal = provide(providers());
