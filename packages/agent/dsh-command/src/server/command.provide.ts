import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { CommandEndpointDefault } from "./command-endpoint.service.ts";
import { CommandRegistryDefault } from "../command-registry.service.ts";

export const provideCommand = provide([
  CommandRegistryDefault,
  CommandEndpointDefault,
  remoteDescriptor(() => import("@deepseek-ai/dsh-commands/remote")),
]);
