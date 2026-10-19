// 启动环境契约：宿主启动时注入的快照（平台、可用 shell、初始 cwd 等）。
// 消费方注入它，不直接碰 cordis 的槽位。
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class LaunchEnvironment {
  abstract readonly snapshot: LaunchEnvironmentSnapshot | undefined;
}
