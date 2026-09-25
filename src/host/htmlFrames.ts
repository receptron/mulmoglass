// Delivers presentHtml pages to the View's sandboxed iframe.
//
// MulmoChat's server serves pages at /artifacts/html/<path>. MulmoGlass has no
// server, and Chrome doesn't send navigations of a sandboxed iframe (the
// View's is sandbox="allow-scripts") through a service worker. So the result's
// previewUrl points at a static shell (public/html-frame.html), which asks for
// its page by postMessage; this module reads the page from OPFS and answers.
// Only this app's own iframes get an answer, and only for html artifacts.
import {
  isHtmlArtifactPath,
  toArtifactsRelative,
} from "@mulmoclaude/html-plugin";
import { artifactsFileOps } from "./workspace";

const REQUEST = "mulmoglass:html-request";
const RESPONSE = "mulmoglass:html";

/** The previewUrl for a saved page (`artifacts/html/…`). The View appends
 *  `?v=…` when the file changes, which reloads the shell with the new file. */
export const htmlPreviewUrl = (filePath: string): string =>
  `/html-frame.html?path=${encodeURIComponent(filePath)}`;

const isOwnFrame = (source: MessageEventSource | null): boolean =>
  !!source &&
  Array.from(document.querySelectorAll("iframe")).some(
    (frame) => frame.contentWindow === source,
  );

async function answer(event: MessageEvent): Promise<void> {
  const data = event.data as { type?: unknown; path?: unknown } | null;
  if (!data || data.type !== REQUEST || typeof data.path !== "string") return;
  if (!isOwnFrame(event.source) || !isHtmlArtifactPath(data.path)) return;
  let html: string;
  try {
    html = await artifactsFileOps.read(toArtifactsRelative(data.path));
  } catch {
    html = "<p>This page is no longer available.</p>";
  }
  // The frame has an opaque origin, so "*" is the only target it matches.
  (event.source as Window).postMessage(
    { type: RESPONSE, path: data.path, html },
    "*",
  );
}

let installed = false;

/** Start answering the shells' requests (once). */
export function installHtmlFrameHost(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("message", (event) => void answer(event));
}
