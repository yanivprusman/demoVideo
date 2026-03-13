import { NextRequest } from 'next/server';
import { stat } from 'fs/promises';

export async function POST(req: NextRequest) {
  const { paths } = await req.json() as { paths: Record<string, string> };

  const results: Record<string, { exists: boolean; path: string }> = {};

  for (const [clipId, filePath] of Object.entries(paths)) {
    try {
      const stats = await stat(filePath);
      results[clipId] = { exists: stats.isFile(), path: filePath };
    } catch {
      results[clipId] = { exists: false, path: filePath };
    }
  }

  return Response.json(results);
}
