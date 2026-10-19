import { provide, type ProviderList } from "@morlay/zephyr";
import { CredentialsDefault } from "../credentials.service.ts";
import { CredentialsEndpointDefault } from "./credentials-endpoint.service.ts";

// 认证域的装配面：只有「凭据后端」这一行。
// `AuthorizationDefault` 不在这一批里——它的消费方（上游账号/授权那条路）本应用没装。
const providers = (): ProviderList => [CredentialsDefault, CredentialsEndpointDefault];

export const provideAuth = provide(providers());
