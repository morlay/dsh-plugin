import { Module } from "@morlay/zephyr";
import { UiSidebar, UiSidebarBrowser, UiSidebarDocumentpreview, UiSidebarFiles, UiSidebarRight, UiSidebarTerminal } from "./sidebar.client.service.ts";

@Module({ providers: [UiSidebar, UiSidebarRight, UiSidebarDocumentpreview, UiSidebarBrowser, UiSidebarTerminal, UiSidebarFiles] })
export class SidebarClientModule {}
