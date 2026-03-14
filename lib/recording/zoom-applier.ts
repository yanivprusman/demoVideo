import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import type { ZoomKeyframes } from './zoom-generator';

/**
 * Get video duration and fps via ffprobe.
 */
function probeVideo(filePath: string): { duration: number; fps: number } {
  const result = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=duration,r_frame_rate',
    '-of', 'json',
    filePath,
  ], { timeout: 10000 });

  const data = JSON.parse(result.toString());
  const stream = data.streams?.[0] || {};

  let duration = parseFloat(stream.duration || '0');
  if (!duration) {
    // Fallback: get container duration
    const fmt = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: 10000 });
    const fmtData = JSON.parse(fmt.toString());
    duration = parseFloat(fmtData.format?.duration || '10');
  }

  let fps = 30;
  if (stream.r_frame_rate) {
    const [num, den] = stream.r_frame_rate.split('/').map(Number);
    if (den) fps = num / den;
  }

  return { duration, fps };
}

/**
 * Build an ffmpeg expression that interpolates between keyframes using cosine easing.
 *
 * For a property (e.g., cx), generates nested if(between(t,...), lerp, ...) expressions.
 * Cosine easing: value = a + (b - a) * (1 - cos(progress * PI)) / 2
 */
function buildInterpolationExpr(
  keyframes: { t: number; value: number }[],
  duration: number,
  easeDuration: number,
): string {
  if (keyframes.length === 0) return '0';
  if (keyframes.length === 1) return String(keyframes[0].value);

  // Build from last to first using nested if/then/else
  let expr = String(keyframes[keyframes.length - 1].value);

  for (let i = keyframes.length - 2; i >= 0; i--) {
    const kf = keyframes[i];
    const nextKf = keyframes[i + 1];
    const a = kf.value;
    const b = nextKf.value;

    if (a === b) {
      // No change — just hold the value during this segment
      expr = `if(lt(t,${nextKf.t.toFixed(3)}),${a},${expr})`;
      continue;
    }

    // Transition happens over easeDuration seconds, centered at the boundary
    const transStart = Math.max(nextKf.t - easeDuration, kf.t);
    const transEnd = nextKf.t;

    // During hold phase (kf.t to transStart): hold value a
    // During transition (transStart to transEnd): cosine ease from a to b
    // After: continue to next expression

    const progress = `(t-${transStart.toFixed(3)})/${(transEnd - transStart).toFixed(3)}`;
    const cosineEase = `${a}+(${b}-${a})*(1-cos(${progress}*PI))/2`;

    expr = `if(lt(t,${transStart.toFixed(3)}),${a},if(lt(t,${transEnd.toFixed(3)}),${cosineEase},${expr}))`;
  }

  return expr;
}

/**
 * Apply zoom (crop + scale) to a video using keyframes.
 */
export function applyZoom(
  inputPath: string,
  keyframesPath: string,
  outputPath: string,
): void {
  const keyframesData: ZoomKeyframes = JSON.parse(readFileSync(keyframesPath, 'utf-8'));
  const { keyframes, source, output } = keyframesData;

  if (keyframes.length === 0) {
    throw new Error('No keyframes in ' + keyframesPath);
  }

  const { duration } = probeVideo(inputPath);

  // Default ease duration: 0.5 seconds for transitions
  const defaultEaseDuration = 0.5;

  // Build interpolation expressions for each property
  const cxExpr = buildInterpolationExpr(
    keyframes.map(kf => ({ t: kf.t, value: kf.cx })),
    duration,
    defaultEaseDuration,
  );
  const cyExpr = buildInterpolationExpr(
    keyframes.map(kf => ({ t: kf.t, value: kf.cy })),
    duration,
    defaultEaseDuration,
  );
  const cwExpr = buildInterpolationExpr(
    keyframes.map(kf => ({ t: kf.t, value: kf.cropW })),
    duration,
    defaultEaseDuration,
  );
  const chExpr = buildInterpolationExpr(
    keyframes.map(kf => ({ t: kf.t, value: kf.cropH })),
    duration,
    defaultEaseDuration,
  );

  // crop filter: x = cx - cropW/2, y = cy - cropH/2
  // Clamp to source bounds
  const cropX = `min(max(0,(${cxExpr})-(${cwExpr})/2),${source.width}-(${cwExpr}))`;
  const cropY = `min(max(0,(${cyExpr})-(${chExpr})/2),${source.height}-(${chExpr}))`;

  // Wrap expressions in single quotes so ffmpeg's filter parser doesn't
  // interpret commas inside if() as filter chain separators
  const vf = `crop=w='${cwExpr}':h='${chExpr}':x='${cropX}':y='${cropY}':exact=1,scale=${output.width}:${output.height}:flags=lanczos`;

  execFileSync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-r', '30',
    '-an',
    outputPath,
  ], { timeout: 600000 });
}
