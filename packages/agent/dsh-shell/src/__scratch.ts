import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";

export function cast(face: Record<string, unknown> | undefined): TerminalRemote | undefined {
  return face as TerminalRemote | undefined;
}
