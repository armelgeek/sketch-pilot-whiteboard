import { getRegionPngStrokes, kivgSmoothPath } from './strokes'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function getProgress(t, e) {
  return clamp((t - e.reveal.startMs) / e.reveal.durationMs, 0, 1);
}

export function lerpPoint(p1, p2, t) {
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t
  ];
}

function wobble(a, s) {
  const env = Math.sin(a * Math.PI);
  return (Math.sin(a * Math.PI * 2 * 3 + s) * 1.8 + Math.sin(a * Math.PI * 2 * 7.3 + s * 1.7) * 0.7) * env;
}

export function tipPos(e, p, source) {
  const strokeData = getRegionPngStrokes(e, source);
  const points = strokeData ? strokeData.points : null;
  const INK_RATIO = 0.70;
  if (points && points.length > 1) {
    const lastInkPt = points[points.length - 1];
    if (p <= INK_RATIO) {
      const inkP = p / INK_RATIO;
      const idx = Math.min(points.length - 1, Math.floor(inkP * points.length));
      return points[idx];
    } else {
      const colorP = (p - INK_RATIO) / (1 - INK_RATIO);
      const easeP = -(Math.cos(Math.PI * colorP) - 1) / 2;
      const r = e.region;
      const d = e.reveal.direction;
      const PASSES = 3;
      const passP = (colorP * PASSES) % 1.0;
      const forward = Math.floor(colorP * PASSES) % 2 === 0;
      const sweepCross = forward ? passP : (1.0 - passP);
      let targetX, targetY;
      if (d === 'left_to_right') {
        targetX = r.x + r.width * easeP;
        targetY = r.y + r.height * sweepCross;
      } else if (d === 'right_to_left') {
        targetX = r.x + r.width * (1 - easeP);
        targetY = r.y + r.height * sweepCross;
      } else if (d === 'top_to_bottom') {
        targetX = r.x + r.width * sweepCross;
        targetY = r.y + r.height * easeP;
      } else {
        targetX = r.x + r.width * sweepCross;
        targetY = r.y + r.height * (1 - easeP);
      }
      const seed = r.x * 0.13 + r.y * 0.27;
      const w = wobble(colorP, seed);
      let basePos;
      if (colorP < 0.20) {
        basePos = lerpPoint(lastInkPt, [targetX, targetY], colorP / 0.20);
      } else {
        basePos = [targetX, targetY];
      }
      return (d === 'top_to_bottom' || d === 'bottom_to_top') ? [basePos[0] + w, basePos[1]] : [basePos[0], basePos[1] + w];
    }
  }

  if (e.reveal.style === 'typewriter') {
    const r = e.region;
    const curX = r.x + r.width * p;
    const midY = r.y + r.height / 2;
    const wave = Math.sin(p * Math.PI * 28) * (r.height * 0.25);
    return [curX, midY + wave];
  }

  const r = e.region;
  const hp = e.handPath || {};
  const s = hp.start || [r.x, r.y];
  const ed = hp.end || [r.x + r.width, r.y + r.height];
  const d = e.reveal.direction;
  const seed = r.x * 0.13 + r.y * 0.27;
  const w = wobble(p, seed);
  const x = s[0] + (ed[0] - s[0]) * p;
  const y = s[1] + (ed[1] - s[1]) * p;
  return (d === 'top_to_bottom' || d === 'bottom_to_top') ? [x + w, y] : [x, y + w];
}

export function drawWavyMask(ctx, e, p) {
  const r = e.region;
  const d = e.reveal.direction;
  const easeP = -(Math.cos(Math.PI * p) - 1) / 2;
  ctx.save();
  ctx.beginPath();
  if (d === 'left_to_right') {
    const sweepX = r.x + r.width * easeP;
    const waveAmp = Math.min(20, r.height * 0.12);
    ctx.moveTo(r.x, r.y);
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const curY = r.y + (r.height * i) / steps;
      const wave = Math.sin((curY / 25) + p * 8) * waveAmp + Math.sin((curY / 10) + 1.5) * (waveAmp * 0.4);
      ctx.lineTo(sweepX + wave, curY);
    }
    ctx.lineTo(r.x, r.y + r.height);
    ctx.lineTo(r.x, r.y);
  } else if (d === 'right_to_left') {
    const sweepX = r.x + r.width * (1 - easeP);
    const waveAmp = Math.min(20, r.height * 0.12);
    ctx.moveTo(r.x + r.width, r.y);
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const curY = r.y + (r.height * i) / steps;
      const wave = Math.sin((curY / 25) + p * 8) * waveAmp + Math.sin((curY / 10) + 1.5) * (waveAmp * 0.4);
      ctx.lineTo(sweepX - wave, curY);
    }
    ctx.lineTo(r.x + r.width, r.y + r.height);
    ctx.lineTo(r.x + r.width, r.y);
  } else if (d === 'top_to_bottom') {
    const sweepY = r.y + r.height * easeP;
    const waveAmp = Math.min(20, r.width * 0.12);
    ctx.moveTo(r.x, r.y);
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const curX = r.x + (r.width * i) / steps;
      const wave = Math.sin((curX / 25) + p * 8) * waveAmp + Math.sin((curX / 10) + 1.5) * (waveAmp * 0.4);
      ctx.lineTo(curX, sweepY + wave);
    }
    ctx.lineTo(r.x + r.width, r.y);
    ctx.lineTo(r.x, r.y);
  } else {
    const sweepY = r.y + r.height * (1 - easeP);
    const waveAmp = Math.min(20, r.width * 0.12);
    ctx.moveTo(r.x, r.y + r.height);
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const curX = r.x + (r.width * i) / steps;
      const wave = Math.sin((curX / 25) + p * 8) * waveAmp + Math.sin((curX / 10) + 1.5) * (waveAmp * 0.4);
      ctx.lineTo(curX, sweepY - wave);
    }
    ctx.lineTo(r.x + r.width, r.y + r.height);
    ctx.lineTo(r.x, r.y + r.height);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function renderCanvas(ctx, cfg, source, elements, paperColor, time, isPlaying, renderCaches) {
  if (!cfg || !source) return;
  const w = cfg.canvas.width, h = cfg.canvas.height;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, w, h);

  const done = elements.length ? Math.max(...elements.map(e => e.reveal.startMs + e.reveal.durationMs)) : 0;
  const showFull = !elements.length || (!isPlaying && time <= 0) || time >= done + 500;

  if (showFull) {
    ctx.drawImage(source, 0, 0, w, h);
  } else if (!isPlaying) {
    // Config mode: fast preview
    const ordered = elements.slice().sort((a, b) => a.reveal.startMs - b.reveal.startMs);
    ordered.forEach((e, index) => {
      const p = getProgress(time, e);
      if (!p) return;
      const r = e.region;
      const d = e.reveal.direction;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ordered.slice(index + 1).forEach(later => {
        const lr = later.region;
        ctx.rect(lr.x + lr.width, lr.y, -lr.width, lr.height);
      });
      ctx.restore();
      ctx.save();
      let clipX = r.x, clipY = r.y, clipW = r.width, clipH = r.height;
      if (d === 'left_to_right')       clipW = r.width * p;
      else if (d === 'right_to_left')  { clipX = r.x + r.width * (1 - p); clipW = r.width * p; }
      else if (d === 'top_to_bottom')  clipH = r.height * p;
      else if (d === 'bottom_to_top')  { clipY = r.y + r.height * (1 - p); clipH = r.height * p; }
      else { clipW = r.width * p; clipH = r.height * p; }
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ordered.slice(index + 1).forEach(later => {
        const lr = later.region;
        ctx.rect(lr.x, lr.y, lr.width, lr.height);
      });
      (e.reveal.protectedRegions || []).forEach(pr => ctx.rect(pr.x, pr.y, pr.width, pr.height));
      ctx.clip('evenodd');
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
    });
  } else {
    // Playing mode: full render pipeline
    if (!renderCaches.current || renderCaches.current.w !== w || renderCaches.current.h !== h) {
      const mkC = document.createElement('canvas');
      mkC.width = w;
      mkC.height = h;
      const mkX = mkC.getContext('2d', { willReadFrequently: true });
      const cmpC = document.createElement('canvas');
      cmpC.width = w;
      cmpC.height = h;
      const cmpX = cmpC.getContext('2d');
      const scratchC = document.createElement('canvas');
      const scratchX = scratchC.getContext('2d', { willReadFrequently: true });
      renderCaches.current = { w, h, mkC, mkX, cmpC, cmpX, scratchC, scratchX };
    }

    const { mkC, mkX, cmpC, cmpX, scratchC, scratchX } = renderCaches.current;
    mkX.clearRect(0, 0, w, h);

    const ordered = elements.slice().sort((a, b) => a.reveal.startMs - b.reveal.startMs);
    ordered.forEach((e, index) => {
      const p = getProgress(time, e);
      if (p <= 0) return;
      if (p >= 1) {
        mkX.save();
        mkX.fillStyle = 'white';
        const r = e.region;
        if (r.polygon && Array.isArray(r.polygon) && r.polygon.length >= 3) {
          mkX.beginPath();
          r.polygon.forEach((pt, idx) => {
            if (idx === 0) mkX.moveTo(pt[0], pt[1]);
            else mkX.lineTo(pt[0], pt[1]);
          });
          mkX.closePath();
          mkX.fill();
        } else {
          mkX.fillRect(r.x, r.y, r.width, r.height);
        }
        mkX.restore();
      }
    });

    cmpX.clearRect(0, 0, w, h);
    cmpX.drawImage(source, 0, 0);
    cmpX.globalCompositeOperation = 'destination-in';
    cmpX.drawImage(mkC, 0, 0);
    ctx.drawImage(cmpC, 0, 0);
  }
}
