import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { Context as ZephyrContext } from "./injection.ts";

export class APIGroup {
  private constructor(
    readonly group: string,
    readonly version: string,
  ) {}

  static create(group: string, version: string): APIGroup {
    // 无缓存：`APIGroup` 只是 `group`/`version` 的不可变描述，实例相等性不承载语义，
    // 不需要在模块上持有状态。
    return new APIGroup(group, version);
  }

  withKind(kind: string): string {
    return `${kind}.${this.group}/${this.version}`;
  }
}

// 事件的参数是元组：`input<[Session, SessionEvent]>("session/event")` 与上游 `Events` 的签名同形，
// 多参数事件不用把 payload 折成一个对象。
export interface EventConsumer<Args extends unknown[] = []> {
  readonly type: string;

  /** 手动绑定行 ctx（Provider 字段会自动绑定；cordis 插件在构造里用它）。 */
  bind(ctx: ZephyrContext): void;

  on(listener: (...args: [...Args, () => any]) => any): () => boolean;

  once(listener: (...args: [...Args, () => any]) => any): () => boolean;
}

export interface EventProducer<Args extends unknown[] = []> {
  readonly type: string;

  /** 手动绑定行 ctx（Provider 字段会自动绑定；cordis 插件在构造里用它）。 */
  bind(ctx: ZephyrContext): void;

  emit(...args: Args): void;

  parallel(...args: Args): Promise<void>;

  serial(...args: Args): Promise<any>;

  bail(...args: Args): any;

  waterfall(...args: [...Args, (value: any) => any]): any;
}

export function input<Args extends unknown[] = []>(
  group: APIGroup,
  kind: string,
): EventConsumer<Args>;
export function input<Args extends unknown[] = []>(type: string): EventConsumer<Args>;
export function input<Args extends unknown[] = []>(
  groupOrType: APIGroup | string,
  kind?: string,
): EventConsumer<Args> {
  return new _EventEmitter<Args>(resolveType(groupOrType, kind));
}

export function output<Args extends unknown[] = []>(
  group: APIGroup,
  kind: string,
): EventProducer<Args>;
export function output<Args extends unknown[] = []>(type: string): EventProducer<Args>;
export function output<Args extends unknown[] = []>(
  groupOrType: APIGroup | string,
  kind?: string,
): EventProducer<Args> {
  return new _EventEmitter<Args>(resolveType(groupOrType, kind));
}

export abstract class EventEmitter {
  abstract readonly type: string;
}

// cordis 的 `Events` 是闭合接口（只认自己声明过的事件名），而 dsh 总线允许自由字符串事件：
// 桥接只在这一层做一次，`Args` 元组由调用方（或 `keyof Events` 重载）负责。
type LooseEvents = {
  on(name: string, listener: (...args: any[]) => any): () => boolean;
  once(name: string, listener: (...args: any[]) => any): () => boolean;
  emit(name: string, ...args: any[]): void;
  parallel(name: string, ...args: any[]): Promise<void>;
  serial(name: string, ...args: any[]): Promise<any>;
  bail(name: string, ...args: any[]): any;
  waterfall(name: string, ...args: any[]): any;
};

function resolveType(groupOrType: APIGroup | string, kind?: string): string {
  if (typeof groupOrType === "string") return groupOrType;
  if (kind === undefined)
    throw new Error("kind is required when the event type comes from APIGroup");
  return groupOrType.withKind(kind);
}

class _EventEmitter<Args extends unknown[]> extends EventEmitter {
  readonly type: string;

  #ctx: CordisContext | undefined;

  constructor(type: string) {
    super();
    this.type = type;
  }

  bind(ctx: ZephyrContext) {
    this.#ctx = ctx as unknown as CordisContext;
  }

  #requireCtx(): CordisContext {
    if (!this.#ctx) {
      throw new Error("EventEmitter is not bound, use it in onInit() or later");
    }
    return this.#ctx;
  }

  on(listener: (...args: [...Args, () => any]) => any): () => boolean {
    return this.#events().on(this.type, listener);
  }

  once(listener: (...args: [...Args, () => any]) => any): () => boolean {
    return this.#events().once(this.type, listener);
  }

  emit(...args: Args): void {
    this.#events().emit(this.type, ...args);
  }

  parallel(...args: Args): Promise<void> {
    return this.#events().parallel(this.type, ...args);
  }

  serial(...args: Args): Promise<any> {
    return this.#events().serial(this.type, ...args);
  }

  bail(...args: Args): any {
    return this.#events().bail(this.type, ...args);
  }

  waterfall(...args: [...Args, (value: any) => any]): any {
    return this.#events().waterfall(this.type, ...args);
  }

  #events(): LooseEvents {
    return this.#requireCtx().events as unknown as LooseEvents;
  }
}
