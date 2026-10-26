/**
 * Browser-side image work. Browsers apply EXIF orientation while decoding an
 * <img>, so anything drawn from it is already upright; we never write EXIF back.
 */

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image we can read"));
    };
    img.src = url;
  });
}

function release(img: HTMLImageElement, canvas: HTMLCanvasElement) {
  img.src = '';
  canvas.width = canvas.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  );
}

/** Square, centre-cropped JPEG data URL (profile avatars). */
export async function squareThumbnail(file: File, size = 256, quality = 0.86): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  const out = canvas.toDataURL('image/jpeg', quality);
  release(img, canvas);
  return out;
}

/** Square, centre-cropped JPEG blob (gallery tiles). */
export async function coverThumbnail(file: File, size = 400, quality = 0.82): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  const blob = await toBlob(canvas, quality);
  release(img, canvas);
  return blob;
}

/** Whole image scaled so its longest edge is at most maxEdge. Never upscales. */
export async function resizeToMax(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number; sourceWidth: number; sourceHeight: number }> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await toBlob(canvas, quality);
  const out = { blob, width, height, sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight };
  release(img, canvas);
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
