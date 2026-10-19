import { provide, type ProviderList } from "@morlay/zephyr";
import { CommandFeedback } from "./command.service.ts";

const providers = (): ProviderList => [CommandFeedback];

export const provideCommandFeedback = provide(providers());
