// `job` 这一组的**跨端契约**：组名、组内方法名、请求/响应形状，以及 wire 上的端点名。
//
// 两端共用同一份声明：宿主侧继承它并实现方法（`server/`）；浏览器侧用 `@RemoteClient()` 生成转发（当前没有远端端点消费它）。
// **只在这里声明形状**：不 import 任何 `@deepseek-ai/*`（那是宿主半的实现依赖，浏览器侧会把宿主拖进打包图）。
// 形状照上游 `api/job-controller/src/types.ts` 抄（那份 wire 类型本身就是 client-safe 的）。
//
// **它不继承 `RemoteClientBase`**：那个基类带 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import type { JobController as JobControllerHost } from "@deepseek-ai/dsh-api-job-controller";

/** 组名（上游 descriptor：`namespace: 'job'`）。 */

/** wire 上的端点名（上游 descriptor 的 `namespace/method`）。 */

import type {
  JobFollowFrame,
  JobFollowRequest,
  JobKillRequest,
  JobKillValue,
  JobListFrame,
  JobListRequest,
} from "@deepseek-ai/dsh-api-job-controller/types";
// 类型**全部取上游**（`@deepseek-ai/dsh-api-job-controller/types`，wire 安全的 view 类型由它转出）：
// 手抄过一次（`JobViewWire` / `JobChunkWire` / 四个帧），只会多一份会漂的声明。
export type {
  JobChunk as JobChunkWire,
  JobFollowFrame,
  JobFollowRequest,
  JobKillRequest,
  JobKillValue,
  JobListFrame,
  JobListRequest,
  JobView as JobViewWire,
} from "@deepseek-ai/dsh-api-job-controller/types";

/** `job` 组：花名册流、单任务输出流、人工取消。 */
@RemoteGroup({ name: "job" })
export class JobEndpoint {
  /**
   * 镜像一个会话能看见的任务花名册（流，整份替换）。
   * @param _request - 目标会话。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的花名册。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  list(_request: JobListRequest, _signal: AbortSignal): AsyncIterable<JobListFrame> {
    throw new Error("job/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 从某个字节偏移开始观察一条任务的保留输出（流）。
   * @param _request - 任务、会话与可选续读偏移。
   * @param _signal - wire 的取消信号。
   * @returns 逐帧的输出与终态。
   */
  @RemoteMethod({ mode: "stream", parameters: ["request"] })
  follow(_request: JobFollowRequest, _signal: AbortSignal): AsyncIterable<JobFollowFrame> {
    throw new Error("job/follow：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 人工取消一条任务。
   * @param _request - 会话与任务。
   * @returns 注册表的受理结果。
   */
  @RemoteMethod({ parameters: ["request"] })
  async kill(_request: JobKillRequest): Promise<JobKillValue> {
    throw new Error("job/kill：契约类未实现（宿主侧要在子类里实现它）");
  }
}
/**
 * 覆盖守卫：契约对上**宿主类** `JobController` 的 wire 面（形参与返回**双向**，见 `AssertWireFace`）。
 *
 * 两条判据分开：unary（`kill`）一条；流式（`list` / `follow`）一条，**两侧各摘一次取消信号**
 * （契约方法带 `signal` 是宿主侧取消通道，wire 上没有它）。
 */
type JobWire = AsyncReturn<DropParam<JobControllerHost, AbortSignal>>;

export type JobEndpointCovered = AssertTrue<
  AssertWireFace<Pick<JobWire, "kill">, Pick<JobEndpoint, "kill">>
>;

export type JobEndpointStreamCovered = AssertTrue<
  AssertWireFace<
    Pick<JobWire, "list" | "follow">,
    Pick<DropParam<JobEndpoint, AbortSignal>, "list" | "follow">
  >
>;