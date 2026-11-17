// 库身份的比较口径：SQLite 的 `application_id` 只有 32 位，**写入**只收 int32 文本，**读回**是同一段
// 32 位的无符号表示——两侧直接 `===` 比会误判（-80036999 与 4214930297），所以比较前两侧都归一。
//
// 写入侧为什么不跟着归一：`PRAGMA application_id = 4214930297` 超出 int32，SQLite 会**静默写成 0**
//（身份就没了）。所以写入保持 int32、读回按无符号口径、比较前归一。
import {
  LEGACY_SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
} from "../version.ts";

/** 归一到 32 位无符号口径：有符号 int32 与无符号 32 位是同一个身份。 */
export function normalizeApplicationId(applicationId: number): number {
  return applicationId >>> 0;
}

/** 本库当前身份的归一值（与 `readIdentity().fingerprint`、`PRAGMA application_id` 读回同一口径）。 */
export const SESSION_APPLICATION_ID = normalizeApplicationId(
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
);

/** `readIdentity().fingerprint`（十六进制）→ 归一后的 32 位值；解析不了按 0（未设置）处理。 */
export function applicationIdOfFingerprint(fingerprint: string): number {
  const parsed = Number.parseInt(fingerprint, 16);
  return Number.isNaN(parsed) ? 0 : normalizeApplicationId(parsed);
}

/** 库里的身份属于谁：本库当前身份 / 本库旧身份（就地升级）/ 别人（拒绝打开）。 */
export type StoredApplicationIdKind = "current" | "legacy" | "foreign";

/** 按归一后的 32 位值认身份：只有本库的旧魔数算「自己的旧库」，其它不认识的仍是别人。 */
export function classifyStoredApplicationId(applicationId: number): StoredApplicationIdKind {
  const normalized = normalizeApplicationId(applicationId);
  if (normalized === SESSION_APPLICATION_ID) return "current";
  if (normalized === normalizeApplicationId(LEGACY_SESSION_PERSISTENCE_SQLITE_APPLICATION_ID)) {
    return "legacy";
  }
  return "foreign";
}
