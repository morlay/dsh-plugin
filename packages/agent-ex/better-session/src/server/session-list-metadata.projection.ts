// 注册 `sessionListMetadata` 投影（`blank` / `lastPromptAt`）。
//
// 上游 `SessionQueryEngine` 在自己的 init 里注册这份定义；本包的 `SessionQueryRdb` **替代**那条实现，
// 所以这份注册要由装配面补上：冷会话（落库但进程里没有活实例）只读投影缓存，没有它就拿不到 `blank`，
// 上游 `summarizeCold` 会按 `metadata?.blank ?? false` 兜成「非空」——于是没名字的空白会话全被列出来。
//
// 单独一行而不是塞进 `SessionQueryRdb.onInit`：查询实现的装配要能只装它自己（用例就是这么装的），
// 注册这件事属于「部署装了什么投影」，是装配面的决定。
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { sessionListMetadataDefinition } from "./list-metadata.projection.ts";

/** 把列表元数据投影登记进投影注册表。 */
@Injectable()
export class SessionListMetadataProjection implements OnInit {
  private readonly projections = inject.optional(SessionProjectionStore);

  onInit(): void {
    const projections = this.projections;
    if (projections === undefined) return;
    void (projections as unknown as { register(spec: unknown): Promise<unknown> }).register(
      sessionListMetadataDefinition,
    );
  }
}
