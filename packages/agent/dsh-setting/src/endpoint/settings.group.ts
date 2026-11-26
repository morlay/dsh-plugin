// `settings` 组的**两端共用面**：组名、deps 键、方法名与每个方法的请求/应答形状（与上游
// `api/settings-controller` 的描述符一致）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧
// （`server/settings-endpoint.service.ts`）继承它实现方法。客户端形态不在本仓：这一组的客户端面由上游
// `@deepseek-ai/dsh-api-settings-controller#settings` 的 `$mount` 面提供。
//
// 方法签名从上游宿主面（`SettingsController`）推（`Parameters<…>` / `ReturnType<…>`）：形状本来就在
// 那里定义，抄一遍只会多一份会漂的声明。
import type { SettingsController } from "@deepseek-ai/dsh-api-settings-controller";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam } from "@morlay/zephyr-app/typert";
import { groupNameOf, RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/**
 * 组名（`settings`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function settingsGroupName(): string {
  return groupNameOf(SettingsEndpoint);
}

// 方法名**不留常量表**：唯一 home 是下面契约类方法上的 `@RemoteMethod()` 实参（方法名即 wire 名），
// 调用方直接调客户端形态的方法；要枚举时用 `remoteDescriptorsOf(SettingsEndpoint).descriptors`。
// **`set` / `unset` 不在这里**：那是 `credentials` 组的方法（凭证读写），归 `dsh-auth` 的端点面。

/**
 * `settings` 组：配置页的读面、写面与「打开设置文档」。
 *
 * 每个 unary 的 wire 参数就是方法的命名参数（与宿主侧 `registerRemoteGroup` 的同一约定）。
 */
@RemoteGroup({ name: "settings" })
export class SettingsEndpoint {
  /**
   * 配置页的一次读：可写性、文档存在与否、每个 namespace 的红acted 视图。
   * @returns 配置页要的那一份快照。
   */
  @RemoteMethod({ parameters: [] })
  async describe(): Promise<ReturnType<SettingsController["describe"]>> {
    throw new Error("settings/describe：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 往某个 namespace 的 user 段合并一个 patch。
   * @param _ns - namespace 键。
   * @param _patch - 要合并的字段。
   * @param _expectedRevision - 调用方读到的 revision（`undefined` 表示无条件写）。
   * @returns 写完之后该 namespace 的红acted 视图。
   */
  @RemoteMethod({ parameters: ["ns", "patch", "expectedRevision"] })
  async update(
    _ns: Parameters<SettingsController["update"]>[0],
    _patch: Parameters<SettingsController["update"]>[1],
    _expectedRevision: Parameters<SettingsController["update"]>[2],
  ): ReturnType<SettingsController["update"]> {
    throw new Error("settings/update：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 整体替换某个 namespace 的 user 段。
   * @param _ns - namespace 键。
   * @param _section - 完整的新 user 段。
   * @param _expectedRevision - 调用方读到的 revision（`undefined` 表示无条件写）。
   * @returns 写完之后该 namespace 的红acted 视图。
   */
  @RemoteMethod({ parameters: ["ns", "section", "expectedRevision"] })
  async replace(
    _ns: Parameters<SettingsController["replace"]>[0],
    _section: Parameters<SettingsController["replace"]>[1],
    _expectedRevision: Parameters<SettingsController["replace"]>[2],
  ): ReturnType<SettingsController["replace"]> {
    throw new Error("settings/replace：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 按路径编辑某个 namespace 的 user 段（按**已存储**的那一份解析，不按调用方上次读到的）。
   * @param _ns - namespace 键。
   * @param _ops - 按顺序应用的编辑。
   * @param _expectedRevision - 调用方读到的 revision（`undefined` 表示无条件写）。
   * @returns 写完之后该 namespace 的红acted 视图。
   */
  @RemoteMethod({ parameters: ["ns", "ops", "expectedRevision"] })
  async mutate(
    _ns: Parameters<SettingsController["mutate"]>[0],
    _ops: Parameters<SettingsController["mutate"]>[1],
    _expectedRevision: Parameters<SettingsController["mutate"]>[2],
  ): ReturnType<SettingsController["mutate"]> {
    throw new Error("settings/mutate：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 把 provider 拥有的设置文档落盘并在原生编辑器里打开。
   * @param _signal - 调用方生命周期；abort 终止准备或原生命令。
   * @returns 原生打开器接受文档后的确认。
   */
  @RemoteMethod({ parameters: [] })
  async openSettingsDocument(
    _signal: Parameters<SettingsController["openSettingsDocument"]>[0],
  ): ReturnType<SettingsController["openSettingsDocument"]> {
    throw new Error("settings/openSettingsDocument：契约类未实现（宿主侧要在子类里实现它）");
  }
}
/**
 * 覆盖守卫：契约对上**宿主类** `SettingsController` 的 wire 面（形参与返回双向）。
 *
 * `describe` 是**同步**返回（上游 `describe(): SettingsDescribeValue`）——`AsyncReturn` 会提升成 `Promise<…>`，
 * 与我们的 wire 面一致（实测不红：这一处不是「提升得不对」）。
 * `openSettingsDocument` 的 `signal` 是宿主侧取消通道（不是 wire 参数），两侧各摘一次再比。
 */
type SettingsWire = AsyncReturn<DropParam<SettingsController, AbortSignal>>;

export type SettingsEndpointCovered = AssertTrue<
  AssertWireFace<
    Pick<SettingsWire, "describe" | "update" | "replace" | "mutate">,
    Pick<SettingsEndpoint, "describe" | "update" | "replace" | "mutate">
  >
>;

export type SettingsSignalCovered = AssertTrue<
  AssertWireFace<
    Pick<SettingsWire, "openSettingsDocument">,
    Pick<DropParam<SettingsEndpoint, AbortSignal>, "openSettingsDocument">
  >
>;
