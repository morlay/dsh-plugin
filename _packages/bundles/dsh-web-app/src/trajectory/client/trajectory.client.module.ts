import { Module } from "@morlay/zephyr";
import { UiTrajectory } from "./trajectory.client.service.ts";

@Module({ providers: [UiTrajectory] })
export class TrajectoryClientModule {}
