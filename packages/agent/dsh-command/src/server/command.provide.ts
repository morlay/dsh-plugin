import { provide } from "@morlay/zephyr";
import { CommandEndpointDefault } from "@morlay/dsh-command/server";
import { CommandRegistryDefault } from "../command-registry.service.ts";

export const provideCommand = provide([CommandRegistryDefault, CommandEndpointDefault]);
