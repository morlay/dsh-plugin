// 运行环境契约：**所有路径都由它提供**（装配方显式给值；不读环境变量、不向上找目录）。
//
// home 在装配层（`zephyr-app`）：它是**部署参数**，只有装配面知道值；实现 `AppEnvDefault` 同目录。
// 业务包要落盘路径这类部署值，正确做法是装配面 `configure(X, { root })` 喂进去，而不是读全局 env。
//
// 这里只放**两种形态都成立**的事实：数据根、装配根、起始目录、缓存根。
// 开发态专属的路径（页面骨架在哪、按包的产物缓存落在哪一层）不在这里——它们住 `@morlay/zephyr-dev`。
import { join } from "node:path";
import { Injectable } from "@morlay/zephyr";

export interface AppEnvValues {
  /** 数据根（sessions、credentials、logs 都在它下面）。 */
  readonly dataDir: string;
  /** 装配根（`package.json` 所在目录；依赖解析、pnpm store、缓存都从它派生）。 */
  readonly profileDir: string;
  /**
   * 新会话 / agent 的**起始目录**（从哪个项目目录开始干活）。
   *
   * **与 `profileDir` 是两件事，别合并**：打包形态下 `profileDir` 是只读的 `Resources/runtime`
   * （在应用包内），agent 绝不该在那儿干活；起始目录是「用户从哪个项目启动的」。
   * 开发态两者恰好同一个值（都从 cwd 起），所以很容易被误当成一件事。
   *
   * **可选只为一件事**：各包手写的 `FakeAppEnv` 只给 `dataDir` / `profileDir` 也照样成立——
   * 新增字段是**加法**，不给它不报错（否则改一处契约要追着二十几个包改替身）。
   * 生产形态永远有值：`AppEnvDefault` 的构造必然填上它（缺省 cwd）。
   * 消费方因此**别直接读这个字段**（类型上是可选的），走 {@link AppEnv.defaultWorkingDirectory}。
   */
  readonly defaultWorkingDirectory?: string;
}

@Injectable()
export abstract class AppEnv {
  abstract readonly values: AppEnvValues;

  /** 缓存的**根**：只给 {@link AppEnv.cacheDirOf}、doctor 与测试读；消费方一律走 `cacheDirOf`。 */
  abstract readonly cacheDir: string;

  /**
   * 新会话 / agent 的起始目录：消费方**只走这一条**（{@link AppEnvValues.defaultWorkingDirectory} 的读口）。
   *
   * getter 而不是抽象成员：它与 `values.defaultWorkingDirectory` 是**同一个部署值**，不是派生计算，
   * 各包的 `FakeAppEnv` 只覆盖 `values` 一处就够，不必为这一行再各抄一遍（与 {@link AppEnv.cacheDirOf}
   * 同一个理由）；也正因为它落在基类上，「旧替身没给新字段」才不会变成编译错误。
   */
  get defaultWorkingDirectory(): string {
    return this.values.defaultWorkingDirectory ?? this.values.profileDir;
  }

  /**
   * 某个用途的缓存目录（`<cacheDir>/<namespace>`）。
   *
   * 只放**路径规则**，不放用途清单：用途名由使用者自己声明（谁用谁定义常量），
   * 这里认识具体名字就等于把某个形态的知识塞进运行时契约。
   *
   * 具体方法而不是抽象成员：各包的 `FakeAppEnv` 只覆盖字段，不该为一条路径规则各写一遍实现。
   * @param namespace - 用途（调用方自己定义，如 `@morlay/zephyr-dev` 的 `client-modules`）。
   * @returns 该用途的缓存根。
   */
  cacheDirOf(namespace: string): string {
    return join(this.cacheDir, namespace);
  }

  /** 装配根的清单：`<profileDir>/package.json`（依赖解析的基准）。 */
  abstract readonly profileManifest: string;
}
