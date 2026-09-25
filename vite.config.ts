import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// No proxy and no server: the app talks to the model providers directly with
// the user's own keys, and its files live in the browser (OPFS).
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: true,
  },
});
