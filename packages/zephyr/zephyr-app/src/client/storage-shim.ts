// `localStorage` / `sessionStorage` 的代理：同步内存真源 + IndexedDB 异步落盘。
//
// 为什么代理：上游的持久化（`@deepseek-ai/dsh-client-store` 的 `attachPersistence`）直接吃原生
// `localStorage`——同步阻塞主线程、5MB 限额、清缓存即丢（`dsh.sessions.current` 记着不存在的 id 就是这么来的）。
//
// **同步语义的底线**：内存 `Map` 是唯一真源，`setItem` 之后立刻 `getItem` 必须读得到；落盘是之后异步发生的，
// 失败只报错、不回滚内存值（回滚会让「刚写进去的值消失」比丢盘更难查）。
//
// **未实现的语义**：原生的 `storage` 事件（跨标签页通知）不触发——本装配是单标签页；
// 若将来要多标签页一致性，用 `BroadcastChannel` 广播，别指望这里。
import { STORAGE_DB_NAME, STORAGE_DB_VERSION, STORAGE_STORE_LOCAL, STORAGE_STORE_SESSION } from "./storage-shim.constants.ts";

/** 六个成员的同步面（**不是** DOM `Storage` 实例，所以 `instanceof Storage` 为 `false`）。 */
export interface StorageShim {
  readonly length: number;

  key(index: number): string | null;

  getItem(key: string): string | null;

  setItem(key: string, value: string): void;

  removeItem(key: string): void;

  clear(): void;
}

/** 安装结果：失败时调用方按「回落原生」处理，并把原因写进日志。 */
export type StorageShimResult =
  | { readonly installed: true; readonly migrated: number }
  | { readonly installed: false; readonly reason: string };

/** 打开两个 store 的库（版本与 store 名在 constants 里，两处不重复写）。 */
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [STORAGE_STORE_LOCAL, STORAGE_STORE_SESSION]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB 打开失败"));
  });
}

export type PendingWrite = { readonly key: string; readonly value: string | null };

/** 把一条写操作排到队列里，串行执行（同一 key 的先后顺序必须保持）。 */
function createWriter(db: IDBDatabase, store: string): (write: PendingWrite) => void {
  let tail: Promise<void> = Promise.resolve();
  return (write) => {
    tail = tail.then(
      () =>
        new Promise<void>((resolve) => {
          const tx = db.transaction(store, "readwrite");
          const target = tx.objectStore(store);
          if (write.value === null) target.delete(write.key);
          else target.put(write.value, write.key);
          tx.oncomplete = () => resolve();
          tx.onabort = () => {
            console.error(`[storage-shim] ${store} 写盘失败：`, tx.error);
            resolve();
          };
        }),
    );
  };
}

/** 读出 store 里的全部键值。 */
function readAll(db: IDBDatabase, store: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const target = tx.objectStore(store);
    const keys = target.getAllKeys();
    const values = target.getAll();
    tx.oncomplete = () => {
      const out = new Map<string, string>();
      keys.result.forEach((key, index) => {
        const value = values.result[index];
        if (typeof key === "string" && typeof value === "string") out.set(key, value);
      });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB 读取失败"));
  });
}

/** 用给定初值造一个同步 shim；每次写都异步刷到 `writer`。 */
export function createShim(initial: Map<string, string>, writer: (write: PendingWrite) => void): StorageShim {
  const map = new Map(initial);
  return {
    get length(): number {
      return map.size;
    },
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    getItem: (key: string): string | null => (map.has(key) ? (map.get(key) ?? null) : null),
    setItem: (key: string, value: string): void => {
      const text = String(value);
      map.set(key, text);
      writer({ key, value: text });
    },
    removeItem: (key: string): void => {
      map.delete(key);
      writer({ key, value: null });
    },
    clear: (): void => {
      for (const key of Array.from(map.keys())) writer({ key, value: null });
      map.clear();
    },
  };
}

/** 把原生 storage 里的键搬进内存表（迁移一次；失败时抛，由调用方决定是否清原生）。 */
export function drainNative(native: Storage): Map<string, string> {
  const out = new Map<string, string>();
  for (let index = 0; index < native.length; index += 1) {
    const key = native.key(index);
    if (key === null) continue;
    const value = native.getItem(key);
    if (value !== null) out.set(key, value);
  }
  return out;
}

/** 装一个属性的 shim 并自检（有些浏览器对 `localStorage` 的 defineProperty 会静默失败）。 */
function defineShim(name: "localStorage" | "sessionStorage", shim: StorageShim, native: Storage): void {
  Object.defineProperty(window, name, { value: shim, configurable: true, writable: false });
  const installed: unknown = name === "localStorage" ? window.localStorage : window.sessionStorage;
  if (installed === (native as unknown)) throw new Error(`[storage-shim] ${name} 没装上：defineProperty 被忽略`);
}

/**
 * 安装两个 storage 的代理（**必须在 `bootstrapClient` 之前 await**）。
 *
 * 步骤：开库 → 预载 → 把原生里的现有键迁进来（迁完全量写库，成功后清空原生）→ defineProperty + 自检。
 * @returns 安装结果；`installed: false` 时调用方应保留原生 storage 并记一条 warn。
 */
export async function installStorageShim(): Promise<StorageShimResult> {
  const factory = globalThis.indexedDB;
  if (factory === undefined) return { installed: false, reason: "indexedDB 不可用" };
  const nativeLocal = window.localStorage;
  const nativeSession = window.sessionStorage;
  let db: IDBDatabase;
  try {
    db = await openDatabase(factory);
  } catch (error) {
    return { installed: false, reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    const local = await readAll(db, STORAGE_STORE_LOCAL);
    const session = await readAll(db, STORAGE_STORE_SESSION);
    const localShim = createShim(local, createWriter(db, STORAGE_STORE_LOCAL));
    const sessionShim = createShim(session, createWriter(db, STORAGE_STORE_SESSION));
    // 迁移：原生里现有的键全部搬进来（先写进 shim → 异步落盘），搬完再清原生。
    const carried = drainNative(nativeLocal);
    for (const [key, value] of carried) localShim.setItem(key, value);
    const carriedSession = drainNative(nativeSession);
    for (const [key, value] of carriedSession) sessionShim.setItem(key, value);
    defineShim("localStorage", localShim, nativeLocal);
    defineShim("sessionStorage", sessionShim, nativeSession);
    // 只有两个 shim 都装上、且迁移的写操作已排队，才清原生（下次启动原生是空的）。
    nativeLocal.clear();
    nativeSession.clear();
    return { installed: true, migrated: carried.size + carriedSession.size };
  } catch (error) {
    return { installed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
