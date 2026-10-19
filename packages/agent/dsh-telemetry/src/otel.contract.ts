// OpenTelemetry 聚合面契约：令牌按服务语义命名（上游注册名 `otel`）。
import { Injectable } from "@morlay/zephyr";

interface OtelFace {}

@Injectable()
export abstract class Otel implements OtelFace {}
