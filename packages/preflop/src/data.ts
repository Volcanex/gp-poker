import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(dataDir, name), 'utf8')) as T;
}
