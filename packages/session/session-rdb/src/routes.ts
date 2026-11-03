// 本仓库会话管理面 HTTP 路径的 home：整族挂在同一前缀下，与上游的 `/api` 面（connection 的 prefix 路由）
// 分开。同路径的 exact 路由会遮蔽上游同名路由的 GET/HEAD 通道（官方会话日志下载因此 405），
// 见 ADR-管理面HTTP路由前缀与上游分家。
export const MORLAY_SESSION_API_PREFIX = "/api/morlay/v1/session";

export const SESSION_ROWS_PATH = `${MORLAY_SESSION_API_PREFIX}/rows`;

export const SESSION_EXPORT_PATH = `${MORLAY_SESSION_API_PREFIX}/export`;

export const SESSION_IMPORT_PATH = `${MORLAY_SESSION_API_PREFIX}/import`;

export const SESSION_DELETE_PATH = `${MORLAY_SESSION_API_PREFIX}/delete`;

// 「整理数据」通道：回收孤儿 + 重算派生统计 + VACUUM，一次请求完成。
export const SESSION_ORGANIZE_PATH = `${MORLAY_SESSION_API_PREFIX}/organize`;

export const SESSION_USAGE_PATH = `${MORLAY_SESSION_API_PREFIX}/usage`;
