import { provide } from "@morlay/zephyr";
import { FederationDefault } from "./federation.service.ts";

export const provideFederation = provide([FederationDefault]);
