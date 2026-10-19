// `slots` 的自己实现：核心是上游 `SlotCore`（纯逻辑、不依赖 ctx），生命周期挂在我们行的 `effect` 上。
//
// 不继承上游 `SlotRegistry` 的原因：它是 cordis `Service`，构造期就 `ctx.reflect.provide`，
// 与我们的行作用域发布模型冲突（`onInit` 之前消费方读到的是空壳）。
import type { SlotRenderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
import {
  SlotCore,
  type HostObservable,
  type KeyedStandardSource,
  type LiveCompositionNode,
  type StandardSourceBinding,
  type LocaleFace,
  type RootStandardSourceContribution,
  type SlotScope,
  type SlotScopeAdapter,
  type StoredEntry,
  type StoredFactory,
} from "@deepseek-ai/dsh-client-ui-slots";
import { createSlotRenderer } from "@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx";
import { Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";

type AnyKey = string;

@Injectable()
export class SlotsDefault extends Slots implements OnInit {
  private readonly core = new SlotCore();

  private renderer: SlotRenderer | undefined;

  private locale: LocaleFace | undefined;

  private readonly scopes = new Map<string, SlotScopeAdapter>();

  private readonly rootContributions: RootStandardSourceContribution[] = [];

  // —— store 轴：handle × scope → 实例（上游 `SlotRegistry` 的那三张表，语义照搬）——
  private readonly stores = new Map<object, { scope: string; refs: number; instances: Map<string, unknown> }>();

  private readonly factoryStores = new Map<
    object,
    { occurrences: WeakMap<object, { handle: unknown; instances: Map<string, unknown>; retainers: number }>; mounted: Map<object, { instances: Map<string, unknown> }> }
  >();

  private readonly storeScopeOwners = new Map<string, unknown>();

  private ctx: Pick<Context, "effect"> | undefined;

  onInit(ctx: Context): void {
    this.ctx = ctx;
    // 渲染器是我们自己的装配步骤（上游把它放在 `apply` 里；我们不再挂那个插件）。
    this.install(createSlotRenderer());
  }

  private get effect(): Context["effect"] {
    if (this.ctx === undefined) throw new Error("slots 未初始化：装配顺序错误（onInit 之前被调用）");
    return this.ctx.effect.bind(this.ctx);
  }

  entries(key: AnyKey): readonly StoredEntry[] {
    return this.core.entries(key as never);
  }

  entriesOfSlot(key: AnyKey): readonly StoredEntry[] {
    return this.core.entriesOfSlot(key as never);
  }

  snapshot(root?: string): LiveCompositionNode[] {
    return this.core.snapshot(root);
  }

  subscribe(key: AnyKey, fn: () => void): () => void {
    return this.core.subscribe(key as never, fn);
  }

  register(options: Record<string, unknown>, component: unknown): () => void {
    const dispose = this.core.register(options as never, component as never);
    const store = (options as { store?: unknown }).store;
    if (store !== undefined && typeof store !== "function") this.acquire(store, String((options as { scope?: string }).scope ?? "root"));
    const undo = this.effect(() => dispose);
    return () => {
      void undo();
      if (store !== undefined && typeof store !== "function") this.release(store);
    };
  }

  registerFactory(options: Record<string, unknown>, factory: unknown): () => void {
    const dispose = this.core.registerFactory(options as never, factory as never);
    const definition = this.core.factory(String((options as { name?: string }).name ?? ""));
    const store = definition?.store;
    if (definition !== undefined) {
      if (store !== undefined && typeof store !== "function") this.acquire(store, String(definition.scope));
      else if (typeof store === "function") {
        this.factoryStores.set(definition, { occurrences: new WeakMap(), mounted: new Map() });
      }
    }
    const undo = this.effect(() => dispose);
    return () => {
      void undo();
      if (definition !== undefined) this.factoryStores.delete(definition);
      if (store !== undefined && typeof store !== "function") this.release(store);
    };
  }

  install(renderer: SlotRenderer): void {
    if (this.renderer !== undefined) throw new Error("slot renderer already installed (install() is boot-once)");
    this.effect(() => {
      this.renderer = renderer;
      return () => {
        if (this.renderer === renderer) this.renderer = undefined;
      };
    });
  }

  installLocale(face: LocaleFace): void {
    if (this.locale !== undefined) throw new Error("locale face already installed (installLocale() is boot-once)");
    this.effect(() => {
      this.locale = face;
      return () => {
        if (this.locale === face) this.locale = undefined;
      };
    });
  }

  installScope(scope: Exclude<SlotScope, "root" | "session-maybe">, adapter: SlotScopeAdapter): void {
    if (this.scopes.has(scope)) throw new Error(`slot scope '${scope}' already has an adapter`);
    this.effect(() => {
      this.scopes.set(scope, adapter);
      return () => {
        if (this.scopes.get(scope) === adapter) this.scopes.delete(scope);
      };
    });
  }

  provideRoot(contribution: RootStandardSourceContribution): () => void {
    const undo = this.effect(() => {
      this.rootContributions.push(contribution);
      return () => {
        const index = this.rootContributions.indexOf(contribution);
        if (index >= 0) this.rootContributions.splice(index, 1);
      };
    });
    return () => {
      void undo();
    };
  }

  inject(key: AnyKey, callback: () => (() => void) | Iterable<() => void>): () => void {
    const undo = this.effect(() => {
      const spec = this.core.specDynamic(key as never);
      if (spec === undefined) return () => {};
      const dispose = this.effect(callback);
      return () => {
        void dispose();
      };
    });
    return () => {
      void undo();
    };
  }

  renderSlot(key: AnyKey, owner: unknown): ReturnType<Slots["renderSlot"]> {
    if (key !== "root") {
      throw new Error(`ctx-level renderSlot only renders 'root' (got "${key}")`);
    }
    if (this.renderer === undefined) {
      throw new Error("slot renderer not installed — boot must call ctx.slots.install(createSlotRenderer()) before rendering 'root'");
    }
    if (this.core.entries("root" as never).length === 0) {
      throw new Error("'root' has no registration — a layout entry must register into 'root' before the shell renders it");
    }
    return this.renderer.renderRoot(this.hostFace(), owner as never) as ReturnType<Slots["renderSlot"]>;
  }

  /**
   * 渲染宿主面：`createSlotRenderer` 的全部读取口（成员集合见上游 `SlotRendererHost`）。
   * 能直接转发的转发给 `SlotCore`；只有 root / scope 是我们自己的状态。
   */
  private hostFace(): Parameters<SlotRenderer["renderRoot"]>[0] {
    const core = this.core;
    const rootListeners = new Set<() => void>();
    let rootSnapshot: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
    const rebuildRoot = (): void => {
      const hooks: Record<string, HostObservable<unknown> | undefined> = {};
      const keyedHooks: Record<string, KeyedStandardSource | undefined> = {};
      const props: Record<string, unknown> = {};
      for (const contribution of this.rootContributions) {
        Object.assign(hooks, contribution.hooks ?? {});
        Object.assign(keyedHooks, contribution.keyedHooks ?? {});
        Object.assign(props, contribution.props ?? {});
      }
      rootSnapshot = { key: undefined, hooks, keyedHooks, props };
      for (const listener of [...rootListeners]) listener();
    };
    rebuildRoot();

    return {
      subscribe: (key: string, fn: () => void) => core.subscribe(key as never, fn),
      getVersion: () => 0,
      entriesOf: (key: string) => core.entries(key as never),
      entriesOfSlot: (key: string) => core.entriesOfSlot(key as never),
      reportEntryError: (key: string, entry: never, error: unknown, info: { abdicate: boolean }) =>
        core.reportEntryError(key as never, entry, error, info),
      reportFactoryError: (name: string, registration: never, error: unknown) =>
        core.reportFactoryError(name, registration, error),
      specOf: (key: string) => core.specDynamic(key),
      isLive: (entry: never) => core.isLive(entry),
      storeOf: (entry: { store?: unknown }, binding: { key?: string } | undefined) =>
        entry.store === undefined ? undefined : this.resolveStore(entry.store, binding),
      factoryStoreOf: (definition: never, binding: { key?: string } | undefined, occurrence: object) =>
        this.resolveFactoryStore(definition, binding, occurrence),
      retainFactoryOccurrence: (definition: never, occurrence: object) =>
        this.retainOccurrence(definition, occurrence),
      subscribeFactory: (name: string, fn: () => void) => core.subscribeFactory(name, fn),
      getFactoryVersion: (name: string) => core.factoryVersion(name),
      factoryOf: (name: string) => core.factory(name),
      isFactoryLive: () => false,
      get root(): HostObservable<StandardSourceBinding> {
        return {
          getSnapshot: () => rootSnapshot,
          subscribe: (fn: () => void) => {
            rootListeners.add(fn);
            return () => rootListeners.delete(fn);
          },
        };
      },
      scopeRevision: {
        getSnapshot: () => this.scopeRevision,
        subscribe: (fn: () => void) => {
          this.scopeRevisionListeners.add(fn);
          return () => this.scopeRevisionListeners.delete(fn);
        },
      },
      // `session-maybe` 与 `session` 解析同一个 adapter（上游同语义）。
      scope: (scope: string) => this.scopes.get(scope === "session-maybe" ? "session" : scope),
      locale: this.locale,
    } as never;
  }

  private resolveStore(handle: unknown, binding: { key?: string } | undefined): unknown {
    const record = this.stores.get(handle as object);
    if (record === undefined) throw new Error("store handle is not registered (entry unloaded, or the handle never went through register)");
    let key: string;
    if (record.scope === "root") key = "root";
    else {
      if (binding?.key === undefined) throw new Error(`${record.scope} store resolution requires a session id`);
      key = binding.key;
      this.bindStoreScope(binding as never);
    }
    let instance = record.instances.get(key);
    if (instance === undefined) {
      const factory = handle as { create(key?: string): unknown };
      instance = record.scope === "root" ? factory.create() : factory.create(key);
      record.instances.set(key, instance);
    }
    return instance;
  }

  private resolveFactoryStore(definition: never, binding: { key?: string } | undefined, occurrence: object): unknown {
    const def = definition as { name: string; scope: string; store?: unknown };
    if (!this.core.isFactoryLive(definition)) throw new Error(`slot factory "${def.name}" is not registered`);
    if (def.store === undefined) return undefined;
    if (typeof def.store !== "function") return this.resolveStore(def.store, binding);
    const axis = this.factoryStores.get(definition as object);
    if (axis === undefined) throw new Error(`factory "${def.name}" store axis is not initialized`);
    const scopeKey = def.scope === "root" ? "root" : requireKey(def, binding);
    if (binding !== undefined && def.scope !== "root") this.bindStoreScope(binding as never);
    let record = axis.occurrences.get(occurrence);
    if (record === undefined) {
      const handle = (def.store as () => { create(key?: string): unknown })();
      record = { handle, instances: new Map(), retainers: 0 };
      axis.occurrences.set(occurrence, record);
    }
    const existing = record.instances.get(scopeKey);
    if (existing !== undefined) return existing;
    const factory = record.handle as { create(key?: string): unknown };
    const instance = def.scope === "root" || binding === undefined ? factory.create() : factory.create(binding.key);
    record.instances.set(scopeKey, instance);
    return instance;
  }

  private retainOccurrence(definition: never, occurrence: object): () => void {
    const def = definition as { store?: unknown };
    if (!this.core.isFactoryLive(definition) || typeof def.store !== "function") return () => {};
    const axis = this.factoryStores.get(definition as object);
    const record = axis?.occurrences.get(occurrence);
    if (axis === undefined || record === undefined) return () => {};
    record.retainers += 1;
    axis.mounted.set(occurrence, record);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      record.retainers -= 1;
      if (record.retainers === 0) axis.mounted.delete(occurrence);
    };
  }

  private bindStoreScope(binding: { key: string; ctx: unknown }): void {
    const current = this.storeScopeOwners.get(binding.key);
    if (current === binding.ctx) return;
    if (current !== undefined) this.releaseStoreScope(binding.key);
    this.storeScopeOwners.set(binding.key, binding.ctx);
  }

  private releaseStoreScope(key: string): void {
    for (const record of this.stores.values()) {
      if (record.scope === "root") continue;
      record.instances.delete(key);
    }
    for (const axis of this.factoryStores.values()) {
      for (const record of axis.mounted.values()) record.instances.delete(key);
    }
  }

  private acquire(handle: unknown, scope: string): void {
    const record = this.stores.get(handle as object);
    if (record === undefined) {
      this.stores.set(handle as object, { scope, refs: 1, instances: new Map() });
      return;
    }
    record.refs += 1;
  }

  private release(handle: unknown): void {
    const record = this.stores.get(handle as object);
    if (record === undefined) return;
    record.refs -= 1;
    if (record.refs !== 0) return;
    this.stores.delete(handle as object);
  }

  private scopeRevision = 0;

  private readonly scopeRevisionListeners = new Set<() => void>();
}

export type { StoredEntry, StoredFactory };

function requireKey(definition: { name: string; scope: string }, binding: { key?: string } | undefined): string {
  if (binding?.key === undefined) throw new Error(`${definition.scope} factory store resolution requires a session id`);
  return binding.key;
}
