// 判据：上游 `Service` 子类在行作用域里用 `super(ctx, 'selfService')` 自注册后：
// 1. 上游自己按属性访问（`this.ctx.selfService`）读得到它自己；
// 2. 行作用域的 `ctx.reflect` 是**完整**反射面（`props` / `store` 可读）——上游 traceable 代理读服务成员时
//    （`getTraceable` 里的 `ctx.reflect.props['<service>.<member>']`）会直接读它，缺 `props` 就是
//    `Cannot read properties of undefined (reading 'agentLoop.runtime')` 那条报错；
// 3. `ctx.reflect.get('<name>')` 也指向同一个实例——若退回根 `reflect`、丢掉 `get` 接管，第 2 条仍会绿，
//    只有这条能把它挡下来。
//
// 这是 `ServiceScope` 把注册与读面落在同一张表的唯一判据——**不经过 `exposeUpstreamName`**。
import { Service, type Context as CordisContext } from "@deepseek-ai/cordis";
import { bootstrapApplication, Injectable, InjectionToken } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { describe, expect, it } from "vitest";

/** 探针记录：行作用域内上游自注册的服务，按属性访问 / `reflect.get` 是否读得到自己。 */
const seen: {
  selfVisible?: boolean;
  reflectGetSelf?: boolean;
  reflectProps?: unknown;
  reflectStore?: unknown;
} = {};

class ProbeService extends Service {
  constructor(ctx: CordisContext) {
    super(ctx, "selfService");
    seen.selfVisible = (this.ctx as { selfService?: unknown }).selfService === this;
    const reflect = (ctx as {
      reflect: { props?: unknown; store?: unknown; get(name: string): unknown };
    }).reflect;
    seen.reflectGetSelf = reflect.get("selfService") === this;
    seen.reflectProps = reflect.props;
    seen.reflectStore = reflect.store;
  }
}

/** 一条上游插件：只做一件事——`ctx.plugin(ProbeService)` 自注册。 */
const ProbePlugin = {
  name: "probe",
  apply(ctx: CordisContext): void {
    ctx.plugin(ProbeService);
  },
};

const ProbeContract = new InjectionToken<{ readonly name: string }>("probeContract");

@Injectable()
class ProbeRow extends fromCordis(ProbeContract, ProbePlugin) {}

describe("作用域内自注册服务", () => {
  it("上游自注册的服务，上游自己按属性访问可读", async () => {
    delete seen.selfVisible;
    delete seen.reflectGetSelf;
    const app = await bootstrapApplication({ providers: [ProbeRow] });
    try {
      expect(seen.selfVisible, "`super(ctx, 'selfService')` 注册后，`this.ctx.selfService` 应指向实例本身").toBe(true);
      expect(seen.reflectGetSelf, "`ctx.reflect.get('selfService')` 也应指向实例本身（行作用域的 `get` 接管没丢）").toBe(true);
    } finally {
      await app.dispose();
    }
  });

  it("行作用域的 reflect 面带着 props / store（上游 traceable 读服务成员的前提）", async () => {
    seen.reflectProps = undefined;
    seen.reflectStore = undefined;
    const app = await bootstrapApplication({ providers: [ProbeRow] });
    try {
      expect(seen.reflectProps, "`ctx.reflect.props` 必须可读：上游按 `<service>.<member>` 查声明面").toBeTypeOf("object");
      expect(seen.reflectStore, "`ctx.reflect.store` 必须可读：上游按它枚举已注册实现").toBeTypeOf("object");
    } finally {
      await app.dispose();
    }
  });
});
