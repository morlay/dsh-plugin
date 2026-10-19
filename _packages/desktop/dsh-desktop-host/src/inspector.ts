// 桌面档的后端调试端点：host 运行时开关 Node 自己的 inspector，只监听回环。
// 与 `DSH_DESKTOP_HOST_INSPECT_PORT` 那条启动参数用的是同一套机制，区别是这条不需要重启进程。

import inspector from "node:inspector";
import type { DesktopHostCommand, DesktopHostEvent } from "./wire.ts";

type InspectorEvent = Extract<DesktopHostEvent, { type: "inspected" }>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 打开回环上的 Node inspector，返回它的 WebSocket 端点（`port` 为 0 时用随机端口）。 */
export function openInspectorEndpoint(port: number): string {
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`dsh desktop: inspector port ${String(port)} is out of range`);
  // 已经有端点就复用它：dev 形态的 `--inspect=127.0.0.1:<port>` 启动参数已经占着一个，
  // 关掉再开只会把那个端口换成新的。
  const existing = inspector.url();
  if (existing !== undefined) return existing;
  inspector.open(port, "127.0.0.1");
  const url = inspector.url();
  if (url === undefined) throw new Error("dsh desktop: the inspector endpoint did not open");
  return url;
}

/** 关掉调试端点；没开时什么都不做。 */
export function closeInspectorEndpoint(): void {
  inspector.close();
}

/** 处理一条调试端点命令，返回要回报给壳的事件；不是调试命令时返回 undefined。 */
export function applyInspectorCommand(command: DesktopHostCommand): InspectorEvent | undefined {
  if (command.type === "inspect-off") {
    closeInspectorEndpoint();
    return { type: "inspected", url: null };
  }
  if (command.type !== "inspect") return undefined;
  try {
    return { type: "inspected", url: openInspectorEndpoint(command.port) };
  } catch (error) {
    return { type: "inspected", url: null, message: errorText(error) };
  }
}
