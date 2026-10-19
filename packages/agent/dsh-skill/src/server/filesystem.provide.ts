import { provide, type ProviderList } from "@morlay/zephyr";
import { SkillFilesystem } from "../filesystem.service.ts";

const providers = (): ProviderList => [SkillFilesystem];

export const provideSkillFilesystem = provide(providers());
