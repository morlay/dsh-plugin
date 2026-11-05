// 编译期检查：装配清单里"被 required 注入的令牌"必须都有提供者。
//
// 类型层只做一件事：从清单里的每个 Provider 实例上收集 `inject(Token)` 打下的必需标记，
// 再看清单里有没有哪个 Provider 的实例能赋给那个令牌。缺了就把缺的令牌塞进 options 的必填字段，
// 调用处因此编译不过——错误信息里直接给出缺的类型。
import type { Debugger } from "./debugger.ts";
import type { Logger } from "./logger.ts";
import type { ProviderEntry } from "./provider.ts";
import type { Required } from "./token.ts";

/**
 * 清单条目对应的实例类型（裸类 / 带 `provide` 的条目）。
 *
 * 推到**宽类型**（`ProviderEntry`）时给 `any`：那说明这个条目来自 `...provideSandbox()` 这类
 * "带 feature 参数、返回 `ProviderList`"的装配函数——静态上无法知道它提供了什么。
 * `never` 会被当成"什么都没提供"（误报缺依赖），`unknown` 又反过来匹配不上任何具体令牌；
 * 只有 `any` 在 `Have extends Need` 里恒成立，表达"这一条不参与静态判定"。
 */
type InstanceOfEntry<E> = E extends new (...args: never[]) => infer I
  ? I
  : E extends { useValue: infer V }
    ? V
    : E extends { provide: infer C }
      ? C extends new (...args: never[]) => infer I
        ? I
        : any // 宽类型条目：无法静态判定，不参与覆盖检查
      : any;

/** 实例上所有 required 注入的令牌实例类型。 */
type RequiredOfInstance<I> = {
  [K in keyof I]: I[K] extends Required<infer T> ? T : never;
}[keyof I];

/** 清单里全部 Provider 的 required 令牌。 */
type RequiredOfList<L extends readonly ProviderEntry[]> = {
  [K in keyof L]: L[K] extends ProviderEntry ? RequiredOfInstance<InstanceOfEntry<L[K]>> : never;
}[number];

/**
 * 适配行（`fromCordis` 的产物）对外提供的契约实例类型：它的 `token` 静态成员就是契约。
 * 无契约形态的令牌是 `TokenClass<unknown>`，这里要排除，否则 `unknown` 会把"缺依赖"全吃掉。
 */
type TokenOfEntry<E> = E extends { token: infer K }
  ? K extends abstract new (...args: never[]) => infer I
    ? [unknown] extends [I]
      ? never
      : I
    : never
  : never;

/** 清单提供的实例类型（含适配行的契约面、以及 `bootstrapApplication` 默认装入的 `Logger` / `Debugger`）。 */
type ProvidedOfList<L extends readonly ProviderEntry[]> = {
  [K in keyof L]: InstanceOfEntry<L[K]>;
}[number] | TokenOfEntry<L[number]> | Logger | Debugger;

/** 逐个需求检查：有没有哪个提供者的实例能赋给它（结构化子类型即可）。 */
type UncoveredList<Need, Have> = Need extends undefined | null
  ? never
  : Need extends unknown
    ? true extends (Have extends unknown ? (Have extends Need ? true : false) : never)
      ? never
      : Need
    : never;

/** 没有被任何提供者覆盖的 required 令牌。 */
export type Uncovered<L extends readonly ProviderEntry[]> = UncoveredList<
  RequiredOfList<L>,
  ProvidedOfList<L>
>;

/**
 * 清单的覆盖约束：缺依赖时 options 多出一个必填字段，调用处编译失败。
 * @template L - 清单的字面量类型。
 */
export type ProvidersCoverage<L extends readonly ProviderEntry[]> = [Uncovered<L>] extends [never]
  ? unknown
  : { readonly __missingProviders: Uncovered<L> };
