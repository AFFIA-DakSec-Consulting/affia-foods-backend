// Phone photos are often 4-8 MB: shrink them in the browser before sending (the server accepts 3 MB).
// Falls back to the original file whenever the browser cannot do it, so an upload never fails because of this step.

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** Longest side kept, per picture kind. A logo is small; a cover photo is shown wide. */
export const MAX_SIDE: Record<'logo' | 'banner', number> = { logo: 600, banner: 1600 };

/** The size to draw at: never bigger than the original, longest side capped. */
export const fitWithin = (width: number, height: number, maxSide: number): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
};

const load = (file: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
  img.src = url;
});

/** Returns a file that is small enough to send. PNG logos stay PNG (transparency); cover photos become JPEG. */
export const prepareImage = async (file: File, kind: 'logo' | 'banner'): Promise<Blob> => {
  try {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return file;
    const img = await load(file);
    const target = fitWithin(img.naturalWidth, img.naturalHeight, MAX_SIDE[kind]);
    const needsResize = target.width !== img.naturalWidth || target.height !== img.naturalHeight;
    if (!needsResize && file.size <= MAX_UPLOAD_BYTES / 2) return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width; canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    const type = kind === 'logo' && file.type !== 'image/jpeg' ? 'image/png' : 'image/jpeg';
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
    return blob && blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
};
