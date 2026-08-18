export function generateAnnotationPreview(sourceImg, region, maxSize = 80) {
  if (!sourceImg || !region) return null;

  const { x, y, width, height } = region;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Calculate aspect ratio
  const aspect = width / height;
  let previewW = maxSize;
  let previewH = maxSize / aspect;

  if (previewH > maxSize) {
    previewH = maxSize;
    previewW = maxSize * aspect;
  }

  canvas.width = previewW;
  canvas.height = previewH;

  try {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sourceImg,
      x, y, width, height,
      0, 0, previewW, previewH
    );
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

export function canvasToImage(canvas) {
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}
