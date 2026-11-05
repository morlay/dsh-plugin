// 远端访问决策契约（上游 `RemoteAccessService` 的服务面）。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";
import type RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";

@Injectable()
export abstract class RemoteAccess {
  abstract readonly decide: RemoteAccessService["decide"];

  /** 追加一条准入策略（上游 `registerPolicy`）。 */
  abstract readonly registerPolicy: Upstream["registerPolicy"];

  /** 某个主体此刻的准入快照（上游 `snapshotFor`）。 */
  abstract readonly snapshotFor: Upstream["snapshotFor"];

  /** 订阅准入变化（上游 `follow`）。 */
  abstract readonly follow: Upstream["follow"];

  /** 让某份缓存失效（上游 `invalidate`）。 */
  abstract readonly invalidate: Upstream["invalidate"];

  /** 某次调用的准入判定（上游 `allows`）：`@Remote` 方法在分派前都过它。 */
  abstract readonly allows: Upstream["allows"];

  /** 上游 remote 绑定（`bindTypertRemote` 的产物）：登记与查询都经它。 */
  abstract readonly typertRemote: Upstream["typertRemote"];
}

// 上游其余成员（本仓的准入面比上游窄，但契约必须列全：少一条，上游用到时读到 undefined）。
// 形状一律取上游实现类的同名成员，避免手抄签名走样。

/** 上游实现类的实例形状（契约成员的类型都从它取）。 */
type Upstream = InstanceType<typeof RemoteAccessService>;

/** 覆盖守卫：上游 `RemoteAccess` 有而本契约没列出的成员，编译期必须为空。 */
export type RemoteAccessCovered = AssertTrue<
  AssertCovered<InstanceType<typeof RemoteAccessService>, RemoteAccess>
>;
