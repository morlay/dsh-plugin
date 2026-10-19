// `@Slot({...})`：一行往 slot 里贡献什么，写在**声明处**，装配时自动应用。
//
// 它同时是 `@Injectable()`：声明了 slot 贡献的类就是一行 provider，不需要再叠一个装饰器。
// 应用逻辑由装饰器接管（包在 `onInit` 外层），调用方不再手写 `applySlotDeclaration`。
import { Injectable, inject, type Context, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";

/**
 * `@Slot` 的 options：**只放与注入无关的静态贡献**（值本身在声明期就确定）。
 *
 * 需要 `inject()` 的贡献写成类方法（与 `@SlotView.render()` 同一口径）：
 * `slotRoot()` / `slotScope()` / `slotLocale()` / `slotRegistrations()` / `slotFactories()`。
 */
export interface SlotDeclaration {
  /** 装 locale 面（`installLocale`，`ui-locale` 行）。 */
  readonly locale?: Parameters<Slots["installLocale"]>[0];
  /** 装 scope adapter（`installScope`，如 `ui-session` 的 `session`）。 */
  readonly scope?: Readonly<Record<string, Parameters<Slots["installScope"]>[1]>>;
  /** 贡献 root 标准源（`provideRoot`，可多条）。**不含注入**：要读注入的写 `slotRoot()` 方法。 */
  readonly root?:
    | Parameters<Slots["provideRoot"]>[0]
    | readonly Parameters<Slots["provideRoot"]>[0][];
  /** 注册组件（`register` / `inject` + `register`）。 */
  readonly register?: readonly SlotRegistration[];
  /** 注册组件工厂（`registerFactory` / `inject` + `registerFactory`）。 */
  readonly registerFactory?: readonly SlotFactoryRegistration[];
}

/** 需要注入的贡献：写在类方法里（`this` 上已有注入的依赖）。 */
export interface SlotContributionMethods {
  /** root 标准源（可多条）。 */
  slotRoot?(): Parameters<Slots["provideRoot"]>[0] | readonly Parameters<Slots["provideRoot"]>[0][];
  /** scope adapter（`session` 等）。 */
  slotScope?(): Readonly<Record<string, Parameters<Slots["installScope"]>[1]>>;
  /** locale 面。 */
  slotLocale?(): Parameters<Slots["installLocale"]>[0];
  /** 组件注册。 */
  slotRegistrations?(): readonly SlotRegistration[];
  /** 工厂注册。 */
  slotFactories?(): readonly SlotFactoryRegistration[];
}

/** 一次组件注册：目标 slot + options + 组件。 */
export interface SlotRegistration {
  /** 目标 slot 名（`"root"`、`"sidebar.left"`…）：用 `inject` 的 key 类型（那是全集）。 */
  readonly at: Parameters<Slots["inject"]>[0];
  /** 注册选项（`register` 的第一个参数，`at` 会被覆盖进去）。 */
  readonly options?: Omit<Parameters<Slots["register"]>[0], "name">;
  /** 组件。 */
  readonly component: Parameters<Slots["register"]>[1];
  /**
   * 等目标 slot 被声明后再注册（上游 `slots.inject(name, () => register(...))` 的语义）。
   * 目标 slot 由别的行声明时必须开；`root` 是内建的，不需要。
   */
  readonly inject?: boolean;
}

/** 一次工厂注册。 */
export interface SlotFactoryRegistration {
  readonly at: Parameters<Slots["inject"]>[0];
  readonly options?: Omit<Parameters<Slots["registerFactory"]>[0], "name">;
  readonly factory: Parameters<Slots["registerFactory"]>[1];
  readonly inject?: boolean;
}

const kSlotDeclaration = Symbol.for("zephyr.slot-declaration");

interface DeclaringConstructor {
  readonly [kSlotDeclaration]?: SlotDeclaration;
  prototype: {
    onInit?: (ctx: Context) => void;
    slots?: Slots;
  };
}

/** 读一行的声明（没声明过就是 `undefined`）。 */
export function slotDeclarationOf(instance: object): SlotDeclaration | undefined {
  return (instance.constructor as unknown as DeclaringConstructor)[kSlotDeclaration];
}

/**
 * 应用一条声明。顺序固定：先装 scope（渲染要在它之后），再贡献 root，最后 register。
 * @param slots - 本链的 `Slots` 面。
 * @param declaration - 从类上读到的声明。
 * @param owner - 声明所属的实例（函数式 `root` 会拿到它）。
 * @returns 逆序撤销（与安装顺序相反）。
 */
export function applySlotDeclaration(
  slots: Slots,
  declaration: SlotDeclaration,
  owner?: SlotContributionMethods,
): () => void {
  const undo: (() => void)[] = [];

  // 两类来源合在一起：options 里的**静态**声明 + 类方法里的**带注入**声明。
  const scopes = { ...declaration.scope, ...owner?.slotScope?.() };
  const locales = [declaration.locale, owner?.slotLocale?.()].filter(
    (item): item is Parameters<Slots["installLocale"]>[0] => item !== undefined,
  );
  const fromOptions =
    declaration.root === undefined
      ? []
      : Array.isArray(declaration.root)
        ? declaration.root
        : [declaration.root];
  const fromMethod = owner?.slotRoot?.();
  const roots = [
    ...fromOptions,
    ...(fromMethod === undefined ? [] : Array.isArray(fromMethod) ? fromMethod : [fromMethod]),
  ];
  const registrations = [...(declaration.register ?? []), ...(owner?.slotRegistrations?.() ?? [])];
  const factories = [
    ...(declaration.registerFactory ?? []),
    ...(owner?.slotFactories?.() ?? []),
  ];

  // 顺序固定：locale → scope → root → register → registerFactory（撤销逆序）。
  for (const face of locales) slots.installLocale(face);
  for (const [scope, adapter] of Object.entries(scopes)) {
    undo.push(slots.installScope(scope as never, adapter));
  }
  for (const contribution of roots) undo.push(slots.provideRoot(contribution));
  for (const item of registrations) {
    const options = { ...item.options, name: item.at };
    undo.push(
      item.inject === true
        ? slots.inject(item.at, () => slots.registerDynamic(options, item.component))
        : slots.registerDynamic(options, item.component),
    );
  }
  for (const item of factories) {
    const options = { ...item.options, name: item.at };
    undo.push(
      item.inject === true
        ? slots.inject(item.at, () => slots.registerFactory(options as never, item.factory))
        : slots.registerFactory(options as never, item.factory),
    );
  }
  return () => {
    for (const dispose of [...undo].reverse()) dispose();
  };
}

/**
 * 贡献行的**基类**：`onInit` 里读自己类上的 `@Slot` 声明并应用。
 *
 * 不用「装饰器包 `onInit`」那种写法：包装会返回一个新类，字段初始化与 `this` 身份都变得不直观。
 * 继承则相反——子类的字段先初始化，`onInit` 在构造完成之后跑，`this` 就是子类实例。
 */
export abstract class SlotContribution implements OnInit {
  protected readonly slots = inject(Slots);

  onInit(): void {
    const declaration = (this.constructor as unknown as DeclaringConstructor)[kSlotDeclaration];
    if (declaration !== undefined) {
      applySlotDeclaration(this.slots, declaration, this as unknown as SlotContributionMethods);
    }
  }
}

/**
 * 声明这一行往 slot 里贡献什么；同时把它注册成 provider（`@Injectable()` 的语义）。
 *
 * 用法：`class X extends SlotContribution` + `@Slot({...})`。带注入的贡献写成类方法
 * （`slotRoot()` 等），options 里只放静态值。
 */
export function Slot(declaration: SlotDeclaration): ClassDecorator {
  return (target) => {
    Object.defineProperty(target, kSlotDeclaration, { value: declaration, configurable: true });
    // 已经有令牌（`extends` 契约类时原型链上有 meta）就不重复打：`@Injectable()` 会按新类的名字重推令牌。
    const hasMeta = (Object.getPrototypeOf(target) as { [key: symbol]: unknown })[
      Symbol.for("morlay.zephyr.injectable")
    ] !== undefined;
    if (!hasMeta) Injectable()(target);
  };
}
