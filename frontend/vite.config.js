import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const backendPort = Number(env.BACKEND_PORT ?? 4000);
  return {
    envDir: "..",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: Number(env.FRONTEND_PORT ?? 5173),
      proxy: {
        "/markets": `http://127.0.0.1:${backendPort}`,
        "/interval-options": `http://127.0.0.1:${backendPort}`,
        "/health": `http://127.0.0.1:${backendPort}`,
      },
    },
  };
});
