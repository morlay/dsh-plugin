// `slots` 的自己实现：核心是上游 `SlotCore`（纯逻辑、不依赖 ctx），生命周期挂在我们行的 `effect` 上。
//
// 不继承上游 `SlotRegistry` 的原因：它是 cordis `Service`，构造期就 `ctx.reflect.provide`，
// 与我们的行作用域发布模型冲突（`onInit` 之前消费方读到的是空壳）。
import type { SlotComponent, SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotRegistry, SlotRenderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
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
import { Injectable, Logger, inject, type Context, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";

type AnyKey = string;

@Injectable()
export class SlotsDefault extends Slots implements OnInit {
  /** 行日志：`inject` 的"位置从没声明"必须留痕，不能只让渲染结果空着。 */
  private readonly logger = inject(Logger);
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
    // 位置调度我们自己实现（接口与上游 `SlotRenderer` 一致）；样式与交互仍由上游组件自带。
    // **用上游渲染器**：keyed 位置的 `entryKey`、`session`/`session-maybe` 的 scope kit
    // （`useSession` / `SessionProvider`）、factory 渲染、locale 的 `t`，上游都实现了。
    // 自写的那份一直在补这些漏（`main` 永远渲染第一个条目、`useSession is not a function`），
    // 补一漏三——直接用上游的 `SlotRenderer`，`SlotsDefault` 只提供宿主面。
    this.install(createSlotRenderer());
  }

  /**
   * 我们的 `effect` 面：注册一个**同步** disposer 并拿回同步的 undo。
   *
   * cordis 的 `ctx.effect()` 返回 `AsyncDisposable`（既是 thenable 又能当函数调），所以直接用会让
   * 每次 `undo()` 的返回类型变成 `Awaitable<void>`；这里的 disposer 都是同步的，包一层收窄，
   * 顺带把 `undo()` 的返回值丢掉（它只是 disposer 自己的返回值，不是要 await 的清理）。
   */
  private get effect(): (body: () => (() => void) | Iterable<() => void>) => () => void {
    if (this.ctx === undefined) throw new Error("slots 未初始化：装配顺序错误（onInit 之前被调用）");
    const effect = this.ctx.effect.bind(this.ctx);
    return (body) => {
      const disposable = effect(body);
      return () => {
        void disposable();
      };
    };
  }

  entries(key: AnyKey): readonly StoredEntry[] {
    return this.core.entries(key as never);
  }

  entriesOfSlot(key: AnyKey): readonly StoredEntry[] {
    return this.core.entriesOfSlot(key as never);
  }

  getVersion(key: string): number {
    return this.core.getVersion(key);
  }

  snapshot(root?: string): LiveCompositionNode[] {
    return this.core.snapshot(root);
  }

  subscribe(key: AnyKey, fn: () => void): () => void {
    return this.core.subscribe(key as never, fn);
  }

  register<K extends keyof SlotMap>(
    options: Omit<Parameters<SlotRegistry["register"]>[0], "name"> & { readonly name: K },
    component: SlotComponent<never>,
  ): () => void {
    return this.mountSlot(options, component);
  }

  registerDynamic(options: Record<string, unknown>, component: unknown): () => void {
    return this.mountSlot(options, component);
  }

  /** `register` / `registerDynamic` 的共同体：类型化入口只在签名上做 key 校验，装配逻辑只有这一份。 */
  private mountSlot(options: unknown, component: unknown): () => void {
    const dispose = this.core.register(options as never, component as never);
    const store = (options as { store?: unknown }).store;
    if (store !== undefined && typeof store !== "function") this.acquire(store, String((options as { scope?: string }).scope ?? "root"));
    const undo = this.effect(() => dispose);
    return () => {
      undo();
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
      undo();
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

  installScope(
    scope: Exclude<SlotScope, "root" | "session-maybe">,
    adapter: SlotScopeAdapter,
  ): () => void {
    if (this.scopes.has(scope)) throw new Error(`slot scope '${scope}' already has an adapter`);
    const undo = this.effect(() => {
      this.scopes.set(scope, adapter);
      return () => {
        if (this.scopes.get(scope) === adapter) this.scopes.delete(scope);
      };
    });
    return () => {
      undo();
    };
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
      undo();
    };
  }

  inject(key: AnyKey, callback: () => (() => void) | Iterable<() => void>): () => void {
    const undo = this.effect(() => {
      let dispose: (() => void) | undefined;
      // 位置声明可能晚于调用方（父行注册 children 的时机不由我们定）：订阅声明变化、就绪即装。
      const reconcile = (): void => {
        if (dispose !== undefined) return;
        if (this.core.specDynamic(key as never) === undefined) return;
        dispose = this.effect(callback);
      };
      const unsubscribe = this.core.subscribeDeclaration(key as never, reconcile);
      reconcile();
      return () => {
        unsubscribe();
        dispose?.();
      };
    });
    return () => {
      undo();
      // **不静默**：这一行到死都没等到位置声明 → 它的贡献一次都没装上（表现只有"渲染空"）。
      // 上游的 `ui-sidebar` / `ui-workspace` 全走这条路径，静默就等于"侧栏少一半还查不出原因"。
      if (this.core.specDynamic(key as never) === undefined) {
        this.logger.warn(
          `[slots] 位置 "${String(key)}" 从未被声明：等它的注册没有发生（检查父行 register 的 children 里有没有这一条）`,
        );
      }
    };
  }

  scope(scope: string): unknown {
    return this.scopes.get(scope === "session-maybe" ? "session" : scope);
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
    console.debug(`[slots] renderRoot entries=${this.core.entries("root" as never).length}`);
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
      for (const listener of Array.from(rootListeners)) listener();
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
      // **不能恒 false**：`renderSlot` 会先校验 factory 是否还活着，恒 false 会让所有 factory 位置
      // 抛 `StaleAuthorizationError`（`ui-conversation` 的 `conversation.content` 就是 factory，
      // 被它挡住的直接后果是主区不渲染输入框）。
      isFactoryLive: (definition: never) => core.isFactoryLive(definition),
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
