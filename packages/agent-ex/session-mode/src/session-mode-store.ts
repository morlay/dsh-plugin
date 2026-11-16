// 会话级覆盖的持久化：`session_mode` 域，按 `SessionId` 一条记录，记这个会话覆盖了 `ModeConfig` 的哪些字段。
//
// **域层不判记录**，判据全在读面（`read`）。理由是布局：这个域走默认的 `single` 布局（整个域一个
// 文档）——`per-record` 那条「坏记录挪走」的退路（`KvUnit.backupRecord`）它没有，域层一旦在 `open`
// 时判坏，整次 `open` 就失败，一条坏记录会拖垮启动。于是域层只当搬运工，`read` 按 `ModeConfig` 的
// 字段逐条校验，坏记录按「没有覆盖」处理并 warn 一条，不阻断任何东西。
//
// 不换 `per-record` 还有第二个理由：那个布局把记录键当路径段，要求匹配 `/^[a-zA-Z0-9_-]+$/`，
// 而 `SessionId` 的形状不是本包定的——今天恰好安全，明天会话 id 带个别的字符就写不进去。
import { StorageDomainPlugin } from "@morlay/dsh-storage";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import type { ModeConfig } from "./endpoint/mode-config.ts";

/** 域的名字：存储介质的 unit 名，也是 `defineDomain` 的 identity。 */
const SESSION_MODE_DOMAIN = "session_mode";

/** 表名：一条记录 = 一个会话的字段级覆盖。 */
export const SESSION_MODE_TABLE = "overrides";

/** 每个字段在记录里的形状：`ModeConfig` 有哪些字段，这张表就有哪些键（漏一个是编译期错误）。 */
const FIELD_SHAPES: Readonly<
  Record<keyof ModeConfig, "strings" | "string" | "boolean" | "roles" | "persona" | "model">
> = {
  presetsOnly: "strings",
  name: "string",
  description: "string",
  role: "roles",
  persona: "persona",
  allowTools: "strings",
  denyTools: "strings",
  allowSkills: "strings",
  denySkills: "strings",
  allowPolicies: "strings",
  denyPolicies: "strings",
  instructions: "boolean",
  skills: "boolean",
  dropSections: "strings",
  runtimeContext: "boolean",
  defaultModel: "model",
};

/** 一串字符串。 */
function isStrings(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * 一个字段值符合它的形状吗。
 * @param shape - 字段的形状档。
 * @param value - 记录里的值。
 * @returns 符合为 `true`。
 */
function fitsShape(
  shape: (typeof FIELD_SHAPES)[keyof typeof FIELD_SHAPES],
  value: unknown,
): boolean {
  switch (shape) {
    case "string":
      return typeof value === "string";
    case "strings":
      return isStrings(value);
    case "boolean":
      return typeof value === "boolean";
    case "roles":
      return Array.isArray(value) && value.every((item) => item === "main" || item === "subagent");
    case "persona":
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { prefix?: unknown }).prefix === "string" &&
        typeof (value as { suffix?: unknown }).suffix === "string"
      );
    case "model": {
      if (typeof value !== "object" || value === null) return false;
      const model = value as { provider?: unknown; model?: unknown; reasoningEffort?: unknown };
      return (
        typeof model.provider === "string" &&
        typeof model.model === "string" &&
        (model.reasoningEffort === undefined || typeof model.reasoningEffort === "string")
      );
    }
  }
}

/**
 * 把介质里的一条记录读成覆盖：**整条**都要合法，任何一个字段不对就整条作废（按「没有覆盖」处理）。
 *
 * 「全要或全不要」是有意的：逐字段抢救会把一条写坏了的记录变成一份半对半错的覆盖，
 * 而调用方无从分辨。
 * @param stored - 介质里的原始值。
 * @returns 覆盖；不合法或空记录时给 `undefined`。
 */
function parseOverride(stored: unknown): SessionModeOverride | undefined {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return undefined;
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    const shape = (
      FIELD_SHAPES as Record<string, (typeof FIELD_SHAPES)[keyof typeof FIELD_SHAPES]>
    )[key];
    if (shape === undefined || !fitsShape(shape, value)) return undefined;
    record[key] = value;
  }
  return Object.keys(record).length === 0 ? undefined : (record as SessionModeOverride);
}

/**
 * 域层对记录的唯一判据：**照单全收**。
 *
 * 存储域要求的 `valueSchema` 是 zod 的 `ZodType`；这里给一个同形的直通对象——域层只在 `open` 时
 * 拿它对每条记录跑一次 `parse`，本包一个字段都不判（判据在读面，见文件头）。于是这个域既不跟
 * 上游的 zod 版本绑死，也不需要多一次「宽泛 schema 怎么转 `ZodType`」的断言。
 */
const anyRecord: StorageDomainPlugin.DomainTableSpec<SessionId, unknown>["valueSchema"] = {
  parse: (value: unknown) => value,
} as StorageDomainPlugin.DomainTableSpec<SessionId, unknown>["valueSchema"];

/** `session_mode` 的域声明：一个 `overrides` 表，键是会话，值是这条会话的覆盖记录。 */
export const sessionModeDomainSpec = StorageDomainPlugin.defineDomain({
  name: SESSION_MODE_DOMAIN,
  version: 1,
  tables: { overrides: StorageDomainPlugin.domainTable<SessionId, unknown>(anyRecord) },
});

/** 打开后的域句柄。 */
export type SessionModeDomain = StorageDomainPlugin.Domain<typeof sessionModeDomainSpec>;

/**
 * 打开域的能力：真实现是 `StorageDomain`，测试里可以给一个只实现 `open` 的替身。
 */
export interface SessionModeDomainOpener {
  /**
   * @param spec - `session_mode` 的域声明。
   * @returns 打开后的域句柄。
   */
  open(spec: typeof sessionModeDomainSpec): Promise<SessionModeDomain>;
}

/** 一条覆盖记录：`ModeConfig` 的字段级子集。 */
export type SessionModeOverride = Readonly<Partial<ModeConfig>>;

/**
 * `session_mode` 的三个动作：`read` / `write` / `remove`。
 *
 * 句柄**懒开**：没写过覆盖、也没打开过面板的部署一次都不会碰后端。`open` 失败直接向上抛，由调用方
 * （写路径 / 面板读面）报错——启动不碰它，所以坏记录与没装存储都不会让这一行起不来。
 */
export class SessionModeOverrides {
  private opened: Promise<SessionModeDomain> | undefined;

  /**
   * @param storage - 打开域的能力（真实现是 `StorageDomain`）。
   * @param warn - 坏记录的一条告警（装配面接 `logger.warn`）。
   */
  constructor(
    private readonly storage: SessionModeDomainOpener,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * 读一个会话的覆盖。
   * @param id - 会话身份。
   * @returns 字段级覆盖；没有记录、或记录形状不对时给 `undefined`（按「没有覆盖」处理）。
   */
  async read(id: SessionId): Promise<SessionModeOverride | undefined> {
    const stored = (await this.table()).get(id);
    if (stored === undefined) return undefined;
    const record = parseOverride(stored);
    if (record === undefined) {
      // 坏记录（形状不对、或是一条空记录）按「没有覆盖」处理：这个会话回落模式默认。
      this.warn(
        `session-mode: 会话 ${id} 的覆盖记录不合法，按没有覆盖处理：${JSON.stringify(stored)}`,
      );
    }
    return record;
  }

  /**
   * 写一个会话的覆盖（整条替换）。
   * @param id - 会话身份。
   * @param record - 覆盖记录；`undefined` 字段落盘前剔掉（JSON 里没有这个值）。
   */
  async write(id: SessionId, record: SessionModeOverride): Promise<void> {
    const plain = Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    );
    await (await this.table()).put(id, plain);
  }

  /**
   * 删一个会话的覆盖。
   * @param id - 会话身份。
   */
  async remove(id: SessionId): Promise<void> {
    await (await this.table()).delete(id);
  }

  /** 关掉打开过的域句柄（行卸载时用）。没开过就什么都不做。 */
  async close(): Promise<void> {
    const opened = this.opened;
    this.opened = undefined;
    if (opened === undefined) return;
    const domain = await opened.catch(() => undefined);
    await domain?.close();
  }

  // 懒开，且失败不留半个句柄：下一次读 / 写再试一次，而不是把这个域永久判死。
  private domain(): Promise<SessionModeDomain> {
    this.opened ??= this.storage.open(sessionModeDomainSpec).catch((error: unknown) => {
      this.opened = undefined;
      throw error;
    });
    return this.opened;
  }

  private async table(): Promise<ReturnType<SessionModeDomain["table"]>> {
    return (await this.domain()).table(SESSION_MODE_TABLE);
  }
}
