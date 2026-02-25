/**
 * Single source of truth for the triage-ai version.
 * Import this everywhere instead of reading package.json directly.
 */
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
export const VERSION: string =
  (_require('../package.json') as { version: string }).version;
