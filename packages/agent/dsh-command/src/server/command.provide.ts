import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { CommandEndpointDefault } from "@morlay/dsh-command/server";
import { CommandRegistryDefault } from "../command-registry.service.ts";

export const provideCommand = provide([
  CommandRegistryDefault,
  CommandEndpointDefault,
  remoteDescriptor(() => import("@deepseek-ai/dsh-commands/remote")),
]);
