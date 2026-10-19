// 会话遥测契约：令牌按服务语义命名（上游注册名 `sessionTelemetry`）。
import { Injectable } from "@morlay/zephyr";

interface SessionTelemetryFace {}

@Injectable()
export abstract class SessionTelemetry implements SessionTelemetryFace {}
