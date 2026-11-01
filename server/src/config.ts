import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: resolve(dataDir, 'purrfect.db'),
  uploadDir: resolve(dataDir, 'uploads'),
  clientDist: resolve(root, 'client/dist'),
  // Set INSECURE_COOKIES=1 only to try a production build over plain http on localhost.
  secureCookies: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
};
