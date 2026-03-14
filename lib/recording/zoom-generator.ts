import { readFileSync } from 'fs';

interface MouseEntry {
  t: number;
  x: number;
  y: number;
}

interface Keyframe {
  t: number;
  cx: number;
  cy: number;
  cropW: number;
  cropH: number;
  ease: number;
  label: string;
}

export interface ZoomKeyframes {
  source: { width: number; height: number };
  output: { width: number; height: number };
  keyframes: Keyframe[];
}

interface GeneratorOptions {
  sourceWidth?: number;
  sourceHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  bucketSize?: number;      // seconds per bucket (default 1)
  clusterThreshold?: number; // max centroid drift to merge buckets (default 300px)
  minCropW?: number;        // minimum crop width (default 1920)
  maxCropW?: number;        // maximum crop width (default 2560)
}

/**
 * Read a JSONL mouse log file and return parsed entries.
 */
function readMouseLog(logPath: string): MouseEntry[] {
  const content = readFileSync(logPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as MouseEntry);
}

/**
 * Bucket mouse entries into time windows and compute centroid + spread per bucket.
 */
function bucketize(entries: MouseEntry[], bucketSize: number) {
  if (entries.length === 0) return [];

  const maxT = entries[entries.length - 1].t;
  const bucketCount = Math.ceil(maxT / bucketSize) || 1;
  const buckets: { cx: number; cy: number; spread: number; t: number; count: number }[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const tStart = i * bucketSize;
    const tEnd = (i + 1) * bucketSize;
    const inBucket = entries.filter(e => e.t >= tStart && e.t < tEnd);

    if (inBucket.length === 0) {
      // Use previous bucket's centroid if empty
      const prev = buckets.length > 0 ? buckets[buckets.length - 1] : { cx: entries[0].x, cy: entries[0].y, spread: 0 };
      buckets.push({ cx: prev.cx, cy: prev.cy, spread: 0, t: tStart, count: 0 });
      continue;
    }

    const cx = Math.round(inBucket.reduce((s, e) => s + e.x, 0) / inBucket.length);
    const cy = Math.round(inBucket.reduce((s, e) => s + e.y, 0) / inBucket.length);

    // Spread = max distance from centroid
    const spread = Math.max(...inBucket.map(e =>
      Math.sqrt((e.x - cx) ** 2 + (e.y - cy) ** 2)
    ));

    buckets.push({ cx, cy, spread, t: tStart, count: inBucket.length });
  }

  return buckets;
}

/**
 * Cluster contiguous buckets where centroid stays within threshold.
 */
function clusterBuckets(
  buckets: ReturnType<typeof bucketize>,
  threshold: number,
  bucketSize: number,
) {
  if (buckets.length === 0) return [];

  const clusters: {
    startT: number;
    endT: number;
    cx: number;
    cy: number;
    maxSpread: number;
  }[] = [];

  let clusterStart = 0;

  for (let i = 1; i <= buckets.length; i++) {
    const shouldSplit =
      i === buckets.length ||
      Math.sqrt(
        (buckets[i].cx - buckets[clusterStart].cx) ** 2 +
        (buckets[i].cy - buckets[clusterStart].cy) ** 2,
      ) > threshold;

    if (shouldSplit) {
      const slice = buckets.slice(clusterStart, i);
      const totalCount = slice.reduce((s, b) => s + b.count, 0) || 1;
      // Weighted centroid by entry count
      const cx = Math.round(
        slice.reduce((s, b) => s + b.cx * (b.count || 1), 0) / totalCount,
      );
      const cy = Math.round(
        slice.reduce((s, b) => s + b.cy * (b.count || 1), 0) / totalCount,
      );
      const maxSpread = Math.max(...slice.map(b => b.spread));

      clusters.push({
        startT: buckets[clusterStart].t,
        endT: buckets[i - 1].t + bucketSize,
        cx,
        cy,
        maxSpread,
      });

      if (i < buckets.length) clusterStart = i;
    }
  }

  return clusters;
}

/**
 * Determine crop dimensions based on mouse spread.
 * Tighter spread → more zoom (smaller crop), wider spread → less zoom.
 */
function computeCropSize(
  spread: number,
  minCropW: number,
  maxCropW: number,
): { cropW: number; cropH: number } {
  // Map spread 0-500px to cropW minCropW-maxCropW
  const t = Math.min(spread / 500, 1);
  const cropW = Math.round(minCropW + (maxCropW - minCropW) * t);
  const cropH = Math.round(cropW * 9 / 16);
  return { cropW, cropH };
}

/**
 * Determine which monitor a point is on.
 */
function monitorLabel(x: number): string {
  return x < 2560 ? 'DP-1' : 'HDMI-1';
}

/**
 * Clamp crop center so the crop window stays within source bounds.
 */
function clampCenter(
  cx: number,
  cy: number,
  cropW: number,
  cropH: number,
  srcW: number,
  srcH: number,
): { cx: number; cy: number } {
  const halfW = cropW / 2;
  const halfH = cropH / 2;
  return {
    cx: Math.round(Math.max(halfW, Math.min(srcW - halfW, cx))),
    cy: Math.round(Math.max(halfH, Math.min(srcH - halfH, cy))),
  };
}

/**
 * Generate zoom keyframes from a mouse log file.
 */
export function generateKeyframes(
  mouseLogPath: string,
  options: GeneratorOptions = {},
): ZoomKeyframes {
  const {
    sourceWidth = 4480,
    sourceHeight = 1440,
    outputWidth = 1920,
    outputHeight = 1080,
    bucketSize = 1,
    clusterThreshold = 300,
    minCropW = 960,
    maxCropW = 1920,
  } = options;

  const entries = readMouseLog(mouseLogPath);

  if (entries.length === 0) {
    // No mouse data — return a single static keyframe showing full DP-1
    return {
      source: { width: sourceWidth, height: sourceHeight },
      output: { width: outputWidth, height: outputHeight },
      keyframes: [{
        t: 0,
        cx: 960,
        cy: 540,
        cropW: 1920,
        cropH: 1080,
        ease: 0.5,
        label: 'DP-1 default (no mouse data)',
      }],
    };
  }

  const buckets = bucketize(entries, bucketSize);
  const clusters = clusterBuckets(buckets, clusterThreshold, bucketSize);

  const keyframes: Keyframe[] = [];

  for (const cluster of clusters) {
    const { cropW, cropH } = computeCropSize(cluster.maxSpread, minCropW, maxCropW);
    const { cx, cy } = clampCenter(
      cluster.cx, cluster.cy, cropW, cropH, sourceWidth, sourceHeight,
    );

    const monitor = monitorLabel(cluster.cx);
    const zoomPct = Math.round((1 - (cropW - minCropW) / (maxCropW - minCropW)) * 100);

    keyframes.push({
      t: cluster.startT,
      cx,
      cy,
      cropW,
      cropH,
      ease: 0.5,
      label: `${monitor} ${zoomPct}% zoom`,
    });
  }

  // Merge keyframes that are very close together (< 0.5s apart)
  const merged: Keyframe[] = [keyframes[0]];
  for (let i = 1; i < keyframes.length; i++) {
    const prev = merged[merged.length - 1];
    if (keyframes[i].t - prev.t < 0.5) {
      // Keep the one with tighter zoom
      if (keyframes[i].cropW < prev.cropW) {
        merged[merged.length - 1] = keyframes[i];
      }
    } else {
      merged.push(keyframes[i]);
    }
  }

  // Cap at 20 keyframes to keep ffmpeg expressions manageable
  let final = merged;
  if (final.length > 20) {
    // Keep evenly spaced keyframes
    const step = (final.length - 1) / 19;
    const sampled: Keyframe[] = [];
    for (let i = 0; i < 20; i++) {
      sampled.push(final[Math.round(i * step)]);
    }
    final = sampled;
  }

  return {
    source: { width: sourceWidth, height: sourceHeight },
    output: { width: outputWidth, height: outputHeight },
    keyframes: final,
  };
}
