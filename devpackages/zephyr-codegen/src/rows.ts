// 把展开后的 provider 拍平成 patch 行清单：insert 行来自 Provider（行 id = token 名，包名由 Provider
// 声明或定义文件推导），disabled / config 行来自 `without` 与 `withConfig`；顺序按声明原样保留。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { moduleProviders, moduleWithoutMarkers } from "./flatten.ts";
import { moduleFileOf, moduleMetaOf, type ModuleMeta } from "./meta.ts";
import { hyphenate, tokenNameOf } from "./hyphenate.ts";
import {
  type ConfigProvider,
  type ModuleClass,
  type OfficialRowEntry,
  type ProviderEntry,
} from "./meta.ts";

export interface InsertRowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: unknown;
  readonly disabled?: unknown;
  readonly inject?: readonly string[];
}

export type PatchRow =
  | { readonly id: string; readonly disabled: unknown }
  | { readonly id: string; readonly config: Readonly<Record<string, unknown>> }
  | { readonly insert: readonly InsertRowEntry[] };

export interface RowsOptions {
  // 当前 bundle 的包根：imports 里属于**其它 bundle**（有自己的 `dsh.bundle.patch`）的 Module 整体跳过，
  // 那些行由对方 bundle 自己的 patch 负责；bundle 只表达自己的差异。
  readonly bundleRoot?: string;
  // 覆盖包名解析（缺省读 Provider 上的 `static packageName`）。
  readonly packageNameOf?: (provider: Function) => string;
  // 按行 id 取包名（bundle 从上游 patch / 清单读，不放在 Provider 上）。
  readonly packageNameOfRow?: (id: string) => string | undefined;
}

// 类所属的包：从它的定义文件向上找最近的 package.json（行名不手写）。
function packageNameOfFile(file: string): string | undefined {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, "package.json");
    // oxlint-disable-next-line node/no-sync -- 构建期同步读清单
    if (existsSync(manifest)) {
      // oxlint-disable-next-line node/no-sync -- 构建期同步读清单
      const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) return name;
    }
    if (dirname(directory) === directory) return undefined;
  }
}

function packageNameOf(provider: Function, options: RowsOptions): string {
  if (options.packageNameOf !== undefined) return options.packageNameOf(provider);
  const declared = (provider as { packageName?: unknown }).packageName;
  if (typeof declared === "string" && declared.length > 0) return declared;
  const file = (provider as { providerFile?: unknown }).providerFile;
  if (typeof file === "string" && file.length > 0) {
    const name = packageNameOfFile(file);
    if (name !== undefined) return name;
  }
  throw new Error(
    `provider "${provider.name}" 找不到所属的包：用 @Injectable() 声明（它记录定义文件），` +
      "或调用方传 packageNameOf",
  );
}

function packageNameOfEntry(
  entry: ProviderEntry,
  provider: Function,
  options: RowsOptions,
): string {
  if (typeof entry === "object" && entry !== null && "packageName" in entry) {
    const name = (entry as { packageName?: unknown }).packageName;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return packageNameOf(provider, options);
}

function packageNameOfProvider(
  provider: Function,
  entry: ProviderEntry | undefined,
  options: RowsOptions,
): string {
  if (entry !== undefined) return packageNameOfEntry(entry, provider, options);
  return packageNameOf(provider, options);
}

function insertEntryOf(entry: ProviderEntry, options: RowsOptions): InsertRowEntry {
  if (typeof entry === "function") {
    const id = tokenNameOf(entry);
    const name = packageNameOfProvider(entry, undefined, options);
    return { id, name };
  }
  if ("multi" in entry && entry.multi === true) {
    throw new Error(
      "multi contribution has no row representation yet: a patch insert row mounts one provider",
    );
  }
  if ("useModule" in entry) {
    throw new Error(`module reference "${entry.useModule.name}" was not expanded`);
  }
  if ("kind" in entry) {
    throw new Error("official-row entries must be handled before insertEntryOf");
  }
  const provider = entry as ConfigProvider;
  const id = tokenNameOf(provider.provide);
  const name = packageNameOfProvider(provider.provide, entry, options);
  return { id, name };
}

function configOf(entry: ProviderEntry): unknown {
  if (typeof entry === "function") {
    return (entry as { providerConfig?: unknown }).providerConfig;
  }
  return typeof entry === "object" && entry !== null && "useValue" in entry
    ? entry.useValue
    : undefined;
}

function officialRowOf(entry: ProviderEntry): OfficialRowEntry | undefined {
  return typeof entry === "object" &&
    entry !== null &&
    (entry as { kind?: unknown }).kind === "official-row"
    ? (entry as OfficialRowEntry)
    : undefined;
}

/** 官方行的 Provider（或它的 `withConfig()` 条目）行 id；适配类从 class 名派生。 */
function officialProviderIdOf(entry: ProviderEntry): string | undefined {
  if (typeof entry === "object" && entry !== null && "kind" in entry) return undefined;
  const provider = typeof entry === "function" ? entry : (entry as ConfigProvider).provide;
  const legacy = (provider as { officialRowId?: string }).officialRowId;
  if (legacy !== undefined) return legacy;
  const base = ((provider as { providerBase?: Function }).providerBase ?? provider) as {
    adapted?: boolean;
    name: string;
  };
  if (base.adapted !== true) return undefined;
  const withoutSuffix = base.name.replace(/(?:Runtime|Service|Provider|Plugin|Registry|Store)$/u, "");
  const rowId = hyphenate(withoutSuffix);
  return rowId.length === 0 ? undefined : rowId;
}

function rowIdOf(entry: ProviderEntry): string {
  return (
    officialProviderIdOf(entry) ??
    tokenNameOf((entry as { provide?: Function }).provide ?? (entry as Function))
  );
}

function packageNameOfRow(
  entry: ProviderEntry,
  id: string,
  options: RowsOptions,
): string | undefined {
  const fromRow = options.packageNameOfRow?.(id);
  if (fromRow !== undefined) return fromRow;
  const provider = (typeof entry === "function" ? entry : (entry as ConfigProvider).provide) as Function;
  const base = (provider as { providerBase?: Function }).providerBase ?? provider;
  const direct = (provider as { packageName?: string }).packageName;
  if (typeof direct === "string" && direct.length > 0) return direct;
  // 官方行由上游 patch 提供，这里只覆盖 config，不生成 insert。
  if (officialProviderIdOf(entry) !== undefined) return undefined;
  // 能力包自己的行：包名从 Provider 定义文件所属的 package.json 推导。
  // 推不出来时交给调用方按「disabled 行只要有 id」还是「insert 行必须包名」分流。
  try {
    return packageNameOf(base, options);
  } catch {
    return undefined;
  }
}

interface ModuleRowEntry {
  readonly moduleRow: { readonly id: string; readonly packageName: string };
}

// 一个 Module 是不是「一行」：看它所属的包有没有 `./cordis-register` 出口（能力包的整包入口）。
// 有就是一行（`@morlay/<pkg>/cordis-register`），没有（bundle / 组合 Module）就展开它的 providers。
function packageManifestOfModule(
  moduleClass: ModuleClass,
): { name?: string; dir: string; isBundle: boolean } | undefined {
  const file = moduleFileOf(moduleClass);
  if (file === undefined) return undefined;
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    // oxlint-disable-next-line node/no-sync -- 构建期同步读清单
    if (existsSync(manifest)) {
      // oxlint-disable-next-line node/no-sync -- 构建期同步读清单
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
        dsh?: { bundle?: unknown };
      };
      if (parsed.exports?.["./cordis-register"] === undefined) return undefined;
      return {
        dir,
        isBundle: parsed.dsh?.bundle !== undefined,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
      };
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function rowIdOfPackage(packageName: string): string {
  const segment = packageName.split("/").pop() ?? packageName;
  const withoutScope = segment.startsWith("dsh-") ? segment.slice(4) : segment;
  return hyphenate(withoutScope);
}

function moduleRowOf(moduleClass: ModuleClass): ModuleRowEntry | undefined {
  const manifest = packageManifestOfModule(moduleClass);
  if (manifest?.name === undefined) return undefined;
  return { moduleRow: { id: rowIdOfPackage(manifest.name), packageName: manifest.name } };
}

function isModuleRowEntry(entry: ProviderEntry | ModuleRowEntry): entry is ModuleRowEntry {
  return typeof entry === "object" && entry !== null && "moduleRow" in entry;
}

// 展开 imports / providers，但**带 `row` 声明的 Module 保持整行**：一行只写一个 patch 行，
// 不把它的内部 Provider 拆成多行（同一入口被装多次会重复注册）。
function collectRowEntries(
  meta: ModuleMeta,
  out: Array<ProviderEntry | ModuleRowEntry>,
  bundleRoot?: string,
): void {
  for (const imported of meta.imports ?? []) {
    const importedMeta = moduleMetaOf(imported);
    if (importedMeta === undefined) {
      throw new Error(`"${(imported as { name?: string }).name}" is not a module`);
    }
    const moduleRow = moduleRowOf(imported);
    if (moduleRow !== undefined) {
      out.push(moduleRow);
      continue;
    }
    const manifest = packageManifestOfModule(imported);
    // 其它 bundle 的行由对方负责；这里只跳它们，能力包（有 cordis-register）已在上面成行。
    if (manifest?.isBundle === true && (bundleRoot === undefined || manifest.dir !== bundleRoot)) {
      continue;
    }
    collectRowEntries(importedMeta, out, bundleRoot);
  }
  for (const entry of Array.isArray(meta.providers ?? []) ? (meta.providers ?? []) : [meta.providers ?? []]) {
    if (Array.isArray(entry)) {
      collectRowEntries({ providers: entry }, out);
      continue;
    }
    const nestedMeta = moduleMetaOf(entry);
    if (nestedMeta !== undefined) {
      const moduleRow = moduleRowOf(entry as ModuleClass);
      if (moduleRow !== undefined) {
        out.push(moduleRow);
        continue;
      }
      collectRowEntries(nestedMeta, out, bundleRoot);
      continue;
    }
    if (typeof entry === "object" && entry !== null && (entry as { kind?: unknown }).kind === "without") {
      // without 由 moduleWithoutMarkers 生成 disabled 行，这里不重复处理。
      continue;
    }
    if (typeof entry === "object" && entry !== null && "useModule" in entry) {
      const usedModule = (entry as { useModule: ModuleClass }).useModule;
      const used = moduleMetaOf(usedModule);
      const moduleRow = moduleRowOf(usedModule);
      if (moduleRow !== undefined) {
        out.push(moduleRow);
        continue;
      }
      if (used !== undefined) collectRowEntries(used, out, bundleRoot);
      continue;
    }
    out.push(entry as ProviderEntry);
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

function rowNameOf(packageName: string): string {
  return packageName.startsWith("@morlay/") ? `${packageName}/cordis-register` : packageName;
}

export function rowsOf(moduleClass: ModuleClass, options: RowsOptions = {}): readonly PatchRow[] {
  const meta = moduleMetaOf(moduleClass);
  if (meta === undefined) {
    throw new Error(`"${(moduleClass as { name?: string }).name}" is not a module`);
  }
  const collected: Array<ProviderEntry | ModuleRowEntry> = [];
  collectRowEntries(meta, collected, options.bundleRoot);
  // 同 token 后者覆盖前者（与运行期 dedupe 同口径）：Module 行不参与去重。
  const entries: Array<ProviderEntry | ModuleRowEntry> = [];
  const slots = new Map<unknown, number>();
  for (const item of collected) {
    if (isModuleRowEntry(item)) {
      entries.push(item);
      continue;
    }
    const key = providerKeyOf(item as ProviderEntry);
    if (key === undefined) {
      entries.push(item);
      continue;
    }
    const slot = slots.get(key);
    if (slot === undefined) {
      slots.set(key, entries.length);
      entries.push(item);
      continue;
    }
    entries[slot] = item;
  }
  const withoutMarkers = moduleWithoutMarkers(moduleClass);
  const withoutByEntry = new Map(withoutMarkers.map((marker) => [marker.entry, marker]));

  // Angular 风格：Provider 进 insert 块，config / 官方行按声明顺序落顶层行。
  const insert: InsertRowEntry[] = [];
  const extra: Exclude<PatchRow, { readonly insert: readonly InsertRowEntry[] }>[] = [];

  for (const item of entries) {
    if (isModuleRowEntry(item)) {
      insert.push({ id: item.moduleRow.id, name: rowNameOf(item.moduleRow.packageName) });
      continue;
    }
    const entry = item;
    if (typeof entry === "object" && entry !== null && "useFactory" in entry) continue;
    const official = officialRowOf(entry);
    if (official !== undefined) {
      extra.push(
        official.disabled === true
          ? { id: official.rowId, disabled: true }
          : {
              id: official.rowId,
              config: (official.config ?? {}) as Readonly<Record<string, unknown>>,
            },
      );
      continue;
    }
    if (typeof entry === "object" && entry !== null && "multi" in entry) {
      throw new Error("multi contribution 还没有行表达");
    }
    const marker = withoutByEntry.get(entry);
    const disabled = marker === undefined ? undefined : (marker.disabled ?? true);
    const rowId = rowIdOf(entry);
    const packageName = packageNameOfRow(entry, rowId, options);
    if (packageName !== undefined) {
      const config = configOf(entry);
      const officialInsert = officialProviderIdOf(entry) !== undefined;
      const name = packageName.startsWith("@morlay/")
        ? `${packageName}/cordis-register`
        : packageName;
      const provider = (typeof entry === "function" ? entry : (entry as ConfigProvider).provide) as {
        inject?: readonly (string | { readonly serviceName?: string })[];
      };
      const inject = provider.inject?.map((item) =>
        typeof item === "string" ? item : (item.serviceName ?? tokenNameOf(item as Function)),
      );
      insert.push({
        id: rowId,
        name,
        ...(officialInsert && config !== undefined ? { config } : {}),
        ...(inject === undefined ? {} : { inject }),
        ...(disabled === undefined ? {} : { disabled }),
      });
      if (!officialInsert && config !== undefined) {
        extra.push({ id: rowId, config: config as Readonly<Record<string, unknown>> });
      }
      continue;
    }
    if (disabled !== undefined) {
      const id = officialProviderIdOf(entry) ?? tokenNameOf((entry as { provide?: Function }).provide ?? (entry as Function));
      extra.push({ id, disabled });
      continue;
    }
    const officialProviderId = officialProviderIdOf(entry);
    if (officialProviderId !== undefined) {
      extra.push({
        id: officialProviderId,
        config: (configOf(entry) ?? {}) as Readonly<Record<string, unknown>>,
      });
      continue;
    }
    const insertEntry = insertEntryOf(entry, options);
    insert.push(insertEntry);
    const config = configOf(entry);
    if (config !== undefined) {
      extra.push({ id: insertEntry.id, config: config as Readonly<Record<string, unknown>> });
    }
  }

  const emitted = new Set([
    ...insert.map((entry) => entry.id),
    ...extra.map((entry) => entry.id),
  ]);
  for (const marker of withoutMarkers) {
    const entry = marker.entry;
    const id = officialProviderIdOf(entry) ?? tokenNameOf((entry as { provide?: Function }).provide ?? (entry as Function));
    if (emitted.has(id)) continue;
    const disabled = marker.disabled ?? true;
    const name = packageNameOfRow(entry, id, options);
    const config = configOf(entry);
    if (name !== undefined) {
      insert.push({
        id,
        name,
        ...(config === undefined ? {} : { config }),
        disabled,
      });
    } else {
      extra.push({ id, disabled });
    }
    emitted.add(id);
  }

  const block: PatchRow | undefined = insert.length === 0 ? undefined : { insert };
  const disabled = extra.filter((row) => "disabled" in row);
  const config = extra.filter((row) => !("disabled" in row));
  return [...disabled, ...(block === undefined ? [] : [block]), ...config];
}
