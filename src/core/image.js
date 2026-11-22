// Image helpers. Must run in a window context (side panel or web page), not a service worker.

/**
 * Converts any decodable image (webp, avif, gif, svg, png, jpeg) into a downscaled JPEG.
 * Gemini Nano on-device only accepts JPEG/PNG, so converting keeps more images on the device,
 * and downscaling keeps each request inside the on-device token budget.
 */
export async function blobToJpeg(blob, maxPx = 768) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 512;
    const h0 = img.naturalHeight || 512;
    const scale = Math.min(1, maxPx / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; // transparent PNG/SVG would otherwise turn black in JPEG
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg', width: w0, height: h0, thumb: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
