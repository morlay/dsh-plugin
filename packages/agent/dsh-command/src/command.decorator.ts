// `@Command()`：命令贡献的登记写法（`@Command()` + `implements CommandContribution`，不手写 `register`）。
//
// **每类一个具体装饰器**：这里只做「命令」这一类的登记，不参数化注册表、不留通用入口——
// `@Tool` / `@Skill` / `@Policy` 将来各写一份（形态真的完全一致时再谈提取，并记 ADR）。
//
// 手法与 `configure` 相同：装饰器返回**子类**。`inject()` 是构造期的字段占位，zephyr 只解析
// 实例**自有**字段，所以要拿到注册表就得自己构造实例；登记发生在装配期（provider 的 `onInit`），
// 撤销随行卸载（`onDispose`）。
import { inject, Injectable, type Awaitable, type Context, type Newable } from "@morlay/zephyr";
import { CommandRegistry, type CommandContribution } from "./contract/index.ts";

/**
 * 把类声明成一条命令贡献：装配期登记进 `CommandRegistry`，行卸载时撤销。
 *
 * ```ts
 * @Command()
 * export class GoalCommand implements CommandContribution { … }   // 包仍有自己的 module.ts
 * ```
 * @returns 类装饰器（返回绑好装配期登记的 Provider 子类）。
 */
export function Command(): <T extends Newable<CommandContribution>>(target: T) => T {
  return <T extends Newable<CommandContribution>>(target: T): T => {
    // 贡献方自己写的生命周期：装饰器只**包一层**，不能把它吞掉。
    const hooks = target.prototype as {
      onInit?: (ctx: Context) => Awaitable<void>;
      onDispose?: () => Awaitable<void>;
    };

    class CommandProvider extends target {
      /** 注册表：构造期占位，装配期解析（`inject` 只在 Provider 自有的字段生效）。 */
      private readonly registry = inject(CommandRegistry);

      /** 这一条的撤销函数：`onDispose` 里调一次，行卸载即从注册表里摘掉。 */
      private release: (() => void) | undefined;

      async onInit(ctx: Context): Promise<void> {
        await hooks.onInit?.call(this, ctx);
        this.release = this.registry.register({
          name: this.name,
          description: this.description,
          // 上游把贡献冻结成副本再调 `handler`：包一层把 `this` 留在实例上（否则 handler 的
          // `this` 是那份副本，注入的依赖全都读不到）。
          handler: (invocation) => this.handler(invocation),
        });
      }

      async onDispose(): Promise<void> {
        this.release?.();
        this.release = undefined;
        await hooks.onDispose?.call(this);
      }
    }

    // 令牌名沿用贡献类自己：`Injectable` 按类名取服务名，叫 `CommandProvider` 的话每条命令
    // 都会挤到同一个名字上。
    Object.defineProperty(CommandProvider, "name", { value: target.name });
    Injectable()(CommandProvider);
    // 子类实例就是 `T` 的实例（它 `extends target`）；TS 不认「类型变量的 `extends` 结果仍是 `T`」，
    // 这里是唯一的断言，且是就地收窄——不是先抹成 `unknown` 再转。
    return CommandProvider as T;
  };
}
