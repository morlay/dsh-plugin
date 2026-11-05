// `@Module` 元数据的读取面：与 zephyr `core.ts` 同形（同一个 `Symbol.for("zephyr.module")`）。

export const kModule: symbol = Symbol.for("zephyr.module");

export type ProviderFunction = Function & {
  readonly packageName?: string;
  readonly providerName?: string;
  readonly officialRowId?: string;
  readonly providerConfig?: unknown;
  readonly providerBase?: Function;
  readonly adapted?: boolean;
};

export interface ModuleRef {
  readonly useModule: ModuleClass;
}

// zephyr 的 `withConfig()` 返回的形状：有 config 时带 `useValue`，没有时只有 `provide`。
export interface ConfigProvider {
  readonly provide: ProviderFunction;
  readonly useValue?: unknown;
  readonly packageName?: string;
}

export interface WithoutRef {
  readonly kind: "without";
  readonly entry: ProviderEntry;
  readonly disabled?: unknown;
}

export interface FactoryProvider {
  readonly provide: Function;
  readonly useFactory: (ctx: unknown) => unknown;
}

export interface MultiProvider {
  readonly provide: ProviderFunction;
  readonly useValue: unknown;
  readonly multi: true;
}

// 官方行适配：`officialRow(pkg.name).withConfig()` / `.disabled()` 的形状；行 id 已从包名派生。
export interface OfficialRowEntry {
  readonly kind: "official-row";
  readonly rowId: string;
  readonly config?: unknown;
  readonly disabled?: true;
}

export type ProviderEntry =
  | ProviderFunction
  | ConfigProvider
  | FactoryProvider
  | MultiProvider
  | ModuleRef
  | OfficialRowEntry
  | WithoutRef;

export type ProviderList = ReadonlyArray<ProviderEntry | ProviderList>;

export type ModuleClass = abstract new (...args: never[]) => unknown;

export interface ModuleMeta {
  readonly providers?: ProviderList;
  readonly imports?: readonly ModuleClass[];
}

const kModuleFile: symbol = Symbol.for("zephyr.module.file");

export function moduleFileOf(entry: unknown): string | undefined {
  if (typeof entry !== "function") return undefined;
  return (entry as unknown as Record<symbol, string | undefined>)[kModuleFile];
}

export function moduleMetaOf(entry: unknown): ModuleMeta | undefined {
  if (typeof entry !== "function") return undefined;
  const meta = (entry as unknown as Record<symbol, ModuleMeta | undefined>)[kModule];
  return meta === undefined ? undefined : meta;
}

// 与 zephyr 的 `@Module()` 同形的最小实现：测试与没有 zephyr 的调用方用它造元数据；真实 bundle
// 直接用 zephyr 的装饰器，两者写的是同一个 symbol。
export function defineModule(meta: ModuleMeta = {}): ClassDecorator {
  return ((target: ModuleClass) => {
    Object.defineProperty(target, kModule, { value: meta, enumerable: false });
    return target;
  }) as unknown as ClassDecorator;
}

export function moduleNameOf(moduleClass: ModuleClass): string {
  return typeof moduleClass === "function" && moduleClass.name.length > 0
    ? moduleClass.name
    : "anonymous module";
}
