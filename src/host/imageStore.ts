// Images in the workspace: every image the app makes is saved as
// artifacts/images/<YYYY>/<MM>/<id>.<ext>, and edits start from saved images
// (context.app.editImages, and the sequence tools' reference pictures).
//
// Ported from MulmoChat (server/plugins/imageStore.ts), which matches
// MulmoClaude's image store and /api/edit-image: UTC year/month folders, a
// 16-hex id, at most 8 source images, the same refusal wording. Here the files
// are in OPFS. As in MulmoChat, the file takes the extension of the image's
// real type (MulmoClaude names every image `.png`), and `.jpg` and `.webp`
// sources are accepted as well as `.png`.
import { artifactsFileOps } from "./workspace";

const IMAGES_DIR = "images";
const ARTIFACTS_PREFIX = "artifacts/";
const SHORT_ID_HEX_LEN = 16;
/** MulmoClaude's MAX_EDIT_IMAGES. */
const MAX_EDIT_IMAGES = 8;
const SOURCE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** The file extension each type is saved with. */
const IMAGE_EXTENSIONS: Readonly<Record<ImageMime, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  prefix.every((byte, i) => bytes[at + i] === byte);

/** An image's type from its first bytes: the bytes decide, not the name. */
function imageMimeOfBytes(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/** A saved image, as the image APIs take it. */
export interface SourceImage {
  mimeType: string;
  bytes: Uint8Array;
}

const yearMonthUtc = (now = new Date()): string =>
  `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Save an image a plugin made. Returns its workspace path
 * (`artifacts/images/…`), or null when it can't be saved (out of storage,
 * say): the picture is still shown, just without a path.
 */
export async function saveImage(bytes: Uint8Array): Promise<string | null> {
  try {
    const mime = imageMimeOfBytes(bytes);
    if (!mime) return null;
    const id = crypto
      .randomUUID()
      .replaceAll("-", "")
      .slice(0, SHORT_ID_HEX_LEN);
    const rel = `${IMAGES_DIR}/${yearMonthUtc()}/${id}.${IMAGE_EXTENSIONS[mime]}`;
    await artifactsFileOps.write(rel, bytes);
    return `${ARTIFACTS_PREFIX}${rel}`;
  } catch (error) {
    console.warn("[image] could not save the image", error);
    return null;
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.length > 0);

/**
 * Load saved images for an edit. Throws an error the model can act on for
 * anything that isn't 1 to 8 images under artifacts/images/. The OPFS
 * FileOps refuses `..` and absolute paths as well.
 */
export async function loadSourceImages(
  imagePaths: unknown,
): Promise<SourceImage[]> {
  if (!isStringArray(imagePaths) || imagePaths.length === 0) {
    throw new Error(
      "imagePaths must be a non-empty array of workspace-relative paths",
    );
  }
  if (imagePaths.length > MAX_EDIT_IMAGES) {
    throw new Error(
      `imagePaths exceeds the maximum of ${MAX_EDIT_IMAGES} entries`,
    );
  }
  return Promise.all(imagePaths.map(loadSourceImage));
}

// A path already in its normal form: no `.`, `..` or empty segments.
const isNormalized = (rel: string) =>
  rel.split("/").every((s) => s !== "" && s !== "." && s !== "..");

async function loadSourceImage(imagePath: string): Promise<SourceImage> {
  const lower = imagePath.toLowerCase();
  // "artifacts/images/../documents/x.png" stays inside artifacts/ but not
  // inside images/ (MulmoChat checks that normalizing changes nothing).
  if (
    !isNormalized(imagePath) ||
    !imagePath.startsWith(`${ARTIFACTS_PREFIX}${IMAGES_DIR}/`) ||
    !SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext))
  ) {
    throw new Error(
      `imagePath must be a .png, .jpg or .webp image under artifacts/images/: ${imagePath}`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await artifactsFileOps.readBytes(
      imagePath.slice(ARTIFACTS_PREFIX.length),
    );
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "NotFoundError"
        ? "no such image"
        : String(error);
    throw new Error(`could not read ${imagePath}: ${reason}`, {
      cause: error,
    });
  }
  const mimeType = imageMimeOfBytes(bytes);
  if (!mimeType) throw new Error(`not an image: ${imagePath}`);
  return { mimeType, bytes };
}
