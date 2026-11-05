// 测试辅助：打包这件事只测**编排**（构建了没、装到哪），不真产出一个 .app。
import { Injectable } from "@morlay/zephyr";
import type { ElectronBuilderConfig } from "../electron-builder.ts";
import { Packager, type PackInput, type PackResult } from "../packager.ts";

/** 记录调用、返回固定产物的打包器。 */
@Injectable()
export class FakePackager extends Packager {
  /** 每次打包收到的配置。 */
  readonly packs: ElectronBuilderConfig[] = [];

  /** 每次安装收到的产物。 */
  readonly installs: PackResult[] = [];

  /**
   * @param _config - 配置。
   * @returns 一个假的应用目录。
   */
  async pack(_config: ElectronBuilderConfig, _input: PackInput): Promise<PackResult> {
    this.packs.push(_config);
    return { appDir: "/tmp/fake.app" };
  }

  /**
   * @param result - 打包结果。
   * @returns 装的路径。
   */
  async install(result: PackResult): Promise<string> {
    this.installs.push(result);
    return "/Applications/fake.app";
  }
}
