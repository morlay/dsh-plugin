/**
 * 等一个跨 socket 的信号，但别让失败拖到 vitest 的超时：过了上限就如实说哪一步没等到，
 * 而不是只留一句 "timed out"。
 * @param work - 等待的信号。
 * @param ms - 上限（只在失败路径花时间）。
 * @param what - 等的是什么。
 */
export async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`等不到：${what}（${String(ms)}ms）`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
