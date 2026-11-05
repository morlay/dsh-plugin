// 配置面的默认实现：**只管内存文档**；读写盘全在 `SettingLoader`。
//
// 文档是 `<dataDir>/settings.json`（2 空格缩进、键按插入顺序）。文件不存在就是空文档——
// 首次启动本来就没有，不报错。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { Setting, type SettingDocument, type SettingNamespaceView } from "@morlay/zephyr-app";
import { SettingLoader } from "./setting-loader.service.ts";

@Injectable()
export class SettingDefault extends Setting {
  private readonly loader = inject(SettingLoader);

  private document: SettingDocument | undefined;

  /** 每个命名空间的写入次数（客户端拿它判断视图旧不旧；进程内有效，重启从 0 起）。 */
  private readonly revisions = new Map<string, number>();

  /** 各插件实例的呈现策略（见 {@link configure}）。 */
  private readonly presentations = new Map<object, { auto?: boolean }>();

  /** 装配时把 `SettingLoader` 读到的文档接过来（读不到就是空文档）。 */
  protected async onInit(_ctx: Context): Promise<void> {
    this.document = this.loader.initial() ?? {};
  }

  snapshot(): SettingDocument {
    return structuredClone(this.load());
  }

  /**
   * 各插件实例声明的呈现方式。本装配的 `settings/describe` 按 `SettingSchema` 的注册表列命名空间、
   * 不看呈现策略，所以这里只**如实记着**（撤销时清掉），不改变任何行为。
   * @param presentation - 呈现策略。
   * @param owner - 归属实例。
   * @returns 撤销函数。
   */
  configure(presentation: { auto?: boolean }, owner?: object): () => void {
    const key = owner ?? this;
    this.presentations.set(key, { ...presentation });
    return () => {
      this.presentations.delete(key);
    };
  }

  update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): SettingNamespaceView {
    const current = this.sectionOf(ns);
    const merged = mergeTree(current, patch);
    return this.writeSection(ns, merged, expectedRevision);
  }

  replace(
    ns: string,
    section: Record<string, unknown>,
    expectedRevision?: number,
  ): SettingNamespaceView {
    return this.writeSection(ns, structuredClone(section), expectedRevision);
  }

  /** 一个命名空间当前的生效值（文档里没有就是空对象）。 */
  private sectionOf(ns: string): Record<string, unknown> {
    const current = this.load()[ns];
    return typeof current === "object" && current !== null
      ? structuredClone(current as Record<string, unknown>)
      : {};
  }

  /** 写一个命名空间：校验 revision、落盘、返回视图（`value` 与 `user` 同源——本装配没有 base 层）。 */
  private writeSection(
    ns: string,
    value: Record<string, unknown>,
    expectedRevision?: number,
  ): SettingNamespaceView {
    const revision = this.revisions.get(ns) ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      throw new Error(
        `settings/conflict: 命名空间 "${ns}" 的 revision 是 ${revision}，期望 ${expectedRevision}`,
      );
    }
    const next = { ...this.load(), [ns]: value };
    this.document = next;
    this.loader.save(next);
    const written = revision + 1;
    this.revisions.set(ns, written);
    return { ns, value: structuredClone(value), user: structuredClone(value), revision: written };
  }

  private load(): SettingDocument {
    this.document ??= {};
    return this.document;
  }
}

/**
 * 深合并：对象逐键递归，其余类型后写覆盖（数组整体替换，不做元素合并）。
 *
 * `SettingDefault` 用它合并写入补丁；`settings/describe` 用它把用户层盖到 schema 默认层上——
 * 两处是同一份语义，所以只有这一个实现。
 * @param base - 当前值（不会被改）。
 * @param patch - 要合并进去的键树（不会被改）。
 * @returns 新对象（深拷贝）。
 */
export function mergeTree(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = out[key];
    out[key] =
      typeof previous === "object" &&
      previous !== null &&
      !Array.isArray(previous) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
        ? mergeTree(previous as Record<string, unknown>, value as Record<string, unknown>)
        : structuredClone(value);
  }
  return out;
}
