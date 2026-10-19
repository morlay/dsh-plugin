// 联邦地址的解析（纯函数，可单测）。
import { decodePackageName } from "../internal/resolve.ts";
import { CLIENT_MODULES_PREFIX } from "./bundle.ts";

/** `/_zephyr/@modules/<pkg>@<ver>/<file>` 的解析结果。 */
export interface FederationTarget {
  readonly name: string;
  readonly urlVersion: string;
  readonly file: string;
}

/** 纯函数：解析联邦地址（`undefined` 表示不是这条链的地址）。 */
export function parseFederationUrl(url: string): FederationTarget | undefined {
  const rest = url.slice(`${CLIENT_MODULES_PREFIX}/`.length).split("?")[0] ?? "";
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  const pkgVersion = rest.slice(0, slash);
  const at = pkgVersion.lastIndexOf("@");
  if (at <= 0) return undefined;
  return {
    name: decodePackageName(pkgVersion.slice(0, at)),
    urlVersion: pkgVersion.slice(at + 1),
    file: rest.slice(slash + 1),
  };
}
