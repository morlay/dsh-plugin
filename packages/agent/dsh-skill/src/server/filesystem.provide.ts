import { provide } from "@morlay/zephyr";
import { SkillFilesystem } from "../filesystem.service.ts";

export const provideSkillFilesystem = provide([SkillFilesystem]);
