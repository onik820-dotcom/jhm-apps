'use client';

/**
 * A phone camera produces 3–5 MB per frame. That is slow to send on forecourt
 * mobile data, heavy to hold in IndexedDB while offline, and no more readable
 * to a vision model than a downscaled copy — 1568 px on the long edge is the
 * point past which extra pixels stop adding detail the model can use.
 */
const MAX_EDGE = 1568;
const QUALITY = 0.82;

export interface PreparedImage {
  blob: Blob;
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

export async function preparePhoto(file: File | Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process the photo');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) throw new Error('The photo could not be processed');

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  return { blob, dataUrl, base64, width, height, bytes: blob.size };
}
