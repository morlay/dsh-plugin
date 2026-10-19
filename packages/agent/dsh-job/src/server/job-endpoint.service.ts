// `job` 这一组的**宿主实现**：继承 `endpoint/` 的契约类，转发到上游 `JobController`
// （`list` / `follow` 是流、`kill` 是 unary）。
//
// 组名从契约类继承（`@RemoteGroup()` 不写名字），端点名只有一个 home：`endpoint/job-endpoint.ts`。
// 上游实例由 `JobControllerRow`（适配行）提供：`fromCordis(...)` 与 `extends JobEndpoint` 都是继承，
// 只能二选一，所以拆成两行（见那一行的注释）。
import type {
  JobFollowRequest as UpstreamFollowRequest,
  JobKillRequest as UpstreamKillRequest,
  JobListRequest as UpstreamListRequest,
} from "@deepseek-ai/dsh-api-job-controller";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { asRemoteResult } from "@morlay/zephyr-app";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import { JobControllerRow } from "../job-controller.row.ts";
import {
  JobEndpoint,
  type JobFollowFrame,
  type JobFollowRequest,
  type JobKillRequest,
  type JobKillValue,
  type JobListFrame,
  type JobListRequest,
} from "../endpoint/job-endpoint.ts";

/** `job` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class JobEndpointDefault extends JobEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 `JobController` 的适配行：它的发布面就是那个实例（`list` / `follow` / `kill`）。 */
  private readonly controller = inject(JobControllerRow);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override list(request: JobListRequest, signal: AbortSignal): AsyncIterable<JobListFrame> {
    // wire 上是裸字符串，上游要品牌会话身份：在边界铸一次。
    return this.controller.list(
      { sessionId: SessionId(request.sessionId) } as UpstreamListRequest,
      signal,
    );
  }

  override follow(request: JobFollowRequest, signal: AbortSignal): AsyncIterable<JobFollowFrame> {
    const upstream = {
      jobId: request.jobId,
      ...(request.sessionId === undefined ? {} : { sessionId: SessionId(request.sessionId) }),
      ...(request.from === undefined ? {} : { from: request.from }),
    } as UpstreamFollowRequest;
    return this.controller.follow(upstream, signal);
  }

  override async kill(request: JobKillRequest): Promise<RemoteResultWire<JobKillValue>> {
    return await asRemoteResult(async () =>
      this.controller.kill({
        sessionId: SessionId(request.sessionId),
        jobId: request.jobId,
      } as UpstreamKillRequest),
    );
  }
}
