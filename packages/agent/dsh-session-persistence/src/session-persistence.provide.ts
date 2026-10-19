import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionPersistenceDefault } from "./session-persistence.service.ts";

const providers = (): ProviderList => [SessionPersistenceDefault];

export const provideSessionPersistence = provide(providers());
