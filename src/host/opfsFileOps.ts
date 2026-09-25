// gui-chat-protocol's FileOps over the browser's Origin Private File System,
// rooted at one directory. MulmoGlass has no server, so this is where plugins
// keep their files (MulmoChat's <workspace>/artifacts).
//
// Paths are POSIX-relative. Absolute paths, `..`, `.` and empty segments are
// refused, so a plugin can't reach outside its root (OPFS has no symlinks).
import type { FileOps } from "gui-chat-protocol";

function segmentsOf(rel: string): string[] {
  if (typeof rel !== "string") throw new Error("path must be a string");
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw new Error(`absolute paths are not allowed: ${rel}`);
  }
  const segments = normalized.split("/").filter((s) => s !== "");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`path escapes its root: ${rel}`);
    }
  }
  return segments;
}

const isNotFound = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === "NotFoundError" || error.name === "TypeMismatchError");

async function rootDirectory(
  rootSegments: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const segment of rootSegments) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

async function directoryOf(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

async function fileOf(
  root: FileSystemDirectoryHandle,
  rel: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const segments = segmentsOf(rel);
  const name = segments.pop();
  if (!name) throw new Error(`not a file path: ${rel}`);
  const dir = await directoryOf(root, segments, create);
  return dir.getFileHandle(name, { create });
}

/**
 * A FileOps rooted at `rootPath` inside OPFS. `onWrite` hears every path
 * written or deleted (relative to the root), so open Views can reload.
 */
export function createOpfsFileOps(
  rootPath: string,
  onWrite?: (rel: string) => void,
): FileOps {
  let rootPromise: Promise<FileSystemDirectoryHandle> | null = null;
  const root = () => (rootPromise ??= rootDirectory(segmentsOf(rootPath)));

  return {
    async read(rel) {
      const file = await (await fileOf(await root(), rel)).getFile();
      return file.text();
    },

    async readBytes(rel) {
      const file = await (await fileOf(await root(), rel)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    },

    // createWritable writes to a swap file and replaces the file on close,
    // so a reader never sees a half-written file.
    async write(rel, content) {
      const handle = await fileOf(await root(), rel, true);
      const writable = await handle.createWritable();
      try {
        await writable.write(
          typeof content === "string"
            ? content
            : new Blob([new Uint8Array(content)]),
        );
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      onWrite?.(segmentsOf(rel).join("/"));
    },

    async readDir(rel) {
      const dir = await directoryOf(await root(), segmentsOf(rel), false);
      const names: string[] = [];
      for await (const name of dir.keys()) names.push(name);
      return names.sort();
    },

    async stat(rel) {
      const file = await (await fileOf(await root(), rel)).getFile();
      return { mtimeMs: file.lastModified, size: file.size };
    },

    async exists(rel) {
      try {
        await fileOf(await root(), rel);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    async unlink(rel) {
      const segments = segmentsOf(rel);
      const name = segments.pop();
      if (!name) throw new Error(`not a file path: ${rel}`);
      try {
        const dir = await directoryOf(await root(), segments, false);
        await dir.removeEntry(name);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      onWrite?.([...segments, name].join("/"));
    },
  };
}
