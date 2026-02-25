/**
 * Repository scanning and context gathering.
 *
 * Handles:
 * - Git diff detection
 * - File discovery based on prompt
 * - Secret redaction
 *
 * TypeScript port of triage_cli/repo_scan.py — faithful port, same logic,
 * same constants, same behavior.
 */

import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep, extname, basename, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ScanContext, FileContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Patterns for secret detection: [pattern, replacement] */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // API keys and tokens
  [/(api[_-]?key|apikey)\s*[:=]\s*["']?[\w-]{20,}["']?/gi, '[REDACTED_API_KEY]'],
  [/(secret[_-]?key|secretkey)\s*[:=]\s*["']?[\w-]{20,}["']?/gi, '[REDACTED_SECRET]'],
  [/(auth[_-]?token|authtoken)\s*[:=]\s*["']?[\w-]{20,}["']?/gi, '[REDACTED_TOKEN]'],
  [/(access[_-]?token)\s*[:=]\s*["']?[\w-]{20,}["']?/gi, '[REDACTED_TOKEN]'],
  [/bearer\s+[\w-]{20,}/gi, '[REDACTED_BEARER]'],

  // Private keys (matches across newlines)
  [
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]',
  ],

  // Passwords
  [/(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, '[REDACTED_PASSWORD]'],

  // Database URLs
  [/(mysql|postgres|mongodb|redis):\/\/[^\s"']+/gi, '[REDACTED_DB_URL]'],

  // AWS
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  [/(aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*["']?[\w/+=]{40}["']?/gi, '[REDACTED_AWS_SECRET]'],

  // GitHub tokens (classic PAT, fine-grained, OAuth, app tokens)
  [/gh[pousr]_[A-Za-z0-9_]{36,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, '[REDACTED_GITHUB_PAT]'],

  // npm tokens
  [/npm_[A-Za-z0-9]{36,}/g, '[REDACTED_NPM_TOKEN]'],

  // Slack tokens and webhooks
  [/xox[boaprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, '[REDACTED_SLACK_WEBHOOK]'],

  // Stripe keys
  [/[sr]k_(live|test)_[A-Za-z0-9]{20,}/g, '[REDACTED_STRIPE_KEY]'],

  // Google API keys / service accounts
  [/AIza[A-Za-z0-9_-]{35}/g, '[REDACTED_GOOGLE_API_KEY]'],

  // Anthropic API keys
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]'],

  // OpenAI API keys
  [/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_OPENAI_KEY]'],

  // Generic long hex/base64 strings that look like secrets
  [/(key|secret|token|password)\s*[:=]\s*["']?[a-f0-9]{32,}["']?/gi, '[REDACTED_HEX_SECRET]'],
];

/** Files to always skip. */
const SKIP_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'credentials.json', 'secrets.json', 'config.secret.json',
  '.npmrc', '.pypirc', '.netrc', '.git-credentials',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
]);

/** Extensions to skip. */
const SKIP_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.jks',
  '.sqlite', '.db', '.sqlite3',
  '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.pyc', '.pyo', '.class',
]);

/** Common entrypoint patterns. */
const ENTRYPOINT_PATTERNS = [
  'main.py', 'app.py', 'index.py', '__main__.py',
  'main.js', 'index.js', 'app.js', 'server.js',
  'main.ts', 'index.ts', 'app.ts',
  'main.go', 'cmd/main.go',
  'Makefile', 'setup.py', 'pyproject.toml', 'package.json',
];

/** Stop words for keyword extraction. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'we', 'they', 'it', 'my', 'your',
  'find', 'analyze', 'check', 'review', 'look', 'fix', 'update',
  'code', 'file', 'function', 'class', 'method', 'issue', 'bug',
  'error', 'problem', 'security', 'performance', 'test',
]);

/** Directories to skip during traversal. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', 'venv', '.venv',
  'vendor', 'dist', 'build', '.cache', '.tox',
]);

// ---------------------------------------------------------------------------
// RepoScanner class
// ---------------------------------------------------------------------------

export class RepoScanner {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? process.cwd();
  }

  /**
   * Scan repository and return context for models.
   *
   * Returns ScanContext with:
   * - is_git_repo, has_diff, git_diff, git_status, git_log
   * - tree (directory structure)
   * - files: list of { path, content, reason, description }
   * - prompt: original prompt
   * - root: resolved repo root
   */
  scan(
    diffOnly = false,
    maxFiles = 30,
    prompt = '',
  ): ScanContext {
    const context: ScanContext = {
      is_git_repo: this._is_git_repo(),
      has_diff: false,
      git_diff: '',
      git_status: '',
      git_log: '',
      tree: '',
      files: [],
      prompt,
      root: this.root,
    };

    // Get git info
    if (context.is_git_repo) {
      context.git_status = this._get_git_status();
      context.git_log = this._get_git_log();
      const diff = this._get_git_diff();
      if (diff) {
        context.has_diff = true;
        context.git_diff = this._redact_secrets(diff);
      }
    }

    // Get directory tree (always useful for orientation)
    context.tree = this._get_directory_tree();

    // If diff_only and we have a diff, that's all we need
    if (diffOnly && context.has_diff) {
      return context;
    }

    // Discover relevant files
    context.files = this._discover_files(prompt, maxFiles);

    return context;
  }

  /** Check if current directory is a git repository. */
  _is_git_repo(): boolean {
    try {
      const result = spawnSync('git', ['rev-parse', '--git-dir'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 5000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /** Get git status output. */
  _get_git_status(): string {
    try {
      const result = spawnSync('git', ['status', '--short'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 10000,
      });
      return result.status === 0 ? (result.stdout ?? '') : '';
    } catch {
      return '';
    }
  }

  /** Get git diff for staged and unstaged changes. */
  _get_git_diff(): string {
    try {
      const staged = spawnSync('git', ['diff', '--cached'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 30000,
      });
      const unstaged = spawnSync('git', ['diff'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 30000,
      });

      const parts: string[] = [];
      if (staged.status === 0 && staged.stdout) {
        parts.push('=== STAGED CHANGES ===\n' + staged.stdout);
      }
      if (unstaged.status === 0 && unstaged.stdout) {
        parts.push('=== UNSTAGED CHANGES ===\n' + unstaged.stdout);
      }
      return parts.join('\n');
    } catch {
      return '';
    }
  }

  /** Get recent git commits for context. */
  _get_git_log(limit = 10): string {
    try {
      const result = spawnSync('git', ['log', `-${limit}`, '--oneline', '--no-decorate'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 10000,
      });
      return result.status === 0 ? (result.stdout ?? '') : '';
    } catch {
      return '';
    }
  }

  /** Get directory structure for orientation. */
  _get_directory_tree(maxDepth = 3, maxEntries = 100): string {
    // Try using tree command if available
    try {
      const result = spawnSync(
        'tree',
        [
          '-L', String(maxDepth),
          '-I', 'node_modules|__pycache__|.git|venv|.venv|dist|build|*.pyc',
          '--noreport',
          '--dirsfirst',
        ],
        { cwd: this.root, encoding: 'utf8', timeout: 10000 },
      );
      if (result.status === 0 && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        return lines.slice(0, maxEntries).join('\n');
      }
    } catch {
      // fall through to manual traversal
    }

    // Fallback: manual directory listing
    try {
      const lines: string[] = [];

      const walk = (dir: string, depth: number) => {
        if (depth >= maxDepth || lines.length >= maxEntries) return;

        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }

        const dirs: string[] = [];
        const files: string[] = [];
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const full = join(dir, entry);
          let isDir = false;
          try {
            isDir = statSync(full).isDirectory();
          } catch {
            continue;
          }
          if (isDir) {
            if (!SKIP_DIRS.has(entry)) dirs.push(entry);
          } else {
            if (!entry.endsWith('.pyc')) files.push(entry);
          }
        }

        const indent = '  '.repeat(depth);
        const folderName = depth === 0 ? '.' : basename(dir);
        lines.push(`${indent}${folderName}/`);

        for (const f of files.sort().slice(0, 20)) {
          lines.push(`${indent}  ${f}`);
        }

        for (const d of dirs) {
          if (lines.length >= maxEntries) break;
          walk(join(dir, d), depth + 1);
        }
      };

      walk(this.root, 0);
      return lines.slice(0, maxEntries).join('\n');
    } catch {
      return '';
    }
  }

  /** Extract first docstring or comment as file description. */
  _extract_file_description(content: string): string {
    if (!content) return '';

    const lines = content.split('\n').slice(0, 30);

    // Look for module docstring (Python)
    let inDocstring = false;
    const docstringLines: string[] = [];
    for (const line of lines) {
      const stripped = line.trim();
      if (!inDocstring) {
        if (stripped.startsWith('"""') || stripped.startsWith("'''")) {
          inDocstring = true;
          // Single-line docstring
          const tripleDouble = stripped.split('"""').length - 1;
          const tripleSingle = stripped.split("'''").length - 1;
          if (tripleDouble >= 2 || tripleSingle >= 2) {
            return stripped.replace(/"""|'''/g, '').trim();
          }
          docstringLines.push(stripped.replace(/"""|'''/g, ''));
        }
      } else {
        if (stripped.includes('"""') || stripped.includes("'''")) {
          docstringLines.push(stripped.replace(/"""|'''/g, ''));
          return docstringLines.join(' ').slice(0, 200);
        }
        docstringLines.push(stripped);
      }
    }

    // Look for file header comment
    const commentLines: string[] = [];
    for (const line of lines.slice(0, 10)) {
      const stripped = line.trim();
      if (
        stripped.startsWith('#') ||
        stripped.startsWith('//') ||
        stripped.startsWith('/*')
      ) {
        commentLines.push(stripped.replace(/^[#/*]+/, '').trim());
      } else if (commentLines.length > 0) {
        break;
      }
    }

    if (commentLines.length > 0) {
      return commentLines.join(' ').slice(0, 200);
    }

    return '';
  }

  /**
   * Discover relevant files based on prompt and repository structure.
   *
   * Returns list of FileContext objects.
   * Order: explicit paths → explicit dirs → git diff files → keyword search → entrypoints.
   */
  _discover_files(prompt: string, maxFiles: number): FileContext[] {
    const files: FileContext[] = [];
    const seen = new Set<string>();

    const keywords = this._extract_keywords(prompt);

    // 0. Find absolute file paths explicitly mentioned in prompt
    const explicitPathRe =
      /\/[\w/.-]+\.(?:py|js|ts|html|css|json|yaml|yml|md|txt|sh|sql|php)/g;
    const explicitPaths = [...prompt.matchAll(explicitPathRe)].map((m) => m[0]);

    for (const pathStr of explicitPaths) {
      if (seen.has(pathStr)) continue;
      if (!existsSync(pathStr) || !statSync(pathStr).isFile()) continue;

      const content = this._read_file(pathStr);
      if (content) {
        files.push({
          path: pathStr,
          content,
          reason: 'explicitly mentioned in prompt',
          description: this._extract_file_description(content),
        });
        seen.add(pathStr);
        if (files.length >= maxFiles) return files;
      }
    }

    // Also check for directory paths — scan for relevant files
    const explicitDirRe = /\/[\w/.-]+\//g;
    const explicitDirs = [...prompt.matchAll(explicitDirRe)].map((m) => m[0]);

    for (const dirStr of explicitDirs) {
      if (files.length >= maxFiles) break;
      const dirPath = dirStr.replace(/\/$/, '');
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue;

      for (const ext of ['*.py', '*.js', '*.ts', '*.html', '*.php']) {
        const pattern = ext.replace('*', '');
        const found = this._globDir(dirPath, pattern);
        for (const matchPath of found) {
          if (files.length >= maxFiles) break;
          if (seen.has(matchPath)) continue;
          if (!this._should_include_file(matchPath)) continue;

          const content = this._read_file(matchPath);
          if (content) {
            files.push({
              path: matchPath,
              content,
              reason: `in explicitly mentioned directory ${dirStr}`,
              description: this._extract_file_description(content),
            });
            seen.add(matchPath);
          }
        }
      }
    }

    // 1. Find files mentioned in git diff
    if (this._is_git_repo()) {
      const diffFiles = this._get_diff_file_list();
      for (const filePath of diffFiles.slice(0, Math.floor(maxFiles / 3))) {
        if (seen.has(filePath)) continue;
        if (!this._should_include_file(filePath)) continue;

        const content = this._read_file(filePath);
        if (content) {
          files.push({
            path: filePath,
            content,
            reason: 'changed in git diff',
            description: this._extract_file_description(content),
          });
          seen.add(filePath);
        }
      }
    }

    // 2. Find files matching keywords
    if (keywords.length > 0) {
      const keywordFiles = this._find_files_by_keywords(keywords);
      for (const [filePath, reason] of keywordFiles) {
        if (files.length >= maxFiles) break;
        if (seen.has(filePath)) continue;
        if (!this._should_include_file(filePath)) continue;

        const content = this._read_file(filePath);
        if (content) {
          files.push({
            path: filePath,
            content,
            reason,
            description: this._extract_file_description(content),
          });
          seen.add(filePath);
        }
      }
    }

    // 3. Find entrypoints
    for (const pattern of ENTRYPOINT_PATTERNS) {
      if (files.length >= maxFiles) break;

      const matches = this._globDir(this.root, pattern, true);
      for (const matchPath of matches.slice(0, 2)) {
        if (files.length >= maxFiles) break;
        if (seen.has(matchPath)) continue;
        if (!this._should_include_file(matchPath)) continue;

        const content = this._read_file(matchPath);
        if (content) {
          // Use relative path for entrypoints (matching Python's path.relative_to(self.root))
          let displayPath: string;
          try {
            displayPath = relative(this.root, matchPath);
          } catch {
            displayPath = matchPath;
          }
          files.push({
            path: displayPath,
            content,
            reason: `entrypoint (${pattern})`,
            description: this._extract_file_description(content),
          });
          seen.add(matchPath);
        }
      }
    }

    // 4. Fallback: if we found very few files, scan ALL source files in the repo
    //    This prevents 0-file results in small repos or when keywords don't match
    if (files.length < Math.min(5, maxFiles)) {
      const SOURCE_EXTENSIONS = new Set([
        '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.java', '.php',
        '.rb', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
        '.kt', '.scala', '.sh', '.bash', '.zsh', '.sql', '.html',
        '.css', '.scss', '.less', '.vue', '.svelte',
        '.yaml', '.yml', '.json', '.toml', '.xml', '.md',
      ]);

      const allSourceFiles = this._globDir(this.root, '', true)
        .filter((f) => {
          const ext = extname(f).toLowerCase();
          return SOURCE_EXTENSIONS.has(ext) && this._should_include_file(f) && !seen.has(f);
        })
        .slice(0, maxFiles - files.length);

      for (const matchPath of allSourceFiles) {
        if (files.length >= maxFiles) break;

        const content = this._read_file(matchPath);
        if (content) {
          let displayPath: string;
          try {
            displayPath = relative(this.root, matchPath);
          } catch {
            displayPath = matchPath;
          }
          files.push({
            path: displayPath,
            content,
            reason: 'source file in repository',
            description: this._extract_file_description(content),
          });
          seen.add(matchPath);
        }
      }
    }

    return files.slice(0, maxFiles);
  }

  /** Extract likely file/function/class names from prompt. */
  _extract_keywords(prompt: string): string[] {
    const words = prompt.toLowerCase().split(/[^a-zA-Z0-9_]+/);
    const keywords: string[] = [];
    for (const word of words) {
      if (word.length >= 3 && !STOP_WORDS.has(word)) {
        keywords.push(word);
      }
    }
    return keywords;
  }

  /** Find files that match keywords in name or content. */
  _find_files_by_keywords(keywords: string[]): Array<[string, string]> {
    const results: Array<[string, string]> = [];

    // Search by filename
    for (const keyword of keywords) {
      try {
        const result = spawnSync(
          'find',
          [
            '.', '-type', 'f', '-iname', `*${keyword}*`,
            '-not', '-path', '*/.*',
            '-not', '-path', '*/node_modules/*',
            '-not', '-path', '*/__pycache__/*',
            '-not', '-path', '*/venv/*',
          ],
          { cwd: this.root, encoding: 'utf8', timeout: 10000 },
        );
        if (result.status === 0 && result.stdout) {
          for (const line of result.stdout.trim().split('\n')) {
            if (line) {
              const resolved = resolve(this.root, line.replace(/^\.\//, ''));
              results.push([resolved, `filename matches "${keyword}"`]);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Search by content (using grep) — limit to first 5 keywords
    for (const keyword of keywords.slice(0, 5)) {
      try {
        const result = spawnSync(
          'grep',
          [
            '-r', '-l', '-i', keyword,
            '--include=*.py', '--include=*.js', '--include=*.ts',
            '--include=*.go', '--include=*.java', '--include=*.php',
            '--exclude-dir=.*', '--exclude-dir=node_modules',
            '--exclude-dir=__pycache__', '--exclude-dir=venv',
          ],
          { cwd: this.root, encoding: 'utf8', timeout: 30000 },
        );
        if (result.status === 0 && result.stdout) {
          const lines = result.stdout.trim().split('\n').slice(0, 10);
          for (const line of lines) {
            if (line) {
              const resolved = resolve(this.root, line);
              results.push([resolved, `content matches "${keyword}"`]);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return results;
  }

  /** Get list of files changed in git diff. */
  _get_diff_file_list(): string[] {
    try {
      const result = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: this.root,
        encoding: 'utf8',
        timeout: 10000,
      });
      if (result.status === 0 && result.stdout) {
        return result.stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((f) => resolve(this.root, f));
      }
    } catch {
      // ignore
    }
    return [];
  }

  /** Check if file should be included in context. */
  _should_include_file(filePath: string): boolean {
    const name = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    // Check filename
    if (SKIP_FILES.has(name)) return false;

    // Check extension
    if (SKIP_EXTENSIONS.has(ext)) return false;

    // Check path components
    const parts = filePath.split(sep);
    for (const part of parts) {
      if (SKIP_DIRS.has(part)) return false;
    }

    return true;
  }

  /** Read file content with size limit and secret redaction. */
  _read_file(filePath: string, maxSize = 100_000): string | null {
    try {
      let resolved = filePath;
      if (!filePath.startsWith('/')) {
        resolved = resolve(this.root, filePath);
      }

      if (!existsSync(resolved)) return null;

      const stat = statSync(resolved);
      if (!stat.isFile()) return null;

      if (stat.size > maxSize) {
        return `[FILE TOO LARGE: ${stat.size} bytes]`;
      }

      const content = readFileSync(resolved, { encoding: 'utf8' });
      return this._redact_secrets(content);
    } catch (e) {
      return `[ERROR READING FILE: ${String(e)}]`;
    }
  }

  /** Redact potential secrets from content. */
  _redact_secrets(content: string): string {
    let result = content;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Recursively glob a directory for files matching a suffix (e.g. ".py").
   * When recursive=false, only looks in top-level of the directory.
   */
  private _globDir(
    dir: string,
    suffix: string,
    recursive = true,
  ): string[] {
    // suffix can be like "*.py" or just ".py" or exact filename "package.json"
    const isExact = !suffix.includes('*');
    const normalizedSuffix = suffix.startsWith('*.')
      ? suffix.slice(1) // ".py"
      : suffix;

    const results: string[] = [];

    const walk = (current: string) => {
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = join(current, entry);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }

        if (isDir) {
          if (recursive && !SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
            walk(full);
          }
        } else {
          if (suffix === '') {
            // Empty suffix = match all files
            results.push(full);
          } else if (isExact) {
            if (entry === normalizedSuffix) results.push(full);
          } else {
            if (entry.endsWith(normalizedSuffix)) results.push(full);
          }
        }
      }
    };

    walk(dir);
    return results;
  }
}
