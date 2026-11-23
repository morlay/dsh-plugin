// 等一份**库里的**事实到位（读库，不读内存）：全链路用例的断言都落在持久化状态上。
export async function waitFor<T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
