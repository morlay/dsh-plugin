// Provider 的配置聚合（Standalone / Angular 形态）：
//   feature 是**配置变换**（`withServer({ port: 2 })`），`provideXxx(...features)` 把它们 reduce 成
//   最终配置，最后 `configure(X, config)` 绑一次。装配面只写 `provideXxx(withXxx(...))`。
import {
  bootstrapApplication,
  configure,
  Injectable,
  without,
  type ProviderFeature,
} from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

/** 三层配置：`server` 是嵌套对象，`tags` 是数组。 */
interface ProbeConfig {
  readonly server: { readonly host: string; readonly port: number };
  readonly tags: readonly string[];
  readonly label: string;
}

const DEFAULTS: ProbeConfig = {
  server: { host: "127.0.0.1", port: 1 },
  tags: ["a"],
  label: "module",
};

@Injectable()
class Probe {
  constructor(readonly config: ProbeConfig) {}
}

@Injectable()
class Extra {
  readonly kind = "extra";
}

/**
 * 域包导出的装配函数（Angular 的 `provideXxx(...features)`）：默认清单被 features 依次变换。
 * 默认配置也走同一条路：`configure(Probe, DEFAULTS)([Probe, Extra])`。
 * @param features - `configure(...)` / `without(...)` 这类对清单的改动。
 * @returns provider 清单。
 */
function provideProbe(...features: ProviderFeature[]): ReturnType<ProviderFeature> {
  return features.reduce(
    (providers, feature) => feature(providers),
    configure(Probe, DEFAULTS)([Probe, Extra]),
  );
}

describe("Provider 配置聚合（feature 变换）", () => {
  it("多个 feature 依次叠加：嵌套对象逐键合并，数组整体替换", async () => {
    const app = await bootstrapApplication({
      providers: provideProbe(configure(Probe, { server: { port: 2 }, tags: ["b"] })),
    });
    try {
      expect(app.get(Probe).config).toEqual({
        server: { host: "127.0.0.1", port: 2 },
        tags: ["b"],
        label: "module",
      });
    } finally {
      await app.dispose();
    }
  });

  it("不给 feature 时就是默认配置，且令牌身份不变", async () => {
    const app = await bootstrapApplication({ providers: provideProbe() });
    try {
      expect(app.get(Probe).config).toEqual(DEFAULTS);
    } finally {
      await app.dispose();
    }
  });

  it("后一个 feature 覆盖前一个的同名字段", async () => {
    const app = await bootstrapApplication({
      providers: provideProbe(configure(Probe, { label: "first" }), configure(Probe, { label: "second" })),
    });
    try {
      expect(app.get(Probe).config.label).toBe("second");
    } finally {
      await app.dispose();
    }
  });

  it("清单里的实现可以被 `without(...)` 剔除", async () => {
    const app = await bootstrapApplication({ providers: provideProbe(without(Extra)) });
    try {
      expect(app.tryGet(Extra)).toBeUndefined();
      expect(app.get(Probe).config).toEqual(DEFAULTS);
    } finally {
      await app.dispose();
    }
  });
});

describe("configure 的约束", () => {
  it("配置类型来自实现的构造参数：未知字段是编译错误", () => {
    // @ts-expect-error 故意构造：`ProbeConfig` 里没有 `unknownField`
    configure(Probe, { unknownField: 1 });
  });

  it("补丁可以只给嵌套对象的一部分字段", () => {
    expect(() => configure(Probe, { server: { port: 2 } })([Probe])).not.toThrow();
  });

  it("feature 作用在清单上找不到目标：装配期报错", () => {
    expect(() => configure(Extra, {})([Probe])).toThrow(/configure\(Extra\) 没有匹配的 provider/);
  });
});
