// `@View`：位置（契约）与视图（实现）的唯一写法——它就是 `@Injectable` 的语法糖。
//
//   @View({ name: "main" })                abstract class MainView {}     // 位置（可带 locale/scoped/many）
//   @View({ name: "main", root: true })    class LayoutView {             // 根位置（占据者）
//     main = View.seat(MainView);                                         // 声明 + 渲染，同一份
//     contents = View.seat.all(ContentView);
//     private readonly sessions = inject(SessionController);                       // 依赖就是 @Injectable 的字段注入
//   }
//   @View({ order: 200, id: "pin" })       class PinItem extends MainView {}   // list 位置的贡献元数据
//   @View()                                class DemoView extends MainView {}  // 贡献：位置由 extends 决定
//
// 语义边界：`provideRoot` / `installScope` / 上游注册项的 `inject` **不在这里**——
// 那是服务与上游插件的事（`@View` 管位置与视图，不管数据面）。
import type { ComponentType, ReactElement, ReactNode } from "react";
import { createContext, createElement, useContext } from "react";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";

/** `@View` 的选项。 */
export interface ViewOptions {
  /** 位置名（上游 slot 名）。省略取类名——只有**位置**类该写它。 */
  readonly name?: string;
  /** 根位置：由装配层挂到渲染树根（`layout` 那一层）。 */
  readonly root?: boolean;
  /** 位置属于 session scope。 */
  readonly scoped?: boolean;
  /** 贡献在这条 list 位置上的身份（上游 `register({ id })`）。 */
  readonly id?: string;
  /** 贡献在这条 list 位置上的顺序（数值小的先渲染）。 */
  readonly order?: number;
  /** 位置/贡献的 locale namespace。 */
  readonly locale?: string;
}

const kView = Symbol.for("zephyr.view");
const kOriginal = Symbol.for("zephyr.view-original");
const kInstance = Symbol.for("zephyr.view-instance-holder");
const kComponent = Symbol.for("zephyr.view-component");

/** 位置/贡献的元数据（按原型链查找）。 */
interface ViewMeta {
  readonly options: ViewOptions;
  /** 抽象类 = 位置；具体类 = 贡献（或 `root: true` 的占据者）。 */
  readonly isPosition: boolean;
}

/** 位置类（`@View` 装饰过的抽象类）。 */
export type ViewClass = abstract new (...args: never[]) => unknown;

/** 原型链上最近的 `@View` 元数据。 */
function metaOf(target: unknown): ViewMeta | undefined {
  // 三条链：① 类自身的 `kView`；② 装饰器包装出的装配类的 `kView`（`withRegistration` 写在两边）；
  // ③ `kOriginal` 指回被包装的原类（`this.constructor` 是装配类时走这条）。
  let current = target as { [kView]?: ViewMeta; [kOriginal]?: unknown; prototype?: unknown } | null;
  while (current !== null && current !== undefined) {
    const found = current[kView];
    if (found !== undefined) return found;
    const original = current[kOriginal];
    if (original !== undefined) {
      const meta = metaOf(original);
      if (meta !== undefined) return meta;
    }
    current = Object.getPrototypeOf(current) as typeof current;
  }
  return undefined;
}

/**
 * 位置名：位置类自己的 `name`，没有就是类名。
 * @param position - 位置类。
 * @returns 上游 slot 名。
 */
export function positionNameOf(position: ViewClass): string {
  const meta = metaOf(position);
  return meta?.options.name ?? (position as unknown as { name: string }).name;
}

/** 渲染期上下文：渲染器在 `renderRoot` 时提供。 */
export interface ViewRenderScope {
  readonly renderSlot: (name: string, owner?: object) => ReactNode;
  readonly ownerProps: object;
}

/** 渲染期上下文。 */
export const ViewScope = createContext<ViewRenderScope | null>(null);

/** 一个 seat：既是声明（登记了位置类），也能直接放进 JSX。 */
export type SeatRef = ReactElement;

/** seat 元素 → 它声明的位置（React 的元素是 frozen，不能挂属性，用 WeakMap）。 */
const seatRegistry = new WeakMap<object, { readonly position: ViewClass; readonly many: boolean }>();

/** `View.seat` / `View.seat.all` 渲染出来的组件。 */
function Seat({ position }: { position: ViewClass }): ReactNode {
  const scope = useContext(ViewScope);
  if (scope === null) return null;
  return scope.renderSlot(positionNameOf(position), scope.ownerProps);
}

/**
 * 造一个 seat：**声明与渲染是同一份**（装配时扫实例字段得到位置声明，渲染时它就是 ReactNode）。
 * @param position - 子位置类。
 * @param many - 是否是 list 位置。
 * @returns 带位置类的元素。
 */
function seatOf(position: ViewClass, many: boolean): SeatRef {
  const element = createElement(Seat, { position });
  seatRegistry.set(element, { position, many });
  return element;
}

/** `View.seat(X)`：声明一个子位置并渲染它。 */
function seat(position: ViewClass): SeatRef {
  return seatOf(position, false);
}

/** `View.seat.all(X)`：声明一条 list 子位置并渲染它。 */
seat.all = (position: ViewClass): SeatRef => seatOf(position, true);

/** 装饰器 + 位置工具。 */
export const View = Object.assign(
  (options: ViewOptions = {}) =>
    (target: unknown): unknown => {
      const ctor = target as new () => object;
      const isPosition = typeof (ctor as { prototype: { render?: unknown } }).prototype.render !== "function";
      Object.defineProperty(ctor, kView, {
        value: { options, isPosition } satisfies ViewMeta,
        configurable: true,
      });
      // 装饰器**自己**把视图变成 provider：不需要每个类都 `extends ViewBase`。
      // `onInit` 也由这里补上（注册到自己的位置）。
      const wired = isPosition ? ctor : withRegistration(ctor);
      Injectable()(wired);
      if (!isPosition) {
        Object.defineProperty(wired, kComponent, { value: viewComponentOf(wired), configurable: true });
      }
      Object.defineProperty(wired, kView, { value: { options, isPosition }, configurable: true });
      // **返回**装配类：`providers: [LayoutView]` 拿到的必须是有 `onInit` 的那个。
      return wired;
    },
  { seat },
) as unknown as {
  (options?: ViewOptions): (target: unknown) => void;
  seat: { (position: ViewClass): SeatRef; all(position: ViewClass): SeatRef };
};

/**
 * 给视图类补上 `onInit`（把贡献注册到它的位置）与 `slots`/`viewProps` 字段。
 *
 * 这样视图类**不需要** `extends ViewBase`——装饰器自己完成接线。
 * @param ctor - 视图类。
 * @returns 装配后的子类（保持 `extends` 关系）。
 */
function withRegistration(ctor: new () => object): new () => object {
  const registered = class Registered extends (ctor as new () => object) implements OnInit {
    /** 槽注册表：`inject()` 是**登记式**的（构造期登记、`resolvePending` 统一解析），所以必须是字段。 */
    protected readonly slots = inject(Slots);

    /** 上游位置渲染时传下来的 owner props。 */
    protected viewProps: unknown;

    onInit(): void {
      // 渲染期要用的就是**这个**实例（`construct` + `resolvePending` 已经把字段换成真依赖）。
      Object.defineProperty(this.constructor, kInstance, { value: this, configurable: true });
      Object.defineProperty(
        (this.constructor as { [kOriginal]?: unknown })[kOriginal] ?? this.constructor,
        kInstance,
        { value: this, configurable: true },
      );
      const slots = this.slots;
      const registration = viewRegistrationOf(this.constructor);
      if (registration === undefined) return;
      const children = childrenOfView(this);
      slots.inject(registration.name as never, () =>
        slots.register(
          {
          ...registration.options,
          name: registration.name,
          ...(children === undefined ? {} : { children }),
        } as never,
          registration.component as never,
        ),
      );
    }
  };
  // 装配类指回原类：`metaOf`/`viewRegistrationOf` 靠它找到 `@View` 元数据。
  Object.defineProperty(registered, kOriginal, { value: ctor, configurable: true });
  return registered as unknown as new () => object;
}

/** 把一个视图类包成 React 组件（每次渲染读实例，注入在构造期就位）。 */
function viewComponentOf(ctor: new () => object): ComponentType<object> {
  return (props) => {
    const instance = instanceOf(ctor);
    (instance as { viewProps?: unknown }).viewProps = props;
    return (instance as unknown as { render(): ReactElement }).render();
  };
}

/**
 * 取一个视图类的实例（懒建）。
 * @param ctor - 视图类。
 * @returns 实例。
 */
/**
 * 一个视图类的实例来源：容器登记过就是 `"container"`，否则 `"missing"`。
 * @param ctor - 视图类。
 * @returns 来源标记（接缝测试用它断言「视图确实被装配成 provider」）。
 */
export function instanceSourceOf(ctor: new () => object): "container" | "missing" {
  const registered = (ctor as { [kInstance]?: object })[kInstance]
    ?? (ctor as { [kOriginal]?: { [kInstance]?: object } })[kOriginal]?.[kInstance];
  return registered === undefined ? "missing" : "container";
}

export function instanceOf(ctor: new () => object): object {
  // 装配期登记过的 provider 实例优先：它的 `inject` 占位符已被 `resolvePending` 换成真依赖。
  const registered = (ctor as { [kInstance]?: object })[kInstance]
    ?? (ctor as { [kOriginal]?: { [kInstance]?: object } })[kOriginal]?.[kInstance];
  if (registered !== undefined) return registered;
  // **不兜底新建**：渲染期 `new` 出来的实例，`inject()` 的占位符没人解析，行为会静默错。
  // 直接报错，让「视图没被装配成 provider」这件事在第一次渲染就暴露。
  throw new Error(
    `[view] ${(ctor as { name: string }).name} 不是装配好的 provider：检查它（或它的父类位置）是否在某个 provide(...) 的清单里`,
  );
}

/** 扫一个视图实例上的 seat 字段 → 上游 `register({ children })` 的表。 */
export function childrenOfView(instance: object): Record<string, { kind: "single" | "list"; scope?: "root" | "session" }> | undefined {
  const table: Record<string, { kind: "single" | "list"; scope?: "root" | "session" }> = {};
  for (const value of Object.values(instance as Record<string, unknown>)) {
    const seatRef = seatRegistry.get(value as object);
    if (seatRef === undefined) continue;
    const meta = metaOf(seatRef.position);
    table[positionNameOf(seatRef.position)] = {
      // `View.seat.all` 就是 list——位置类上不用再写 `many`。
      kind: seatRef.many ? "list" : "single",
      ...(meta?.options.scoped === true ? { scope: "session" as const } : { scope: "root" as const }),
    };
  }
  return Object.keys(table).length === 0 ? undefined : table;
}

/**
 * 可选的视图基类：只提供 `viewProps` 字段。
 *
 * 注册由 `@View` 装饰器自己完成（`withRegistration`），所以**不需要**继承它——
 * 保留它是为了「视图想自己写 `onInit` 时有一个共同的父类」。
 */
export abstract class ViewBase {
  /** 上游位置渲染时传下来的 owner props。 */
  protected viewProps: unknown;
}

/** 一个视图类的注册信息（位置名 + 组件 + list 元数据）。 */
export function viewRegistrationOf(cls: unknown):
  | { name: string; component: ComponentType<object>; options: { id?: string; order?: number; locale?: string } }
  | undefined {
  const meta = metaOf(cls);
  if (meta === undefined || meta.isPosition) return undefined;
  const component = (cls as { [kComponent]?: ComponentType<object> })[kComponent];
  if (component === undefined) return undefined;
  // 自己写了 `name` 的贡献/根位置：位置就是它自己（占据者）；否则看 `extends` 的位置类。
  const own = meta.options.name;
  // `cls` 可能是装配类（`withRegistration` 返回的子类）：先还原到原类，再取它的父类当位置。
  const original = (cls as { [kOriginal]?: unknown })[kOriginal] ?? cls;
  const position = Object.getPrototypeOf(original) as unknown as ViewClass;
  return {
    name: own ?? positionNameOf(position),
    component,
    options: {
      // keyed 位置（`main` 等）要 `key`，list 位置要 `id`：`@View({ id })` 两处都映射。
      ...(meta.options.id === undefined ? {} : { id: meta.options.id, key: meta.options.id }),
      ...(meta.options.order === undefined ? {} : { order: meta.options.order }),
      ...(meta.options.locale === undefined ? {} : { locale: meta.options.locale }),
    },
  };
}
