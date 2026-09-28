// A stand-in for the image models, for tests (dev builds only): with
// localStorage "mulmoglass_mock_image_ms" set to a number of milliseconds,
// every image is this one, returned after that delay, as a real model takes
// seconds. No API call, so a voice test of a slideshow costs nothing and can't
// hit a spending cap. The picture is a PNG showing the prompt, so a
// screenshot says which slide is on the screen. The same as MulmoChat's
// server/utils/mockImage.ts (MULMOCHAT_MOCK_IMAGE_MS), drawn with a canvas.

const MOCK_KEY = "mulmoglass_mock_image_ms";
const WIDTH = 1024;
const HEIGHT = 576;
const MARGIN = 32;

/** The mock's delay in milliseconds, or undefined when images are real. */
function mockImageDelayMs(): number | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(MOCK_KEY);
  } catch {
    return undefined;
  }
  if (raw === null || raw === "") return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

let count = 0;

/** The mock picture for `prompt` (a PNG data URL) after the mock's delay, or
 *  undefined when the mock is off. Imported only by dev builds
 *  (./imageGeneration.ts), so a production build doesn't contain it. */
export async function mockImage(
  prompt: string,
  referenceCount = 0,
): Promise<string | undefined> {
  const delay = mockImageDelayMs();
  if (delay === undefined) return undefined;
  count += 1;
  const number = count;
  console.info(`[mock image] ${number} in ${delay} ms`);
  await new Promise((resolve) => setTimeout(resolve, delay));

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("mock image: no 2D canvas");
  g.fillStyle = backgroundOf(prompt);
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle = "#1e1e28";
  g.textBaseline = "top";
  g.font = "bold 44px sans-serif";
  const refs = referenceCount ? ` (${referenceCount} ref)` : "";
  g.fillText(`Mock image ${number}${refs}`, MARGIN, MARGIN);
  g.font = "26px sans-serif";
  const lineHeight = 34;
  const top = MARGIN + 70;
  const maxLines = Math.floor((HEIGHT - top - MARGIN) / lineHeight);
  wrap(g, prompt, WIDTH - 2 * MARGIN)
    .slice(0, maxLines)
    .forEach((line, i) => g.fillText(line, MARGIN, top + i * lineHeight));
  return canvas.toDataURL("image/png");
}

/** A light background colour from the prompt, so two pictures differ. */
function backgroundOf(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const channel = (shift: number) => 170 + ((hash >> shift) & 0x3f);
  return `rgb(${channel(0)}, ${channel(8)}, ${channel(16)})`;
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
