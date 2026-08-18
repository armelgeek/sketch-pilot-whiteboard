const strokeCache = new WeakMap();

export function kivgGrayscale(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

export function kivgAdaptiveThreshold(gray, width, height, blockSize = 15, C = 2) {
  const output = new Uint8Array(width * height);
  const offset = Math.floor(blockSize / 2);
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - offset), y1 = Math.max(0, y - offset);
      const x2 = Math.min(width - 1, x + offset), y2 = Math.min(height - 1, y + offset);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)] - integral[y1 * (width + 1) + (x2 + 1)] - integral[(y2 + 1) * (width + 1) + x1] + integral[y1 * (width + 1) + x1];
      const mean = sum / count;
      output[y * width + x] = gray[y * width + x] < (mean - C) ? 255 : 0;
    }
  }
  return output;
}

export function kivgThinning(binary, width, height) {
  let dst = new Uint8Array(binary);
  let changed = true;
  const toRemove = new Int32Array(width * height);
  while (changed) {
    changed = false;
    let removeCount = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (dst[idx] === 0) continue;
        const p2 = dst[(y - 1) * width + x] > 0 ? 1 : 0;
        const p3 = dst[(y - 1) * width + x + 1] > 0 ? 1 : 0;
        const p4 = dst[y * width + x + 1] > 0 ? 1 : 0;
        const p5 = dst[(y + 1) * width + x + 1] > 0 ? 1 : 0;
        const p6 = dst[(y + 1) * width + x] > 0 ? 1 : 0;
        const p7 = dst[(y + 1) * width + x - 1] > 0 ? 1 : 0;
        const p8 = dst[y * width + x - 1] > 0 ? 1 : 0;
        const p9 = dst[(y - 1) * width + x - 1] > 0 ? 1 : 0;
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) + (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) + (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) + (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
        if (A === 1 && (p2 * p4 * p6 === 0) && (p4 * p6 * p8 === 0)) {
          toRemove[removeCount++] = idx;
          changed = true;
        }
      }
    }
    for (let i = 0; i < removeCount; i++) dst[toRemove[i]] = 0;
    removeCount = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (dst[idx] === 0) continue;
        const p2 = dst[(y - 1) * width + x] > 0 ? 1 : 0;
        const p3 = dst[(y - 1) * width + x + 1] > 0 ? 1 : 0;
        const p4 = dst[y * width + x + 1] > 0 ? 1 : 0;
        const p5 = dst[(y + 1) * width + x + 1] > 0 ? 1 : 0;
        const p6 = dst[(y + 1) * width + x] > 0 ? 1 : 0;
        const p7 = dst[(y + 1) * width + x - 1] > 0 ? 1 : 0;
        const p8 = dst[y * width + x - 1] > 0 ? 1 : 0;
        const p9 = dst[(y - 1) * width + x - 1] > 0 ? 1 : 0;
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) + (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) + (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) + (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
        if (A === 1 && (p2 * p4 * p8 === 0) && (p2 * p6 * p8 === 0)) {
          toRemove[removeCount++] = idx;
          changed = true;
        }
      }
    }
    for (let i = 0; i < removeCount; i++) dst[toRemove[i]] = 0;
  }
  return dst;
}

function kivgTraceSkeleton(data, width, height) {
  const visited = new Uint8Array(data.length);
  const paths = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx] > 0 && !visited[idx]) {
        const path = [];
        let currX = x, currY = y;
        while (true) {
          const currIdx = currY * width + currX;
          visited[currIdx] = 1;
          path.push({ x: currX, y: currY });
          let found = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = currX + dx, ny = currY + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (data[nIdx] > 0 && !visited[nIdx]) {
                  currX = nx; currY = ny; found = true; break;
                }
              }
            }
            if (found) break;
          }
          if (!found) break;
        }
        if (path.length > 1) paths.push(path);
      }
    }
  }
  return paths;
}

export function kivgSmoothPath(path) {
  if (path.length < 3) return path;
  const smoothed = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    smoothed.push({
      x: (path[i - 1].x + 2 * path[i].x + path[i + 1].x) / 4,
      y: (path[i - 1].y + 2 * path[i].y + path[i + 1].y) / 4
    });
  }
  smoothed.push(path[path.length - 1]);
  return smoothed;
}

export function getRegionPngStrokes(e, source) {
  if (!source) return null;
  const r = e.region;
  const fp = `${Math.floor(r.x)},${Math.floor(r.y)},${Math.ceil(r.width)},${Math.ceil(r.height)}`;
  let cache = strokeCache.get(e);
  if (cache && cache.fp === fp) return cache;
  try {
    const sw = source.naturalWidth, sh = source.naturalHeight;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw; tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(source, 0, 0);
    const rx = Math.max(0, Math.floor(r.x)), ry = Math.max(0, Math.floor(r.y));
    const rw = Math.min(sw - rx, Math.ceil(r.width));
    const rh = Math.min(sh - ry, Math.ceil(r.height));
    if (rw <= 0 || rh <= 0) return null;
    const imgData = tempCtx.getImageData(rx, ry, rw, rh);
    const gray = kivgGrayscale(imgData);
    const binary = kivgAdaptiveThreshold(gray, rw, rh, 15, 2);
    const skeleton = kivgThinning(binary, rw, rh);
    const rawPaths = kivgTraceSkeleton(skeleton, rw, rh);
    const inkMask = new Uint8Array(rw * rh);
    for (let i = 0; i < binary.length; i++) {
      inkMask[i] = binary[i] === 255 ? 1 : 0;
    }
    const srcPixels = new Uint8ClampedArray(imgData.data);
    const globalPoints = [];
    rawPaths.forEach(path => {
      kivgSmoothPath(path).forEach(pt => {
        globalPoints.push([rx + pt.x, ry + pt.y]);
      });
    });
    const res = { fp, points: globalPoints, inkMask, srcPixels, rx, ry, rw, rh };
    strokeCache.set(e, res);
    return res;
  } catch (err) {
    return null;
  }
}
