import { NextRequest } from 'next/server';
import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

const ALLOWED_EXTENSIONS = ['.webm', '.mp4', '.mkv', '.avi'];

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('path');

  if (!filePath) {
    return Response.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  // Resolve to absolute and check for traversal
  const resolved = path.resolve(filePath);
  if (resolved !== filePath) {
    return Response.json({ error: 'Invalid path' }, { status: 400 });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  try {
    const stats = await stat(resolved);
    if (!stats.isFile()) {
      return Response.json({ error: 'Not a file' }, { status: 400 });
    }

    const mimeTypes: Record<string, string> = {
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
    };

    const range = req.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunkSize = end - start + 1;

      const nodeStream = createReadStream(resolved, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk) => controller.enqueue(chunk));
          nodeStream.on('end', () => controller.close());
          nodeStream.on('error', (err) => controller.error(err));
        },
        cancel() {
          nodeStream.destroy();
        },
      });

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        },
      });
    }

    const nodeStream = createReadStream(resolved);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(webStream, {
      headers: {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Content-Length': String(stats.size),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
}
