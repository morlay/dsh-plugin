// `@Setting`：把「这一行的配置住哪个命名空间、它的 schema 长什么样」声明在类上。
//
// setting 域只提供**基础能力**（文档读写、schema 注册表）；具体的设置项由各自的模块注册——
// 和 tools 一样：工具定义在上游插件里，本仓只负责"把它交给装配面"。
//
// 装饰器只写元数据（不碰实例）：读持久化值、mount 上游插件、注册 schema 这三步模板由 `settingRow`
// 的 mixin 执行，实现类只剩"声明依赖"。
import { inject, type Context } from "@morlay/zephyr";
import { Setting as SettingService } from "@morlay/zephyr-app";
import { SettingSchema } from "@morlay/zephyr-app";

/** 一个设置项的声明。 */
export interface SettingOptions {
  /** 上游命名空间：`settings.json` 的键，也是 `listConfigurableProviders()` 的 `settingsNs`。 */
  readonly ns: string;
  /** 该行的上游 `Config`（schemastery）：设置页用它重建表单。 */
  readonly config?: { toJSON(): unknown };
}

const OPTIONS = Symbol.for("zephyr.setting");

/**
 * 声明一个设置项。
 * @param options - 命名空间与 schema。
 * @returns 类装饰器。
 */
export function Setting(options: SettingOptions): ClassDecorator {
  return (target) => {
    Object.defineProperty(target, OPTIONS, { value: options, configurable: true });
  };
}

/**
 * 取类（含其父类链）上的设置项声明。
 * @param target - 类或实例。
 * @returns 声明；没有时 `undefined`。
 */
export function settingOptionsOf(target: object): SettingOptions | undefined {
  for (
    let current: object | null = target;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    const own = Object.getOwnPropertyDescriptor(current, OPTIONS);
    if (own !== undefined) return own.value as SettingOptions;
  }
  return undefined;
}

/** 上游适配行（`fromCordis(...)` 的产物）的形状。 */
interface SettingRowBase {
  readonly rowConfig?: unknown;
  mount(ctx: Context, config?: unknown, deps?: Record<string, unknown>): Promise<void>;
  onInit?(ctx: Context): Promise<void>;
}

/**
 * 给上游适配行套上「读持久化 → mount → 注册 schema」的模板。
 *
 * 实现类只需要覆写 `settingDeps()`（把上游插件要的服务交出去），并在类上写 `@Setting({...})`。
 * @param Base - `fromCordis(...)` 得到的类。
 * @returns 套好模板的类。
 */
// oxlint-disable-next-line typescript/no-explicit-any -- mixin 的构造签名必须是 `any[]`（TS 的硬要求）。
export function settingRow<T extends new (...args: any[]) => object>(Base: T): T {
  abstract class SettingRow extends Base {
    /** 设置文档：这一行的命名空间写着它的配置。 */
    private readonly setting = inject.optional(SettingService);

    private readonly schemas = inject(SettingSchema);

    /** 交给上游插件的服务依赖（子类覆写）。 */
    protected abstract settingDeps(): Record<string, unknown>;

    async onInit(ctx: Context): Promise<void> {
      const options = settingOptionsOf(this.constructor);
      // 先应用**持久化**的配置：`settings.json` 里的值在启动时就该生效。
      const persisted = options === undefined ? undefined : this.setting?.snapshot()[options.ns];
      const rowConfig = ((this as unknown as SettingRowBase).rowConfig ?? {}) as Record<
        string,
        unknown
      >;
      const config =
        typeof persisted === "object" && persisted !== null
          ? { ...rowConfig, ...persisted }
          : rowConfig;
      await (this as unknown as SettingRowBase).mount(ctx, config, this.settingDeps());
      if (options?.config !== undefined) {
        this.schemas.register(options.ns, options.config.toJSON());
      }
    }
  }
  return SettingRow as unknown as T;
}
// 旧名：`Setting` 的别名（调用点仍写 `SettingDeclaration as Setting`）。
export { Setting as SettingDeclaration };
