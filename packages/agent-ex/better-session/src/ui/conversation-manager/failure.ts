// 宿主错误码 → 可读文案的唯一映射：查询状态的失败横幅与动作提示都用这一份。
//
// 字典给四档文案，这里只认码、不认文案：没有码的失败保留原文并交给字典的兜底档。
import type { SessionStoreFailure } from "@morlay/better-session/endpoint";
import { ConversationManagerRequestError } from "./conversation-manager.controller.ts";
import type { ConversationManagerTranslate } from "./locales.ts";

// 失败文案的来源（字典里那几档）。
export interface FailureCopy {
  readonly notArchived: string;
  readonly live: string;
  // 跨实例位点冲突：这个会话在别处运行（该先停掉那边再重试）。
  readonly concurrent: string;
  readonly missing: string;
  readonly importLive: string;
  readonly importInvalidPackage: string;
  readonly importTooLarge: string;
  readonly other: (reason: string) => string;
}

// 从翻译座取出失败文案：调用方只构造一次（字典不变时这组文案也不变）。
export function failureCopy(t: ConversationManagerTranslate): FailureCopy {
  return {
    notArchived: t("failure.notArchived"),
    live: t("failure.live"),
    concurrent: t("failure.concurrent"),
    missing: t("failure.missing"),
    importLive: t("failure.importLive"),
    importInvalidPackage: t("failure.importInvalidPackage"),
    importTooLarge: t("failure.importTooLarge"),
    other: (reason) => t("failure.other", { reason }),
  };
}

// 一次失败的文案：有码按码分派，没有码保留原文。
export function failureText(error: unknown, copy: FailureCopy): string {
  const code = error instanceof ConversationManagerRequestError ? error.code : undefined;
  // 码是**域的稳定面**：断言成 `SessionStoreFailure` 之后，下面 case 里写错一个码就编译失败。
  // 以前这里是裸 `string`，拼错的 case 永远不会命中，只会静默落到兜底文案。
  switch (code as SessionStoreFailure | undefined) {
    case "SESSION_NOT_ARCHIVED":
      return copy.notArchived;
    case "SESSION_LIVE":
      return copy.live;
    case "SESSION_CONCURRENT_WRITER":
      return copy.concurrent;
    case "SESSION_NOT_FOUND":
      return copy.missing;
    case "SESSION_IMPORT_LIVE":
      return copy.importLive;
    case "SESSION_IMPORT_INVALID_PACKAGE":
      return copy.importInvalidPackage;
    case "SESSION_IMPORT_TOO_LARGE":
      return copy.importTooLarge;
    default:
      return copy.other(error instanceof Error ? error.message : String(error));
  }
}
