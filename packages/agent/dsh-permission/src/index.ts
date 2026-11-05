export * from "./contract/index.ts";
export * from "./permission-mode.ts";
// permission 的主面：三个 host 侧契约 + 默认实现与装配模块。
//
// **本包没有浏览器实现行**：批准/提问/权限面板的界面行住在 `dsh-conversation/src/ui`，
// 它们只从 `./endpoint` 取远端身份（两份 remote descriptor）。包根因此只出宿主面——
// 浏览器半引一次包根，三个宿主 service 就跟着进前端 bundle。
export * from "./user-question-queue.service.ts";
export * from "./approval.service.ts";
export * from "./permission.service.ts";

// 上游 `permission-presets` 的词按需显式转出：整包透传会把上游整面（含 Typert remote 服务与运行时）
// 拖进本包入口，也说不清到底用了哪几个词。当前没有经包根消费的散装词——上游 `PresetSpec` 只在
// `permission-mode.ts` 内部用一次（转成 `PermissionMode`），所以这里一个都不导；要新词时显式加
// （类型进 `contract/`，值与实现进本文件）。

// 两份 remote descriptor（`PERMISSION_PRESETS_REMOTE` / `USER_QUESTIONS_REMOTE`）**不在这里**：
// 它们是浏览器半 `$mount` 的远端身份，只在 `./endpoint` 出口。包根带三个宿主 service，
// 从这里取一次就把宿主实现拖进浏览器 bundle——出口边界见包内 `.agents/designs`。
