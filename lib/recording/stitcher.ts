import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';
import { applyZoom } from './zoom-applier';

interface SegmentInfo {
  path: string;
  speedUp?: number;
  transition?: 'fade' | 'cut';
  keyframesPath?: string;
}

function hasAudioStream(filePath: string): boolean {
  try {
    const result = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
      filePath,
    ], { timeout: 10000 });
    return result.toString().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Apply zoom to a segment if keyframes exist, returning the zoomed file path.
 */
function zoomSegment(filePath: string, keyframesPath?: string): { path: string; isTemp: boolean } {
  if (!keyframesPath || !existsSync(keyframesPath)) {
    return { path: filePath, isTemp: false };
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const zoomedPath = path.join(dir, `${base}_zoomed${ext}`);

  applyZoom(filePath, keyframesPath, zoomedPath);
  return { path: zoomedPath, isTemp: true };
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
  const args = ['-y', '-i', filePath, '-filter:v', videoFilter, '-r', '30'];

  if (hasAudioStream(filePath)) {
    const atempoFilters: string[] = [];
    let remaining = speed;
    while (remaining > 2) {
      atempoFilters.push('atempo=2.0');
      remaining /= 2;
    }
    atempoFilters.push(`atempo=${remaining}`);
    args.push('-filter:a', atempoFilters.join(','));
  } else {
    args.push('-an');
  }

  args.push(speedPath);
  execFileSync('ffmpeg', args, { timeout: 600000 });

  return speedPath;
}

/**
 * Stitch multiple segments into a final clip.
 * Applies per-segment speedUp, then concatenates with crossfade or hard cut.
 */
export function stitchSegments(segments: SegmentInfo[], outputPath: string): string {
  if (segments.length === 0) throw new Error('No segments to stitch');
  if (segments.length === 1) {
    // Single segment — zoom then speed up if needed
    const zoomed = zoomSegment(segments[0].path, segments[0].keyframesPath);
    const result = speedUpSegment(zoomed.path, segments[0].speedUp || 1);
    if (result !== outputPath) {
      execFileSync('cp', [result, outputPath], { timeout: 30000 });
      if (result !== zoomed.path) unlinkSync(result);
    }
    if (zoomed.isTemp && existsSync(zoomed.path)) {
      try { unlinkSync(zoomed.path); } catch { /* ignore */ }
    }
    return outputPath;
  }

  // Zoom then speed up segments
  const processed: { path: string; isTemp: boolean; transition: 'fade' | 'cut' }[] = [];
  const tempZoomed: string[] = [];
  for (const seg of segments) {
    const zoomed = zoomSegment(seg.path, seg.keyframesPath);
    if (zoomed.isTemp) tempZoomed.push(zoomed.path);

    const speed = seg.speedUp || 1;
    const sped = speedUpSegment(zoomed.path, speed);
    processed.push({
      path: sped,
      isTemp: sped !== seg.path,
      transition: seg.transition || 'fade',
    });
  }

  // Use concat demux — reliable across all segment types
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

  // Clean up temp files (zoomed + sped-up)
  for (const p of processed) {
    if (p.isTemp && existsSync(p.path)) {
      try { unlinkSync(p.path); } catch { /* ignore */ }
    }
  }
  for (const zp of tempZoomed) {
    if (existsSync(zp)) {
      try { unlinkSync(zp); } catch { /* ignore */ }
    }
  }

  return outputPath;
}
