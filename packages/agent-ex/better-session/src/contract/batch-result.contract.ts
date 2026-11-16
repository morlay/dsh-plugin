// 批量动作的逐条结果：**最底层**（远程面与进程内端口两处都要，形状只能有一个）。
//
// 判据：批量动作一律「逐条结算、整批不回滚」，所以每条只回答三件事——哪一条、成不成、失败时哪个域码。
// 成功的条带上各自载荷（文件名 / 正文 / 新会话 id），载荷留在各自的接口里，这里只给三条共同字段。
export interface BatchItemResult {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly code?: string | undefined;
}
