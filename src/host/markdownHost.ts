// The MarkdownHostApp backend for @mulmoclaude/markdown-plugin
// (presentDocument), spread into context.app. The View reaches these through
// useRuntime().dispatch({ kind, … }); the tool call's create path calls
// fillImages + saveNewDoc.
//
// A browser port of MulmoChat's server/plugins/markdownHost.ts (adapted from
// MulmoTerminal's server/backends/markdown.ts, MIT License, Copyright (c) 2026
// Receptron). Documents are `.md` files in the OPFS workspace. There is no
// headless browser, so no PDF export.
import type { ToolResult } from "gui-chat-protocol";
import {
  fillImagePlaceholders,
  type MarkdownHostApp,
} from "@mulmoclaude/markdown-plugin";
import { workspaceFileOps } from "./workspace";

const DOCS_DIR = "artifacts/documents";
const PREFIX_MAX_LENGTH = 60;
const DOC_ID_BYTES = 8;
const DOC_CREATE_ATTEMPTS = 5;

/** A workspace-relative `.md` path, or an error the model can act on. */
function documentPath(rel: string): string {
  if (typeof rel !== "string" || !rel.toLowerCase().endsWith(".md")) {
    throw new Error(`not a .md document path: ${rel}`);
  }
  return rel;
}

// One path-safe filename segment from a model-supplied prefix.
function sanitizeDocPrefix(prefix: string): string {
  const cleaned = String(prefix || "document")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, PREFIX_MAX_LENGTH);
  return cleaned || "document";
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

// artifacts/documents/YYYY/MM/<prefix>-<16 hex>.md, the shape MulmoClaude,
// MulmoTerminal and MulmoChat use.
function newDocPath(prefix: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${DOCS_DIR}/${yyyy}/${mm}/${sanitizeDocPrefix(prefix)}-${randomHex(DOC_ID_BYTES)}.md`;
}

const imageDataOf = (result: ToolResult): string | null => {
  const data = result.data as { imageData?: unknown } | undefined;
  return typeof data?.imageData === "string" ? data.imageData : null;
};

/** The markdown host backends; `generateImage` fills image placeholders. */
export function createMarkdownHostApp(
  generateImage: (prompt: string) => Promise<ToolResult>,
): MarkdownHostApp {
  return {
    async loadDoc(rel) {
      return { content: await workspaceFileOps.read(documentPath(rel)) };
    },

    // Overwrite only: the View saves the document it opened.
    async saveDoc(rel, markdown) {
      const target = documentPath(rel);
      if (!(await workspaceFileOps.exists(target))) {
        throw new Error(`document not found: ${rel}`);
      }
      await workspaceFileOps.write(target, markdown);
      return { path: target };
    },

    async saveNewDoc(prefix, markdown) {
      for (let attempt = 0; attempt < DOC_CREATE_ATTEMPTS; attempt++) {
        const rel = newDocPath(prefix);
        if (await workspaceFileOps.exists(rel)) continue;
        await workspaceFileOps.write(rel, markdown);
        return { path: rel };
      }
      throw new Error(`could not create a document under ${DOCS_DIR}`);
    },

    async marpThemes() {
      return { themes: [] };
    },

    // Images are inlined as data URLs; a failed image becomes a text marker.
    async fillImages(markdown) {
      const { markdown: filled } = await fillImagePlaceholders(markdown, {
        resolveImage: async (prompt) =>
          imageDataOf(await generateImage(prompt)),
      });
      return { markdown: filled };
    },

    async exportPdf() {
      throw new Error("PDF export is not available in MulmoGlass");
    },
  };
}
