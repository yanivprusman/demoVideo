import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';

interface SegmentInfo {
  path: string;
  speedUp?: number;
  transition?: 'fade' | 'cut';
}

/**
 * Speed up a single segment file in-place.
 */
function speedUpSegment(filePath: string, speed: number): string {
  if (speed <= 1) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const speedPath = path.join(dir, `${base}_speed${ext}`);

  const videoFilter = `setpts=PTS/${speed}`;
  const atempoFilters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    atempoFilters.push('atempo=2.0');
    remaining /= 2;
  }
  atempoFilters.push(`atempo=${remaining}`);
  const audioFilter = atempoFilters.join(',');

  execFileSync('ffmpeg', [
    '-y', '-i', filePath,
    '-filter:v', videoFilter,
    '-filter:a', audioFilter,
    speedPath,
  ], { timeout: 600000 });

  return speedPath;
}

/**
 * Stitch multiple segments into a final clip.
 * Applies per-segment speedUp, then concatenates with crossfade or hard cut.
 */
export function stitchSegments(segments: SegmentInfo[], outputPath: string): string {
  if (segments.length === 0) throw new Error('No segments to stitch');
  if (segments.length === 1) {
    // Single segment — just speed up if needed and copy
    const result = speedUpSegment(segments[0].path, segments[0].speedUp || 1);
    if (result !== outputPath) {
      execFileSync('cp', [result, outputPath], { timeout: 30000 });
      if (result !== segments[0].path) unlinkSync(result);
    }
    return outputPath;
  }

  // Speed up segments that need it
  const processed: { path: string; isTemp: boolean; transition: 'fade' | 'cut' }[] = [];
  for (const seg of segments) {
    const speed = seg.speedUp || 1;
    const sped = speedUpSegment(seg.path, speed);
    processed.push({
      path: sped,
      isTemp: sped !== seg.path,
      transition: seg.transition || 'fade',
    });
  }

  // Check if any segment uses crossfade
  const hasFade = processed.some(p => p.transition === 'fade');

  if (!hasFade) {
    // All hard cuts — simple concat demux
    const concatList = processed.map(p => `file '${p.path}'`).join('\n');
    const listFile = path.join(path.dirname(outputPath), '_concat_list.txt');
    writeFileSync(listFile, concatList);

    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath,
    ], { timeout: 600000 });

    unlinkSync(listFile);
  } else {
    // Use filter_complex for crossfade between segments
    // Build a progressive crossfade chain
    const FADE_DURATION = 0.3;
    const inputs: string[] = [];
    for (const p of processed) {
      inputs.push('-i', p.path);
    }

    // For simplicity with many segments, use concat filter with crossfade
    // between each pair where transition is 'fade'
    let filterComplex = '';
    let lastStream = '[0:v]';
    let lastAStream = '[0:a]';

    for (let i = 1; i < processed.length; i++) {
      const useFade = processed[i].transition === 'fade';
      const outV = i < processed.length - 1 ? `[v${i}]` : '[outv]';
      const outA = i < processed.length - 1 ? `[a${i}]` : '[outa]';

      if (useFade) {
        filterComplex += `${lastStream}[${i}:v]xfade=transition=fade:duration=${FADE_DURATION}:offset=0${outV};`;
        filterComplex += `${lastAStream}[${i}:a]acrossfade=d=${FADE_DURATION}${outA};`;
      } else {
        filterComplex += `${lastStream}[${i}:v]concat=n=2:v=1:a=0${outV};`;
        filterComplex += `${lastAStream}[${i}:a]concat=n=2:v=0:a=1${outA};`;
      }

      lastStream = outV;
      lastAStream = outA;
    }

    // Remove trailing semicolon
    filterComplex = filterComplex.replace(/;$/, '');

    execFileSync('ffmpeg', [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      outputPath,
    ], { timeout: 600000 });
  }

  // Clean up temp sped-up files
  for (const p of processed) {
    if (p.isTemp && existsSync(p.path)) {
      try { unlinkSync(p.path); } catch { /* ignore */ }
    }
  }

  return outputPath;
}
