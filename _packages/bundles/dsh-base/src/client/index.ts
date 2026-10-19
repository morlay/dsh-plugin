// dsh-base 的浏览器侧 client 半：目前没有自己的行（gateway 的 client 半与 `connection` 同包，归 dsh-web-app）。
import { Module } from "@morlay/zephyr";
import { toCordis } from "@morlay/zephyr/compat";

@Module({})
export class DshBaseClientModule {}

export default toCordis(DshBaseClientModule);
