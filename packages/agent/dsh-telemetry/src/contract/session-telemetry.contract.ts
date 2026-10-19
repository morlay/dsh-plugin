// 会话遥测契约：令牌按服务语义命名（上游注册名 `sessionTelemetry`）。
import type OpenTelemetrySessionBackend from "@deepseek-ai/dsh-session-telemetry-otel";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `OpenTelemetrySessionBackend`（`SessionTelemetryBackend` 的 OTel 实现）的
 * **全部**公开成员。
 *
 * 上游按名字取用 `ctx.sessionTelemetry.<member>`。`SessionTelemetry` 之前是空令牌（只有名字、没有面）：
 * 上游是真类，消费方按成员取用，空面等于「谁用谁崩」。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionTelemetryCovered = AssertTrue<
  AssertCovered<OpenTelemetrySessionBackend, SessionTelemetry>
>;

@Injectable()
export abstract class SessionTelemetry {
  abstract readonly emit: OpenTelemetrySessionBackend["emit"];

  abstract readonly flush: OpenTelemetrySessionBackend["flush"];

  abstract readonly sharing: OpenTelemetrySessionBackend["sharing"];

  abstract readonly shutdown: OpenTelemetrySessionBackend["shutdown"];
}

