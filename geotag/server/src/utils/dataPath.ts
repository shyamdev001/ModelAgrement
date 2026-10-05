import fs from 'node:fs';
import path from 'node:path';

/**
 * Finds a file in server/data. On a PC the code runs from its own folder; on Vercel the
 * function runs from the project root with server/data copied next to it. Both are tried.
 */
export function dataPath(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', ...parts),
    path.join(process.cwd(), 'server', 'data', ...parts),
    path.join(process.cwd(), 'geotag', 'server', 'data', ...parts),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
