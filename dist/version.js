/**
 * Single source of truth for the triage-ai version.
 * Import this everywhere instead of reading package.json directly.
 */
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
export const VERSION = _require('../package.json').version;
//# sourceMappingURL=version.js.map