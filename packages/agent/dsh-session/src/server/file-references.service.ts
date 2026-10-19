// `fileReferences/list` 的宿主面：`@` 的文件候选。
//
// 上游 `@deepseek-ai/dsh-file-reference-local` 的**搜索索引**（`WorkspaceFileSearch`）负责遍历、排除与排名；
// 本行只做两件事：把 wire 上的 `SessionId` 解析成 `Agent`、按 agent 的 cwd 缓存一份索引。
//
// 不装上游 `LocalFileReferenceService` 整行：它还会往每个 agent 的 `systemPrompt` 注册 section，
// 而本装配的行作用域里多 agent 会撞名（`prompt section "context:file-reference" is already registered`）。
// 模型可见的引用指引不在本端点职责内。
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
  type FileSearchConfig,
} from "@deepseek-ai/dsh-file-reference-local/search";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AgentDirectory } from "@morlay/dsh-agent";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult } from "@morlay/zephyr-app/remote";

/**
 * 搜索档位取上游默认值：20 条候选、5 万条索引上限、上游的排除目录。
 * 本部署没有要覆盖的部署值，所以不另开 `Config`。
 */
const SEARCH_CONFIG: FileSearchConfig = {
  maxResults: DEFAULT_FILE_SEARCH_MAX_RESULTS,
  maxEntries: DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  excludedDirectories: DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
};

/** `fileReferences/list` 的宿主行。 */
@Injectable()
export class FileReferencesDefault implements OnInit, OnDispose {
  private readonly agents = inject(AgentDirectory);

  private readonly workingDirectory = inject(WorkingDirectory);

  private readonly handlers = inject(RemoteHandlers);

  /** 每个 agent 一份索引；cwd 变了就换一份（与上游 `LocalFileReferenceService` 同口径）。 */
  private readonly searches = new Map<object, { cwd: string; search: WorkspaceFileSearch }>();

  private stop: () => void = () => {};

  onInit(): void {
    this.stop = this.handlers.register("fileReferences/list", async (args) =>
      asRemoteResult(async () => {
        const agent = this.agents.get(SessionId(String(args.agent)));
        if (agent === undefined)
          throw new Error(`fileReferences/list: 会话 "${String(args.agent)}" 没有 agent`);
        const query = typeof args.query === "string" ? args.query : "";
        const signal = new AbortController().signal;
        const cwd = await this.workingDirectory.ensure(agent, signal);
        let cached = this.searches.get(agent);
        if (cached?.cwd !== cwd) {
          cached?.search.dispose();
          cached = { cwd, search: new WorkspaceFileSearch(cwd, SEARCH_CONFIG) };
          this.searches.set(agent, cached);
        }
        return await cached.search.list(query, signal);
      }),
    );
  }

  onDispose(): void {
    this.stop();
    for (const { search } of this.searches.values()) search.dispose();
    this.searches.clear();
  }
}
