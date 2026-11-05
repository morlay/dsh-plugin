import { provide } from "@morlay/zephyr";
import { SessionCheckpointPolicy } from "../checkpoint-policy.service.ts";

export const provideSessionCheckpointPolicy = provide([SessionCheckpointPolicy]);
