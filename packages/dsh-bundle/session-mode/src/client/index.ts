// client 行（dsh 的浏览器半）：与宿主侧同一条装配形状，只是挂在 client ctx 上。
import { bootstrapApplication, type Context } from "@morlay/zephyr";
import { provideSessionModeUi } from "@morlay/session-mode/ui";

export const name = "ui-session-mode";

export const inject: readonly string[] = [];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const app = await bootstrapApplication({
    providers: [...provideSessionModeUi()],
    ctx: ctx as never,
  });
  return async () => {
    await app.dispose();
  };
}
