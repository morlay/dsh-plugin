// `@SlotProvider` / `@SlotView`：按 Angular 的组件模型组织 slot 贡献。
//
// - `@SlotProvider({ name, multi, scoped })` 声明**一个位置**（抽象类，`name` 兼容上游的 slot 名）；
// - `@SlotView()` 标记 `extends <位置>` 的视图类，实现 `render()`；
// - **位置由类型决定**（`extends XSlot`），没有手写 slot 字符串；视图只实现 `render()`，不碰 `slots` 服务。
import type { ComponentType, ReactNode } from "react";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";
import { applySlotDeclaration, Slot } from "./slot.decorator.ts";

/** 一个位置类（`@SlotProvider` 装饰过的抽象类）：视图用它做**类型**关联。 */
export type SlotProviderClass = abstract new (...args: never[]) => unknown;

/** 一个视图位置：`name` 是上游 slot 名，`multi` 决定同位置能否有多个，`scoped` 表示它属于 session scope。 */
export interface SlotProviderOptions {
  /** 上游 slot 名（`"sidebar.left"`、`"conversation.chat.flow"`…）。 */
  readonly name: string;
  /** 同位置是否允许多个视图（对应上游 `kind: "list"`）。 */
  readonly multi?: boolean;
  /** 是否属于 session scope（对应上游 `scope: "session"`）。 */
  readonly scoped?: boolean;
  /** keyed 位置必填：这个视图占哪个 key（对应上游 `register({ name, key })`）。 */
  readonly key?: string;

}

const kSlotProvider = Symbol.for("zephyr.slot-provider");
const kSlotView = Symbol.for("zephyr.slot-view");

/** 视图类 → 它在 `App` 里的实例（装配期由 `SlotViews.install` 解析一次）。 */
const instances = new WeakMap<object, SlotViewImpl>();

const kViewInstance = Symbol.for("zephyr.slot-view-instance");

function appOf(view: unknown): SlotViewImpl {
  const instance = (view as { [kViewInstance]?: SlotViewImpl })[kViewInstance];
  if (instance === undefined) throw new Error("视图还没装配：`onInit` 之前就渲染了");
  return instance;
}

/**
 * 视图基类：`onInit` 里把**自己**注册到 `extends` 的那个位置上。
 *
 * 位置由类型决定（原型链上最近的 `@SlotProvider`），所以视图类里没有 slot 字符串、
 * 也不需要任何装配代码——声明（装饰器）与注册（基类）各归各位。
 */
export abstract class SlotViewBase implements OnInit {
  private readonly slots = inject(Slots);

  /** 上游位置渲染时传下来的 owner props（`render()` 里按需读）。 */
  protected viewProps: unknown;

  /**
   * 本视图占据的位置所**声明**的子位置（位置类数组，不是字符串表）。
   *
   * 对应上游 `register({ children })`：占据者声明位置族，别的包对 `sidebar.panellist`
   * 之类的贡献才挂得进来。写**类**而不是名字——名字由位置类自己的 `@SlotProvider` 决定。
   */
  protected readonly seats: readonly SlotProviderClass[] = [];

  /**
   * 渲染一个**子位置**（用位置**类**关联，不写 slot 字符串）。
   *
   * 位置类就是 `@SlotProvider` 声明的那个抽象类——它带着名字与 kind，视图只引用类型。
   * @param position - 子位置的位置类（必须在本视图的 `children` 里声明过）。
   * @returns 该位置的渲染结果。
   */
  protected child(position: SlotProviderClass): ReactNode {
    const resolved = providerOf(position);
    if (resolved === undefined) {
      throw new Error(
        `${(this.constructor as { name: string }).name}.child(${(position as { name?: string }).name})：位置类没有 @SlotProvider`,
      );
    }
    // 位置渲染时渲染器注入的 `renderSlot`（渲染**子位置**）；没有它说明这个视图不是被 slot 渲染的。
    const render = (this.viewProps as { renderSlot?: (child: string) => ReactNode } | undefined)?.renderSlot;
    if (render === undefined) return null;
    return render(resolved.name);
  }

  onInit(): void {
    const resolved = slotViewOf(this.constructor);
    if (resolved === undefined) {
      // `@SlotView` 没生效（或类被复制成两份）：装配期直接报错，不留静默空态。
      throw new Error(
        `@SlotView 的 ${(this.constructor as { name: string }).name} 缺少 slotComponent：装饰器未生效（模块双实例？）`,
      );
    }
    // 装配观测（debug 级别）：视图注册到哪个位置、位置是否已声明。
    console.debug(
      `[slot-view] ${(this.constructor as { name: string }).name} → ${resolved.name}; entries=${this.slots.entries(resolved.name as never).length}`,
    );
    // 包装组件渲染时要用这个实例：挂在**类上**（模块级 WeakMap 在双实例下不共享）。
    Object.defineProperty(this.constructor, kViewInstance, { value: this, configurable: true });
    // keyed 位置用 `key`、list 位置用 `id`：都来自 `@SlotProvider` 声明（视图类里不写 slot 细节）。
    const options = {
      name: resolved.name,
      ...(resolved.children === undefined ? {} : { children: resolved.children }),
      ...(resolved.key === undefined ? {} : { key: resolved.key, id: resolved.key }),
    };
    // `seats` 只在实例上：注册时把它变成位置声明（`register({ children })`）。
    const children = childrenOf(this);
    const undo = this.slots.inject(resolved.name as never, () => {
      // 注册真正落地的观测（`inject` 等位置声明就绪后才执行）。
      console.debug(`[slot-view] registered ${String(resolved.name)}`);
      return this.slots.register(
        (children === undefined ? options : { ...options, children }) as never,
        resolved.component as never,
      );
    });
    this.disposeRegistration = () => {
      undo();
    };
  }

  private disposeRegistration: (() => void) | undefined;

  onDispose(): void {
    this.disposeRegistration?.();
    this.disposeRegistration = undefined;
  }
}

/** 视图基类要实现的唯一方法。 */
export interface SlotViewImpl {
  render(): ReactNode;
}

/**
 * 声明一个视图位置。抽象类本身只承载 `name` 与类型身份——`extends` 它的类就是往这个位置提供的视图。
 * @param options - 位置的名字与语义。
 * @returns 类装饰器（用在抽象类上）。
 */
export function SlotProvider(options: SlotProviderOptions): ClassDecorator {
  return (target) => {
    Object.defineProperty(target, kSlotProvider, { value: options, configurable: true });
    // 上游兼容：位置名同时作为静态 `name`（`slots.register({ name })` 用它）。
    Object.defineProperty(target, "name", { value: options.name, configurable: true });
    Injectable()(target);
  };
}

/**
 * 视图类声明的子位置（`seats`）→ 上游 `register({ children })` 的表。
 *
 * 名字与 kind 都来自位置类自己的 `@SlotProvider`；视图只写类。
 * @param cls - 视图类。
 * @returns 子位置表；没有声明时 `undefined`。
 */
function childrenOf(target: unknown): Record<string, { kind: "single" | "keyed" | "list" | "chain"; scope?: "root" | "session" | "session-maybe" }> | undefined {
  // `seats` 是视图**实例**上的字段（类字段在构造时赋值，原型上没有）。
  const seats = (target as { seats?: readonly SlotProviderClass[] }).seats;
  if (seats === undefined || seats.length === 0) return undefined;
  const table: Record<string, { kind: "single" | "keyed" | "list" | "chain"; scope?: "root" | "session" | "session-maybe" }> = {};
  for (const seat of seats) {
    const options = providerOf(seat);
    if (options === undefined) {
      throw new Error(
        `${String((target as { constructor?: { name?: string } }).constructor?.name)}.seats 里的位置类缺少 @SlotProvider`,
      );
    }
    table[options.name] = {
      kind: options.multi === true ? "list" : "single",
      scope: options.scoped === true ? "session" : "root",
    };
  }
  return table;
}

/** 把一个视图类登记到它 `extends` 的位置上（位置由原型链上最近的 `@SlotProvider` 决定）。 */
function providerOf(cls: unknown): SlotProviderOptions | undefined {
  let current = cls as { [kSlotProvider]?: SlotProviderOptions; prototype?: unknown } | null;
  while (current !== null && current !== undefined) {
    const found = current[kSlotProvider];
    if (found !== undefined) return found;
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return undefined;
}

/**
 * 标记一个视图类：它 `extends` 的位置就是它出现的地方，`render()` 就是它的内容。
 *
 * 装配时包装成 React 组件（每次挂载 new 一个视图实例，`inject` 的依赖在构造期就位）注册到上游 slot。
 */
export function SlotView(): ClassDecorator {
  return (target) => {
    const provider = providerOf(target);
    if (provider === undefined) {
      throw new Error(`@SlotView 的类必须 extends 一个 @SlotProvider 抽象类（${(target as { name: string }).name}）`);
    }
    Object.defineProperty(target, kSlotView, { value: { provider }, configurable: true });
    // 包装成上游认的 React 组件：视图类本身就是一个 Provider（`inject()` 在它构造期就位），
    // 渲染时从 `app` 取那**一个**已装配的实例，调它的 `render()`。
    const Component: ComponentType = (props: unknown) => {
      const instance = appOf(target) as SlotViewImpl;
      // owner props 透传给视图（`render()` 里用 `this.viewProps` 读）：上游 `AppFrame` 的
      // 位置渲染会带位置专属的 props，丢掉它们会让视图渲染成空内容。
      (instance as unknown as { viewProps: unknown }).viewProps = props;
      // `render()` 已经返回 React 元素：直接交回即可。
      // 之前用 `createElement(render.bind(...))` 是把方法当成新组件类型，React 每次渲染都当作新 type
      // 卸载重建，子树里的内容会被整体替换掉。
      return instance.render() as never;
    };
    Object.defineProperty(Component, "name", { value: (target as { name: string }).name });
    // 把包装组件挂到类上，供 `@Slot` 的应用期读取。
    Object.defineProperty(target, "slotComponent", { value: Component, configurable: true });
    Injectable()(target);
  };
}

/** 读一个视图类对应的上游 slot 名与包装组件（`@Slot` 行用它生成 register 调用）。 */
export function slotViewOf(cls: unknown):
  | {
      name: string;
      key?: string;
      component: ComponentType;
      children?: Record<string, { kind: "single" | "keyed" | "list" | "chain"; scope?: "root" | "session" | "session-maybe" }>;
    }
  | undefined {
  const view = (cls as { [kSlotView]?: { provider: SlotProviderOptions } })[kSlotView];
  const component = (cls as { slotComponent?: ComponentType }).slotComponent;
  if (view === undefined || component === undefined) return undefined;
  const children = childrenOf(cls);
  return {
    name: view.provider.name,
    ...(children === undefined ? {} : { children }),
    ...(view.provider.key === undefined ? {} : { key: view.provider.key }),
    component,
  };
}

/**
 * 把一组视图注册进它们的声明位置（父决定位置：把子视图类列在这里）。
 *
 * 每个视图的位置来自它 `extends` 的 `@SlotProvider`——**没有手写 slot 字符串**。
 */
@Injectable()
export class SlotViews implements SlotViewImpl {
  private readonly slots = inject(Slots);


  render(): ReactNode {
    return null;
  }

  /** 应用：把每个视图注册到它自己的位置（`inject: true`：等位置被声明）。 */
  install(views: readonly unknown[]): () => void {
    const undo: (() => void)[] = [];
    for (const view of views) {
      // 视图类本身就是 Provider：`app.get` 拿它**一个**已装配的实例（依赖在它构造期已就位）。
      instances.set(view as object, inject(view as never) as SlotViewImpl);
      const resolved = slotViewOf(view);
      if (resolved === undefined) throw new Error("不是 @SlotView：没有可注册的组件");
      const options = {
        name: resolved.name,
        ...(resolved.key === undefined ? {} : { key: resolved.key }),
      };
      undo.push(
        this.slots.inject(resolved.name as never, () =>
          this.slots.register(options as never, resolved.component as never),
        ),
      );
    }
    return () => {
      for (const dispose of [...undo].reverse()) dispose();
    };
  }
}

export type { Context };
export { applySlotDeclaration, Slot };
