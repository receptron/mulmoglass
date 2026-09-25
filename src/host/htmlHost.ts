// Host wiring for @mulmoclaude/html-plugin (presentHtml): the View's loadHtml
// / saveHtml / packHtml actions. The tool call itself runs the package's
// execute() with context.files.artifacts. The page is served to the View's
// iframe by the service worker (public/sw.js), from the same OPFS files.
//
// A browser port of MulmoChat's server/plugins/htmlHost.ts (adapted from
// MulmoTerminal's server/backends/html.ts, MIT License, Copyright (c) 2026
// Receptron).
import { strToU8, zipSync } from "fflate";
import {
  executeHtmlDispatch,
  isHtmlArtifactPath,
  isHtmlDispatchArgs,
  isPackHtmlArgs,
  toArtifactsRelative,
  type PackHtmlResult,
} from "@mulmoclaude/html-plugin";
import { artifactsFileOps } from "./workspace";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// A page only loads inline content and the allowed CDNs, so the zip holds
// just the page.
async function packHtml(filePath: string): Promise<PackHtmlResult> {
  if (!isHtmlArtifactPath(filePath)) {
    throw new Error("path must be an existing .html file");
  }
  const html = await artifactsFileOps.read(toArtifactsRelative(filePath));
  const name = filePath.split("/").pop() ?? "page.html";
  const zip = zipSync({ [name]: strToU8(html) });
  return {
    filename: `${name.replace(/\.html$/i, "")}.zip`,
    zipBase64: toBase64(zip),
  };
}

/** The View's loadHtml / saveHtml / packHtml actions. */
export async function dispatchHtml(args: object): Promise<unknown> {
  if (isPackHtmlArgs(args)) return packHtml(args.path);
  if (!isHtmlDispatchArgs(args)) {
    throw new Error("unsupported presentHtml action");
  }
  return executeHtmlDispatch({ files: { artifacts: artifactsFileOps } }, args);
}
