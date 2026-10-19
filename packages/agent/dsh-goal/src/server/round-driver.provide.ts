import { provide, type ProviderList } from "@morlay/zephyr";
import { GoalRoundDriver } from "../round-driver.service.ts";

const providers = (): ProviderList => [GoalRoundDriver];

export const provideGoalRoundDriver = provide(providers());
