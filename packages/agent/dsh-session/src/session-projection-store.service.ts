import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";

@Injectable()
export class SessionProjectionStoreDefault extends fromCordis(SessionProjectionStore, SessionProjectionRegistry) {}
