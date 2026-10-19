import { describe, expect, it } from "vitest";
import { bootstrapApplication, Injectable, inject } from "@morlay/zephyr";
import { getTokenName } from "../token-meta.ts";

describe("服务名派生（仅用于日志与识别）", () => {
  it("默认由类名连字符化，实现类沿继承链共享令牌名", () => {
    @Injectable()
    class ToolRuntime {}

    @Injectable()
    class Child extends ToolRuntime {}

    expect(getTokenName(ToolRuntime)).toBe("tool-runtime");
    expect(getTokenName(Child)).toBe("tool-runtime");
  });

  it("连字符化规则：连续大写、分隔符归一、数字与其它字符保持", () => {
    @Injectable()
    class XMLHttpRequest {}

    @Injectable()
    class HTTPServer2 {}

    @Injectable()
    class Legacy_Store {}

    expect(getTokenName(XMLHttpRequest)).toBe("xml-http-request");
    expect(getTokenName(HTTPServer2)).toBe("http-server2");
    expect(getTokenName(Legacy_Store)).toBe("legacy-store");
  });
});

describe("令牌元数据不被子类改写", () => {
  it("先装配父类就实例化父类，子类只是另一个可选实现", async () => {
    @Injectable()
    class SessionApi {
      kind(): string {
        return "real";
      }
    }

    @Injectable()
    class EchoApi extends SessionApi {
      override kind(): string {
        return "echo";
      }
    }

    const real = await bootstrapApplication({ providers: [SessionApi] });
    const echo = await bootstrapApplication({ providers: [EchoApi] });
    expect(real.get(SessionApi).kind()).toBe("real");
    expect(echo.get(SessionApi).kind()).toBe("echo");
    await real.dispose();
    await echo.dispose();
  });
});

describe("令牌即身份", () => {
  it("实现类继承令牌：inject(令牌) 拿到实现，不随注册顺序漂移", async () => {
    @Injectable()
    abstract class Store {
      abstract kind(): string;
    }

    @Injectable()
    class PgStore extends Store {
      kind() {
        return "pg";
      }
    }

    @Injectable()
    class User {
      store = inject(Store);
    }

    expect(getTokenName(PgStore)).toBe("store");

    const app = await bootstrapApplication({ providers: [User, PgStore] });
    expect(app.get(Store)).toBeInstanceOf(PgStore);
    await app.dispose();
  });
});
