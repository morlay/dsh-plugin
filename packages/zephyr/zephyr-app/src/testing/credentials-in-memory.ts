// 测试用的 credentials 假件：`connection` 行只把它**转交**给上游（转交后上游用 `modifyRecord` 维护浏览器 cookie），
// 认证本身由上层提供。这里按内存实现框架的 `Credentials` 契约，让框架包的 spec 不必装整个 auth 域——
// `zephyr-app` 反向依赖域包会让包级依赖成环（`.agents/standards/how-to-write.md` 的「依赖单向」）。
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import { Injectable } from "@morlay/zephyr";
import { Credentials } from "../credentials/credentials.contract.ts";

/** 内存凭证面：记录与引用都只活在这一次测试里。 */
@Injectable()
export class CredentialsInMemory extends Credentials {
  private readonly records = new Map<string, CredentialRecord>();

  private readonly values = new Map<string, string>();

  readonly resolve = async (ref: CredentialRef): Promise<ResolvedCredential | undefined> => {
    const value = this.values.get(String(ref));
    return value === undefined ? undefined : { value, source: "memory" };
  }

  readonly describe = async (ref: CredentialRef): Promise<CredentialInfo> => {
    const configured = this.values.has(String(ref));
    return { configured, ...(configured ? { source: "memory" } : {}), writable: true };
  }

  readonly set = async (ref: CredentialRef, value: string): Promise<void> => {
    this.values.set(String(ref), value);
  }

  readonly unset = async (ref: CredentialRef): Promise<void> => {
    this.values.delete(String(ref));
  }

  readonly readRecord = async (key: CredentialKey): Promise<CredentialRecord | undefined> => {
    return this.records.get(String(key));
  }

  readonly describeRecord = async (key: CredentialKey): Promise<CredentialRecordInfo> => {
    const record = this.records.get(String(key));
    return {
      configured: record !== undefined,
      ...(record === undefined ? {} : { kind: record.kind }),
      writable: true,
    };
  }

  readonly listRecords = async (): Promise<readonly CredentialRecordEntry[]> => {
    return [...this.records].map(([key, record]) => ({
      key: key as CredentialKey,
      kind: record.kind,
    }));
  }

  readonly modifyRecord = async (
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> => {
    const current = this.records.get(String(key));
    const next = await mutate(current);
    if (next === undefined) return current;
    this.records.set(String(key), next);
    return next;
  }

  readonly deleteRecord = async (key: CredentialKey): Promise<void> => {
    this.records.delete(String(key));
  }
}
