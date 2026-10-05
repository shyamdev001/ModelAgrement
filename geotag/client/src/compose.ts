/**
 * Joins the strip to the photo on the person's own device. The photo is never uploaded.
 * The canvas is the photo's exact width, and its height plus the strip's: the photo is drawn
 * untouched at the top and the strip directly underneath.
 */
export class PhotoError extends Error {}

export interface LoadedPhoto {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

/** Opens the photo upright (phones often store photos sideways with a "rotate me" note). */
export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Older browsers: fall back to an <img>, which also honours the rotation note.
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new PhotoError('This file is not a photo we can open. Please choose a JPG, PNG or WEBP photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty image')));
    img.onerror = () => reject(new Error('could not load image'));
    img.src = url;
  });
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function appendStrip(photo: LoadedPhoto, stripSvg: string, stripHeight: number, type: string): Promise<{ blob: Blob; extension: string }> {
  const tooBig = new PhotoError('This photo is too large for the browser on this device. Please use a smaller photo.');
  const canvas = document.createElement('canvas');
  canvas.width = photo.width;
  canvas.height = photo.height + stripHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw tooBig;

  ctx.drawImage(photo.source, 0, 0);
  const stripUrl = URL.createObjectURL(new Blob([stripSvg], { type: 'image/svg+xml' }));
  try {
    ctx.drawImage(await loadImage(stripUrl), 0, photo.height, photo.width, stripHeight);
  } finally {
    URL.revokeObjectURL(stripUrl);
  }

  // Some phones silently give a blank canvas above their size limit: the strip's dark corner proves it was drawn.
  const corner = ctx.getImageData(photo.width - 1, canvas.height - 1, 1, 1).data;
  if (corner[3] === 0) throw tooBig;

  // Same file type out as in. PNG is lossless; JPEG and WEBP are saved at the highest quality setting.
  const wanted = type in EXTENSIONS ? type : 'image/jpeg';
  const quality = wanted === 'image/jpeg' ? 0.97 : 1;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, wanted, quality));
  if (!blob) throw tooBig;
  // A browser that cannot write the wanted type (WEBP on some phones) writes PNG instead.
  return { blob, extension: EXTENSIONS[blob.type] ?? 'png' };
}
