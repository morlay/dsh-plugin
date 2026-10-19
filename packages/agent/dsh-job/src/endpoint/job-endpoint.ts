// `job` 这一组的**跨端契约**：组名、组内方法名、请求/响应形状，以及 wire 上的端点名。
//
// 两端共用同一份声明：宿主侧继承它并实现方法（`server/`），浏览器侧将来用 `@RemoteClient()` 生成转发。
// **只在这里声明形状**：不 import 任何 `@deepseek-ai/*`（那是宿主半的实现依赖，浏览器侧会把宿主拖进打包图）。
// 形状照上游 `api/job-controller/src/types.ts` 抄（那份 wire 类型本身就是 client-safe 的）。
//
// **它不继承 `RemoteClientBase`**：那个基类带 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";

/** 组名（上游 descriptor：`namespace: 'job'`）。 */
export const JOB_GROUP = "job";

/** wire 上的端点名（上游 descriptor 的 `namespace/method`）。 */
export const JOB_LIST_ENDPOINT = "job/list";
export const JOB_FOLLOW_ENDPOINT = "job/follow";
export const JOB_KILL_ENDPOINT = "job/kill";

/** 一条后台任务的投影（上游 `JobView`）。 */
export interface JobViewWire {
  /** 注册表发的 id（`<kind>-<short-uuid>`）。 */
  readonly id: string;
  /** 生产方注册时的种类（宿主侧的 `JobKind`，wire 上开放成字符串）。 */
  readonly kind: string;
  readonly label: string;
  /** 所属会话；无主任务没有这个字段（任何调用方都看得见）。 */
  readonly owner?: string;
  readonly outputLimitBytes?: number;
  readonly status: string;
  readonly progress?: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly output: {
    readonly total: number;
    readonly earliest: number;
    readonly spillPaths?: readonly string[];
  };
}

/** `job/list` 的请求：镜像哪个会话能看见的那份花名册。 */
export interface JobListRequest {
  readonly sessionId: string;
}

/** `job/list` 的一帧：整份替换（重连后的首帧就是真值）。 */
export interface JobListFrame {
  readonly type: "rows";
  readonly jobs: readonly JobViewWire[];
}

/** `job/follow` 的请求：目标任务、所属会话与可选的续读偏移。 */
export interface JobFollowRequest {
  /** 围栏读的所属会话；无主任务省略。 */
  readonly sessionId?: string;
  readonly jobId: string;
  /** 续读的绝对字节偏移（上一帧的 `next`）；省略从最老保留字节开始。 */
  readonly from?: number;
}

/** 一段保留输出（上游 `JobChunk`）：写入时刻、文本，以及通道与「前面有洞」的标记。 */
export interface JobChunkWire {
  readonly at: number;
  readonly text: string;
  readonly channel?: string;
  /** 这一批之前有字节已被回收（读到的不是连续流）。 */
  readonly gapBefore?: true;
}

/** `job/follow` 的帧：`opened` 锚点 → 若干 `output` 批 → 一条终态 `status`。 */
export type JobFollowFrame =
  | { readonly type: "opened"; readonly job: JobViewWire; readonly from: number }
  | {
      readonly type: "output";
      readonly chunks: readonly JobChunkWire[];
      readonly next: number;
      readonly lossy?: true;
    }
  | { readonly type: "status"; readonly job: JobViewWire };

/** `job/kill` 的请求：会话与任务。 */
export interface JobKillRequest {
  readonly sessionId: string;
  readonly jobId: string;
}

/** `job/kill` 的回执：注册表是否受理了这次人工取消。 */
export interface JobKillValue {
  readonly outcome: "requested" | "already-finished";
}

/** `job` 组：花名册流、单任务输出流、人工取消。 */
@RemoteGroup({ name: JOB_GROUP })
export class JobEndpoint {
  /**
   * 镜像一个会话能看见的任务花名册（流，整份替换）。
   * @param _request - 目标会话。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的花名册。
   */
  @RemoteMethod({ mode: "stream" })
  list(_request: JobListRequest, _signal: AbortSignal): AsyncIterable<JobListFrame> {
    throw new Error("job/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 从某个字节偏移开始观察一条任务的保留输出（流）。
   * @param _request - 任务、会话与可选续读偏移。
   * @param _signal - wire 的取消信号。
   * @returns 逐帧的输出与终态。
   */
  @RemoteMethod({ mode: "stream" })
  follow(_request: JobFollowRequest, _signal: AbortSignal): AsyncIterable<JobFollowFrame> {
    throw new Error("job/follow：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 人工取消一条任务。
   * @param _request - 会话与任务。
   * @returns 注册表的受理结果。
   */
  @RemoteMethod()
  async kill(_request: JobKillRequest): Promise<RemoteResultWire<JobKillValue>> {
    throw new Error("job/kill：契约类未实现（宿主侧要在子类里实现它）");
  }
}
