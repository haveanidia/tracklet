/**
 * Generate a small JPEG data-URL thumbnail from a video file.
 * Uses a raw <video> element + canvas — no OpenCV, no workers.
 * The function owns its object URL and always releases it.
 * Best-effort: resolves to an empty string when the frame cannot be captured.
 */
export async function generateThumbnail(file: Blob, targetWidth = 240): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Thumbnail load timeout')), 8000);
      video.oncanplay = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Thumbnail video failed to load'));
      };
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // Seek to ~1s or half the duration for a representative frame.
    video.currentTime = Math.min(1, duration / 2 || 0.04);
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 8000); // a failed seek is not fatal
      video.onseeked = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });

    const width = video.videoWidth || targetWidth;
    const height = video.videoHeight || Math.round((width * 9) / 16);
    const scale = targetWidth / width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return '';
  } finally {
    // Tear down the element and release the URL so the media is not retained.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
