import { provide } from "@morlay/zephyr";
import { SubagentsEndpointDefault } from "./subagents-endpoint.ts";
import { provideSubagent } from "../subagent.provide.ts";

/** **wire 子代理**：headless 那几行 + `remote.subagents` 的两条端点。 */
export const provideSubagentEndpoints = provide([...provideSubagent(), SubagentsEndpointDefault]);
