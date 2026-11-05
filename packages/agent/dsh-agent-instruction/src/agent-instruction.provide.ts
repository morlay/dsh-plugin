import { provide } from "@morlay/zephyr";
import { AgentInstruction } from "./agent-instruction.service.ts";

export const provideAgentInstruction = provide([AgentInstruction]);
