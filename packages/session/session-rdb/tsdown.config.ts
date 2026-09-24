import { defineCordisPluginConfig } from "@local/devkit";

export default defineCordisPluginConfig({
  entries: {
    artifact: "./src/artifact.ts",
    deletion: "./src/deletion.ts",
    export: "./src/export.ts",
    gc: "./src/gc.ts",
    import: "./src/import.ts",
    storage: "./src/storage.ts",
    testing: "./src/testing.ts",
    usage: "./src/usage.ts",
  },
});
