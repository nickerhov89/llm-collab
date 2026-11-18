import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config";

// Cowork is an explicit deployment profile; vanilla YA keeps its own defaults.
export default defineConfig((env) =>
  mergeConfig(baseConfig(env), {
    define: {
      "import.meta.env.VITE_POLZA_ADMIN_UI": JSON.stringify("true"),
    },
  }),
);
