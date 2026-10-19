// `@Module` 与模块展开/合并：providers + imports 拍平成一份 Provider 列表。
import { definitionFileOf, tryGetTokenMeta } from "./token-meta.ts";
import { type ProviderEntry, type ProviderList, type WithoutRef } from "./provider.ts";
import type { ModuleClass, Token } from "./injection.ts";

export interface ModuleMeta {
  providers?: ProviderList;

  imports?: readonly ModuleClass[];
}

// 构建期（codegen）与运行期是两条模块图：`@Module` 的元数据 key 必须跨实例一致。
const kModule = Symbol.for("zephyr.module");

// Module 的定义文件：构建期生成器据此找到它所属的包（包的 `./cordis-register` 出口决定它是不是一行）。
const kModuleFile = Symbol.for("zephyr.module.file");

export function Module(meta: ModuleMeta = {}): ClassDecorator {
  return ((target: ModuleClass) => {
    Object.defineProperty(target, kModule, { value: meta, enumerable: false });
    const file = definitionFileOf();
    if (file !== undefined) {
      Object.defineProperty(target, kModuleFile, { value: file, enumerable: false });
    }
    return target;
  }) as unknown as ClassDecorator;
}

export function moduleFileOf(entry: unknown): string | undefined {
  if (typeof entry !== "function") return undefined;
  return (entry as unknown as Record<symbol, string | undefined>)[kModuleFile];
}

export function moduleMetaOf(entry: unknown): ModuleMeta | undefined {
  if (typeof entry !== "function") return undefined;
  return (entry as unknown as Record<symbol, ModuleMeta | undefined>)[kModule];
}

export function importProvidersFrom(...modules: ModuleClass[]): ProviderEntry[] {
  return modules.map((useModule) => ({ useModule }));
}

/** Provider 列表里的剔除标记：运行期不注册；patch 里保留为 disabled 行。 */
export function without(entry: ProviderEntry, disabled?: unknown): WithoutRef {
  return disabled === undefined ? { kind: "without", entry } : { kind: "without", entry, disabled };
}

function isWithoutRef(entry: ProviderEntry): entry is WithoutRef {
  return typeof entry === "object" && entry !== null && (entry as { kind?: unknown }).kind === "without";
}

export function flattenProviders(providers: ProviderList | ProviderEntry): ProviderEntry[] {
  const flat: ProviderEntry[] = [];
  for (const entry of Array.isArray(providers) ? providers : [providers]) {
    if (Array.isArray(entry)) flat.push(...flattenProviders(entry));
    else flat.push(entry as ProviderEntry);
  }
  return flat;
}

// without 的匹配用**令牌名**：`configuredProvider` 生成的子类、以及同一份源码被两条解析路径载入
// （symlink 与真实路径）时，类身份不同但令牌名一致——按名字才谈得上「运行时重组」。
function entryBaseOf(entry: ProviderEntry): unknown {
  if (typeof entry === "function") {
    return (entry as { providerBase?: Function }).providerBase ?? entry;
  }
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    const provide = entry.provide as { providerBase?: Function } & Function;
    return provide.providerBase ?? provide;
  }
  return entry;
}

// `without` 的匹配用**条目身份**（`providerBase` 或类自身），不是令牌、也不是字符串：
// 适配条目（`fromCordis(契约, 上游)`）的身份是 `providerBase` = 契约，会被剔除；
// 而「继承契约的实现」条目身份是它自己，令牌虽是契约，但不会被误剔——替换实现与剔除上游条目因此可以共存。
function entryIdentityOf(entry: ProviderEntry): unknown {
  return entryBaseOf(entry);
}

function collectWithout(meta: ModuleMeta, excluded: Set<ProviderEntry>): void {

  for (const imported of meta.imports ?? []) {
    const importedMeta = moduleMetaOf(imported);
    if (importedMeta !== undefined) collectWithout(importedMeta, excluded);
  }
  for (const entry of flattenProviders(meta.providers ?? [])) {
    if (isWithoutRef(entry)) {
      if (entry.disabled === undefined) {
        excluded.add(entryIdentityOf(entry.entry as ProviderEntry) as ProviderEntry);
      }
      continue;
    }
    const nestedMeta = moduleMetaOf(entry);
    if (nestedMeta !== undefined) {
      collectWithout(nestedMeta, excluded);
      continue;
    }
    if (isModuleRef(entry)) {
      const nestedMeta = moduleMetaOf(entry.useModule);
      if (nestedMeta !== undefined) collectWithout(nestedMeta, excluded);
    }
  }
}

/** 展开一个 Module：imports 深度优先、providers 随后，`without` 标记的条目剔除。 */
export function providersOfModule(moduleClass: ModuleClass): ProviderEntry[] {
  const meta = moduleMetaOf(moduleClass);
  if (meta === undefined) {
    throw new Error(`"${moduleClass.name}" is not a module; apply @Module() to it`);
  }
  const providers: ProviderEntry[] = [];
  expandModule(meta, providers);
  return providers;
}

export function expandModule(
  meta: ModuleMeta,
  providers: ProviderEntry[],
  excluded: Set<ProviderEntry> = new Set(),
): void {
  collectWithout(meta, excluded);
  for (const imported of meta.imports ?? []) {
    const importedMeta = moduleMetaOf(imported);
    if (importedMeta === undefined) {
      throw new Error(`"${imported.name}" is not a module; apply @Module() to it`);
    }
    expandModule(importedMeta, providers, excluded);
  }
  for (const entry of flattenProviders(meta.providers ?? [])) {
    if (isWithoutRef(entry) || excluded.has(entry)) continue;
    if (excluded.has(entryIdentityOf(entry) as ProviderEntry)) continue;
    const nestedMeta = moduleMetaOf(entry);
    if (nestedMeta !== undefined) {
      expandModule(nestedMeta, providers, excluded);
      continue;
    }
    if (isModuleRef(entry)) {
      const nested = moduleMetaOf(entry.useModule);
      if (nested === undefined) {
        throw new Error(`"${entry.useModule.name}" is not a module; apply @Module() to it`);
      }
      expandModule(nested, providers, excluded);
      continue;
    }
    providers.push(entry);
  }
}

function providerKeyOf(entry: ProviderEntry): unknown {
  if (typeof entry === "function") {
    return (entry as { providerBase?: Function }).providerBase ?? entry;
  }
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    const provide = entry.provide as { providerBase?: Function } & Function;
    return provide.providerBase ?? provide;
  }
  return undefined;
}

/**
 * 多 Module 合并：同一 token 的 Provider 后者覆盖前者；multi 与无名条目保持原样。
 * 覆盖者占据**自己的声明位置**（先删后插）：装配顺序按声明顺序排同层依赖，
 * 覆盖者往往依赖后导入模块里的服务（如 `StorageDomain` 覆盖成 rdb 后端，rdb 后端由后导入的行提供）。
 */
export function dedupeProviders(entries: readonly ProviderEntry[]): ProviderEntry[] {
  const keyed = new Map<unknown, ProviderEntry>();
  const plain: ProviderEntry[] = [];
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry) {
      plain.push(entry);
      continue;
    }
    const key = providerKeyOf(entry);
    if (key === undefined) {
      plain.push(entry);
      continue;
    }
    if (keyed.has(key)) keyed.delete(key);
    keyed.set(key, entry);
  }
  return [...keyed.values(), ...plain];
}

export function isModuleRef(entry: ProviderEntry): entry is { useModule: ModuleClass } {
  return typeof entry === "object" && entry !== null && "useModule" in entry;
}

/**
 * 本次装配里**确实会 provide 自己实例**的令牌：`inject.optional()` 据此区分「还没就位」与「装配里没有」。
 * 排除两类——multi 贡献（`contribute` 走 `provideMulti`，不在令牌视图里）与 `providesService === false`
 * 的适配型 provider（服务由上游插件按名字注册，它自己的令牌永远不会被 provide，等它会等成超时）。
 */
export function plannedTokensOf(entries: readonly ProviderEntry[]): ReadonlySet<Token> {
  const planned = new Set<Token>();
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry) continue;
    if (typeof entry === "object" && entry !== null && "useFactory" in entry) {
      planned.add((entry as { provide: Token }).provide);
      continue;
    }
    const provide = typeof entry === "function" ? entry : (entry as { provide?: Token }).provide;
    if (typeof provide !== "function") continue;
    // 上游 cordis 插件类没有 zephyr 令牌（走 ctx.plugin 装配），不进计划表。
    // 适配型 Provider（`fromCordis`）：令牌最终解析到上游实例（mount 里回填），同样算「装配里有它」。
    const meta = tryGetTokenMeta(provide);
    // 装配里会提供它的几种形态：Service 类（`providesService`）、适配（`serviceClass`）、
    // `fromCordisService` 那种解析式（`serviceResolver`），以及**绑定契约令牌**的适配类
    // （`meta.token !== meta.impl`，上游实例在 mount 后回填到契约上）。
    if (
      meta !== undefined &&
      (meta.providesService === true ||
        meta.serviceClass !== undefined ||
        meta.serviceResolver !== undefined ||
        meta.token !== meta.impl)
    ) {
      planned.add(meta.token);
    }
    for (const alias of meta?.aliases ?? []) planned.add(alias);
  }
  return planned;
}

/** 直接 imports 的 Module 类（用于从装配面推导「哪些 bundle 参与了组合」）。 */
export function moduleImportsOf(moduleClass: ModuleClass): readonly ModuleClass[] {
  return moduleMetaOf(moduleClass)?.imports ?? [];
}

/** 这个类是不是 `@Module` 声明的装配面（`app-boot` 用它决定走 `attachProviders` 还是 cordis 插件）。 */
export function isModuleClass(candidate: Function): boolean {
  return Object.hasOwn(candidate, kModule);
}
