import { readdir, stat } from 'fs/promises';
import path from 'path';

const VIDEO_DIR = '/opt/automateLinux/data';
const VIDEO_EXTENSIONS = ['.webm', '.mp4', '.mkv', '.avi'];

export async function GET() {
  try {
    const entries = await readdir(VIDEO_DIR);
    const videos: { name: string; path: string; size: number; modified: string }[] = [];

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;
      if (entry.startsWith('_rec_')) continue; // skip temp recording fragments

      const fullPath = path.join(VIDEO_DIR, entry);
      const stats = await stat(fullPath);
      if (!stats.isFile()) continue;

      videos.push({
        name: entry,
        path: fullPath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    }

    videos.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return Response.json(videos);
  } catch {
    return Response.json([], { status: 200 });
  }
}
