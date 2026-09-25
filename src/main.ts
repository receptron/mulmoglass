import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import "material-icons/iconfont/material-icons.css";
import { installHtmlFrameHost } from "./host/htmlFrames";

// The plugins' stylesheets (their Tailwind classes are compiled into them).
import.meta.glob(
  [
    "../node_modules/@gui-chat-plugin/*/dist/style.css",
    "../node_modules/@mulmochat-plugin/*/dist/style.css",
    "../node_modules/@mulmoclaude/*-plugin/dist/style.css",
  ],
  { eager: true },
);

// presentHtml pages reach the View's iframe by postMessage.
installHtmlFrameHost();

// Makes the app installable (public/sw.js).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("[sw] registration failed", error);
  });
}

createApp(App).mount("#app");
