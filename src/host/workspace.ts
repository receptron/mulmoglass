// The plugins' files, in the browser's Origin Private File System. MulmoChat
// keeps them in <workspace>/artifacts on disk; here the workspace is the OPFS
// directory `workspace/`. Every write publishes `file:<workspace path>`, so
// open Views of that file reload.
import { createOpfsFileOps } from "./opfsFileOps";
import { publishFileChange } from "../tools/pluginRuntime";

export const WORKSPACE_ROOT = "workspace";

/** The whole workspace; paths like `artifacts/documents/…`. */
export const workspaceFileOps = createOpfsFileOps(WORKSPACE_ROOT, (rel) =>
  publishFileChange(rel),
);

/** `context.files.artifacts`: paths relative to `artifacts/`. */
export const artifactsFileOps = createOpfsFileOps(
  `${WORKSPACE_ROOT}/artifacts`,
  (rel) => publishFileChange(`artifacts/${rel}`),
);
