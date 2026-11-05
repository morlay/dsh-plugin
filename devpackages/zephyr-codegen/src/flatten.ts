// 与 zephyr `core.ts` 的 `expandModule` 同序：先 imports 深度优先，再 providers；providers 里的
// 嵌套数组、内嵌 Module 类与 `{ useModule }` 引用都展开，顺序即声明顺序。

import {
  moduleMetaOf,
  moduleNameOf,
  type ModuleClass,
  type ModuleMeta,
  type ProviderEntry,
  type ProviderList,
} from "./meta.ts";

function flattenProviders(providers: ProviderList | ProviderEntry): ProviderEntry[] {
  const flat: ProviderEntry[] = [];
  for (const entry of Array.isArray(providers) ? providers : [providers]) {
    if (Array.isArray(entry)) flat.push(...flattenProviders(entry));
    else flat.push(entry as ProviderEntry);
  }
  return flat;
}

function isModuleRef(entry: ProviderEntry): entry is { useModule: ModuleClass } {
  return typeof entry === "object" && entry !== null && "useModule" in entry;
}

function isWithout(entry: ProviderEntry): entry is import("./meta.ts").WithoutRef {
  return typeof entry === "object" && entry !== null && (entry as { kind?: unknown }).kind === "without";
}

function expandModule(meta: ModuleMeta, providers: ProviderEntry[]): void {
  for (const imported of meta.imports ?? []) {
    const importedMeta = moduleMetaOf(imported);
    if (importedMeta === undefined) {
      throw new Error(`"${moduleNameOf(imported)}" is not a module; apply @Module() to it`);
    }
    expandModule(importedMeta, providers);
  }
  for (const entry of flattenProviders(meta.providers ?? [])) {
    if (isWithout(entry)) continue;
    const nestedMeta = moduleMetaOf(entry);
    if (nestedMeta !== undefined) {
      expandModule(nestedMeta, providers);
      continue;
    }
    if (isModuleRef(entry)) {
      const nested = moduleMetaOf(entry.useModule);
      if (nested === undefined) {
        throw new Error(
          `"${moduleNameOf(entry.useModule)}" is not a module; apply @Module() to it`,
        );
      }
      expandModule(nested, providers);
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

function dedupeProviders(entries: readonly ProviderEntry[]): ProviderEntry[] {
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
    keyed.set(key, entry);
  }
  return [...keyed.values(), ...plain];
}

export function moduleProviders(moduleClass: ModuleClass): readonly ProviderEntry[] {
  const meta = moduleMetaOf(moduleClass);
  if (meta === undefined) {
    throw new Error(`"${moduleNameOf(moduleClass)}" is not a module; apply @Module() to it`);
  }
  const providers: ProviderEntry[] = [];
  expandModule(meta, providers);
  return dedupeProviders(providers);
}

function collectWithout(meta: ModuleMeta, without: import("./meta.ts").WithoutRef[]): void {
  for (const imported of meta.imports ?? []) {
    const importedMeta = moduleMetaOf(imported);
    if (importedMeta !== undefined) collectWithout(importedMeta, without);
  }
  for (const entry of flattenProviders(meta.providers ?? [])) {
    if (isWithout(entry)) {
      without.push(entry);
      continue;
    }
    const nested = moduleMetaOf(entry);
    if (nested !== undefined) {
      collectWithout(nested, without);
      continue;
    }
    if (isModuleRef(entry)) {
      const nestedMeta = moduleMetaOf(entry.useModule);
      if (nestedMeta !== undefined) collectWithout(nestedMeta, without);
    }
  }
}

export function moduleWithoutMarkers(
  moduleClass: ModuleClass,
): readonly import("./meta.ts").WithoutRef[] {
  const meta = moduleMetaOf(moduleClass);
  if (meta === undefined) {
    throw new Error(`"${moduleNameOf(moduleClass)}" is not a module; apply @Module() to it`);
  }
  const without: import("./meta.ts").WithoutRef[] = [];
  collectWithout(meta, without);
  return without;
}
