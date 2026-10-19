import { WEB_STARTUP_SERVICE, type WebStartupValues } from "@deepseek-ai/dsh-web-app/startup";
import { InjectionToken, type FactoryProvider } from "@morlay/zephyr";

export const WebStartupToken = new InjectionToken<WebStartupValues>(WEB_STARTUP_SERVICE);

/** 代码组合的 invocation 值：官方行由命令行解析，这里取环境变量与默认。 */
export function webStartupValues(): WebStartupValues {
  return {
    openBrowser: false,
    trustedHosts: [],
    ...(process.env.HOST === undefined ? {} : { host: process.env.HOST }),
    ...(process.env.PORT === undefined ? {} : { port: Number(process.env.PORT) }),
  };
}

// Provider 本身就提供值：令牌值与原生名一起在装配最前面就位，消费者（webserver / web-runtime /
// connection）无论 inject 令牌还是按名字读都直接命中，不依赖「谁先 mount」。
export const WebStartupProvider: FactoryProvider<typeof WebStartupToken> = {
  provide: WebStartupToken,
  useFactory: (ctx) => {
    const values = webStartupValues();
    (ctx as unknown as { root: { provide(name: string, value: unknown): unknown } }).root.provide(
      WEB_STARTUP_SERVICE,
      values,
    );
    return values;
  },
};
