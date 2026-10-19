import { provide } from "@morlay/zephyr";
import { RemoteAccessDefault } from "./remote-access.service.ts";

export const provideRemoteAccess = provide([RemoteAccessDefault]);
