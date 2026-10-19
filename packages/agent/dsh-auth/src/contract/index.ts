// auth 域的契约面（`@morlay/dsh-auth/contract`）：进程内的端口，不涉及 remote。
//
// `Credentials` 不在这里：它的消费方包含装配层（`connection` 要交给上游），契约住 `@morlay/zephyr`。
export * from "./authorization.contract.ts";
