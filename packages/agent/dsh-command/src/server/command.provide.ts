import { provide, type ProviderList } from "@morlay/zephyr";
import { CommandEndpointDefault } from "@morlay/dsh-command/server";
import { CommandRegistryDefault } from "../command-registry.service.ts";

const providers = (): ProviderList => [CommandRegistryDefault, CommandEndpointDefault];

export const provideCommand = provide(providers());
