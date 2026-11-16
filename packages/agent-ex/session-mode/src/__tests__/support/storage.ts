// 真存储栈的测试装配：hub + 域行 + 上游 json 后端，只在临时目录落盘（照 `dsh-storage/src/__tests__/storage.spec.ts`）。
//
// 三个函数各管一件事：起一套真栈（`bootStorage`）、给真栈套一层计数（`counting`）、
// 一个可注入写失败的域替身（`memoryDomain`，判"存储写失败"那条用它）。
import { join } from "node:path";
import { StorageDomain } from "@morlay/dsh-storage/contract";
import { StorageJsonDefault, provideStorage, provideStorageJson } from "@morlay/dsh-storage";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";

/** 一套真存储栈：`app` 用来卸载，`storage` 就是域令牌的实现。 */
export interface StorageStack {
  readonly app: App;
  readonly storage: StorageDomain;
}

/**
 * 起一套真存储栈（根目录 `<root>/storages`）。
 * @param root - 这次用例的临时目录。
 * @returns 栈。
 */
export async function bootStorage(root: string): Promise<StorageStack> {
  const app = await bootstrapApplication({
    providers: [
      ...provideStorage(),
      ...provideStorageJson(configure(StorageJsonDefault, { root: join(root, "storages") })),
    ],
    timeoutMs: 10_000,
  });
  return { app, storage: app.get(StorageDomain) };
}

/** 表句柄的运行时面（测试只碰得到这几个成员）。 */
interface TableHandle {
  get(key: string): unknown;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  readonly size: number;
}

/** 域句柄的运行时面。 */
interface OpenedDomain {
  readonly name: string;
  table(name: string): TableHandle;
  close(): Promise<void>;
}

/** 真栈外面那层计数：读到的键与最后打开的那张表（表句柄是真实的，`size` 就是介质里的条数）。 */
export interface Counting {
  /** 当装配里的 `storage.domain` 用。 */
  readonly domain: object;
  /** 每次 `get` 读到的键，按发生顺序。 */
  readonly reads: string[];
  /** 最后打开的那张表；还没 open 过时是 `undefined`。 */
  readonly tables: TableHandle[];
}

/**
 * 给真栈套一层计数：记下每次 `get` 读到的键，其余照原样转发——被测的仍是真 json 后端。
 *
 * 用来判「hydrate 只读一次盘」与「清到空就删整条记录」。
 * @param storage - 真实现。
 * @returns 包装后的域与观测面。
 */
export function counting(storage: StorageDomain): Counting {
  const reads: string[] = [];
  const tables: TableHandle[] = [];
  const domain: object = {
    async open(spec: Parameters<StorageDomain["open"]>[0]): Promise<OpenedDomain> {
      const domainRef = (await storage.open(spec)) as unknown as OpenedDomain;
      return {
        name: domainRef.name,
        close: () => domainRef.close(),
        table(name: string): TableHandle {
          const table = domainRef.table(name);
          tables.push(table);
          return {
            get(key: string) {
              reads.push(key);
              return table.get(key);
            },
            put: (key: string, value: unknown) => table.put(key, value),
            delete: (key: string) => table.delete(key),
            get size() {
              return table.size;
            },
          };
        },
      };
    },
    get: (name: Parameters<StorageDomain["get"]>[0]) => storage.get(name),
    closeAll: () => storage.closeAll(),
  };
  return { domain, reads, tables };
}

/** 一个可注入写失败的域替身与它的观测面。 */
export interface MemoryDomain {
  /** 当装配里的 `storage.domain` 用。 */
  readonly domain: object;
  /** 落在内存里的记录（`put` 成功才进这张表）。 */
  readonly records: Map<string, unknown>;
  /** 每一笔写入都抛错（读不受影响）；用例中途打开。 */
  readonly failures: { failWrites: boolean };
}

/**
 * 一个纯内存的域替身：`put` 可被开关打断，读与删照常。
 * @returns 替身与它的观测面。
 */
export function memoryDomain(): MemoryDomain {
  const records = new Map<string, unknown>();
  const failures = { failWrites: false };
  const table: TableHandle = {
    get: (key) => records.get(key),
    async put(key, value) {
      if (failures.failWrites) throw new Error("存储写失败（用例注入）");
      records.set(key, value);
    },
    delete: async (key) => records.delete(key),
    get size() {
      return records.size;
    },
  };
  const domain: OpenedDomain = { name: "session_mode", table: () => table, close: async () => {} };
  return {
    domain: {
      open: async () => domain,
      get: () => undefined,
      closeAll: async () => {},
    },
    records,
    failures,
  };
}
