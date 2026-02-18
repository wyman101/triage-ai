"""
Repository scanning and context gathering.

Handles:
- Git diff detection
- File discovery based on prompt
- Secret redaction
"""

import os
import re
import subprocess
from pathlib import Path
from typing import Optional


# Patterns for secret detection
SECRET_PATTERNS = [
    # API keys and tokens
    (r'(?i)(api[_-]?key|apikey)\s*[:=]\s*["\']?[\w-]{20,}["\']?', '[REDACTED_API_KEY]'),
    (r'(?i)(secret[_-]?key|secretkey)\s*[:=]\s*["\']?[\w-]{20,}["\']?', '[REDACTED_SECRET]'),
    (r'(?i)(auth[_-]?token|authtoken)\s*[:=]\s*["\']?[\w-]{20,}["\']?', '[REDACTED_TOKEN]'),
    (r'(?i)(access[_-]?token)\s*[:=]\s*["\']?[\w-]{20,}["\']?', '[REDACTED_TOKEN]'),
    (r'(?i)(bearer)\s+[\w-]{20,}', '[REDACTED_BEARER]'),

    # Private keys ((?s) enables DOTALL so .*? matches across newlines)
    (r'(?s)-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----', '[REDACTED_PRIVATE_KEY]'),

    # Passwords
    (r'(?i)(password|passwd|pwd)\s*[:=]\s*["\']?[^\s"\']{8,}["\']?', '[REDACTED_PASSWORD]'),

    # Database URLs
    (r'(?i)(mysql|postgres|mongodb|redis)://[^\s"\']+', '[REDACTED_DB_URL]'),

    # AWS
    (r'AKIA[0-9A-Z]{16}', '[REDACTED_AWS_KEY]'),
    (r'(?i)aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["\']?[\w/+=]{40}["\']?', '[REDACTED_AWS_SECRET]'),

    # Generic long hex/base64 strings that look like secrets
    (r'(?i)(key|secret|token|password)\s*[:=]\s*["\']?[a-f0-9]{32,}["\']?', '[REDACTED_HEX_SECRET]'),
]

# Files to always skip
SKIP_FILES = {
    '.env', '.env.local', '.env.production', '.env.development',
    'credentials.json', 'secrets.json', 'config.secret.json',
    '.npmrc', '.pypirc', '.netrc', '.git-credentials',
    'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
}

# Extensions to skip
SKIP_EXTENSIONS = {
    '.pem', '.key', '.p12', '.pfx', '.jks',
    '.sqlite', '.db', '.sqlite3',
    '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.pyc', '.pyo', '.class',
}

# Common entrypoint patterns
ENTRYPOINT_PATTERNS = [
    'main.py', 'app.py', 'index.py', '__main__.py',
    'main.js', 'index.js', 'app.js', 'server.js',
    'main.ts', 'index.ts', 'app.ts',
    'main.go', 'cmd/main.go',
    'Makefile', 'setup.py', 'pyproject.toml', 'package.json',
]


class RepoScanner:
    """Scans repository for relevant context."""

    def __init__(self, root: Optional[Path] = None):
        """Initialize scanner with repository root."""
        self.root = root or Path.cwd()

    def scan(
        self,
        diff_only: bool = False,
        max_files: int = 30,
        prompt: str = ""
    ) -> dict:
        """
        Scan repository and return context for models.

        Returns dict with:
        - is_git_repo: bool
        - has_diff: bool
        - git_diff: str (if has_diff)
        - git_status: str
        - git_log: str (recent commits)
        - tree: str (directory structure)
        - files: list of {path, content, reason, description}
        - prompt: original prompt
        """
        context = {
            'is_git_repo': self._is_git_repo(),
            'has_diff': False,
            'git_diff': '',
            'git_status': '',
            'git_log': '',
            'tree': '',
            'files': [],
            'prompt': prompt,
            'root': str(self.root),
        }

        # Get git info
        if context['is_git_repo']:
            context['git_status'] = self._get_git_status()
            context['git_log'] = self._get_git_log()
            diff = self._get_git_diff()
            if diff:
                context['has_diff'] = True
                context['git_diff'] = self._redact_secrets(diff)

        # Get directory tree (always useful for orientation)
        context['tree'] = self._get_directory_tree()

        # If diff_only and we have a diff, that's all we need
        if diff_only and context['has_diff']:
            return context

        # Discover relevant files
        files = self._discover_files(prompt, max_files)
        context['files'] = files

        return context

    def _is_git_repo(self) -> bool:
        """Check if current directory is a git repository."""
        try:
            result = subprocess.run(
                ['git', 'rev-parse', '--git-dir'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False

    def _get_git_status(self) -> str:
        """Get git status output."""
        try:
            result = subprocess.run(
                ['git', 'status', '--short'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout if result.returncode == 0 else ''
        except Exception:
            return ''

    def _get_git_diff(self) -> str:
        """Get git diff for staged and unstaged changes."""
        try:
            # Get staged changes
            staged = subprocess.run(
                ['git', 'diff', '--cached'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=30
            )

            # Get unstaged changes
            unstaged = subprocess.run(
                ['git', 'diff'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=30
            )

            diff_parts = []
            if staged.returncode == 0 and staged.stdout:
                diff_parts.append("=== STAGED CHANGES ===\n" + staged.stdout)
            if unstaged.returncode == 0 and unstaged.stdout:
                diff_parts.append("=== UNSTAGED CHANGES ===\n" + unstaged.stdout)

            return '\n'.join(diff_parts)
        except Exception:
            return ''

    def _get_git_log(self, limit: int = 10) -> str:
        """Get recent git commits for context."""
        try:
            result = subprocess.run(
                ['git', 'log', f'-{limit}', '--oneline', '--no-decorate'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout if result.returncode == 0 else ''
        except Exception:
            return ''

    def _get_directory_tree(self, max_depth: int = 3, max_entries: int = 100) -> str:
        """Get directory structure for orientation."""
        try:
            # Try using tree command if available
            result = subprocess.run(
                ['tree', '-L', str(max_depth), '-I',
                 'node_modules|__pycache__|.git|venv|.venv|dist|build|*.pyc',
                 '--noreport', '--dirsfirst'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                return '\n'.join(lines[:max_entries])
        except Exception:
            pass

        # Fallback: manual directory listing
        try:
            lines = []
            for root, dirs, files in os.walk(self.root):
                # Skip hidden and common junk directories
                dirs[:] = [d for d in dirs if not d.startswith('.')
                          and d not in {'node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build'}]

                depth = root.replace(str(self.root), '').count(os.sep)
                if depth >= max_depth:
                    continue

                indent = '  ' * depth
                folder = os.path.basename(root) or '.'
                lines.append(f"{indent}{folder}/")

                for f in sorted(files)[:20]:  # Limit files per dir
                    if not f.startswith('.') and not f.endswith('.pyc'):
                        lines.append(f"{indent}  {f}")

                if len(lines) >= max_entries:
                    break

            return '\n'.join(lines[:max_entries])
        except Exception:
            return ''

    def _extract_file_description(self, content: str) -> str:
        """Extract first docstring or comment as file description."""
        if not content:
            return ''

        lines = content.split('\n')[:30]  # Check first 30 lines

        # Look for module docstring (Python)
        in_docstring = False
        docstring_lines = []
        for line in lines:
            stripped = line.strip()
            if not in_docstring:
                if stripped.startswith('"""') or stripped.startswith("'''"):
                    in_docstring = True
                    # Single line docstring
                    if stripped.count('"""') >= 2 or stripped.count("'''") >= 2:
                        return stripped.strip('"\'').strip()
                    docstring_lines.append(stripped.strip('"\''))
            else:
                if '"""' in stripped or "'''" in stripped:
                    docstring_lines.append(stripped.strip('"\''))
                    return ' '.join(docstring_lines)[:200]
                docstring_lines.append(stripped)

        # Look for file header comment
        comment_lines = []
        for line in lines[:10]:
            stripped = line.strip()
            if stripped.startswith('#') or stripped.startswith('//') or stripped.startswith('/*'):
                comment_lines.append(stripped.lstrip('#/').lstrip('*').strip())
            elif comment_lines:
                break

        if comment_lines:
            return ' '.join(comment_lines)[:200]

        return ''

    def _discover_files(self, prompt: str, max_files: int) -> list[dict]:
        """
        Discover relevant files based on prompt and repository structure.

        Returns list of {path, content, reason, description}
        """
        files = []
        seen = set()

        # Extract keywords from prompt
        keywords = self._extract_keywords(prompt)

        # 0. Find absolute file paths explicitly mentioned in prompt
        # This allows reading files from anywhere on the system (read-only)
        explicit_paths = re.findall(r'/[\w/.-]+\.(?:py|js|ts|html|css|json|yaml|yml|md|txt|sh|sql|php)', prompt)
        for path_str in explicit_paths:
            path = Path(path_str)
            if path_str not in seen and path.exists() and path.is_file():
                content = self._read_file(path)
                if content:
                    files.append({
                        'path': path_str,
                        'content': content,
                        'reason': 'explicitly mentioned in prompt',
                        'description': self._extract_file_description(content)
                    })
                    seen.add(path_str)
                    if len(files) >= max_files:
                        return files

        # Also check for directory paths - scan for relevant files
        explicit_dirs = re.findall(r'/[\w/.-]+/', prompt)
        for dir_str in explicit_dirs:
            if len(files) >= max_files:
                break
            dir_path = Path(dir_str.rstrip('/'))
            if dir_path.exists() and dir_path.is_dir():
                # Scan directory for source files
                for ext in ['*.py', '*.js', '*.ts', '*.html', '*.php']:
                    for match in dir_path.glob(f'**/{ext}'):
                        if str(match) not in seen and self._should_include_file(match):
                            content = self._read_file(match)
                            if content:
                                files.append({
                                    'path': str(match),
                                    'content': content,
                                    'reason': f'in explicitly mentioned directory {dir_str}',
                                    'description': self._extract_file_description(content)
                                })
                                seen.add(str(match))
                                if len(files) >= max_files:
                                    return files

        # 1. Find files mentioned in git diff
        if self._is_git_repo():
            diff_files = self._get_diff_file_list()
            for path in diff_files[:max_files // 3]:
                if path not in seen and self._should_include_file(path):
                    content = self._read_file(path)
                    if content:
                        files.append({
                            'path': str(path),
                            'content': content,
                            'reason': 'changed in git diff',
                            'description': self._extract_file_description(content)
                        })
                        seen.add(path)

        # 2. Find files matching keywords
        if keywords:
            keyword_files = self._find_files_by_keywords(keywords)
            for path, reason in keyword_files:
                if len(files) >= max_files:
                    break
                if path not in seen and self._should_include_file(path):
                    content = self._read_file(path)
                    if content:
                        files.append({
                            'path': str(path),
                            'content': content,
                            'reason': reason,
                            'description': self._extract_file_description(content)
                        })
                        seen.add(path)

        # 3. Find entrypoints
        for pattern in ENTRYPOINT_PATTERNS:
            if len(files) >= max_files:
                break
            matches = list(self.root.glob(f"**/{pattern}"))
            for path in matches[:2]:  # Max 2 per pattern
                if path not in seen and self._should_include_file(path):
                    content = self._read_file(path)
                    if content:
                        files.append({
                            'path': str(path.relative_to(self.root)),
                            'content': content,
                            'reason': f'entrypoint ({pattern})',
                            'description': self._extract_file_description(content)
                        })
                        seen.add(path)

        return files[:max_files]

    def _extract_keywords(self, prompt: str) -> list[str]:
        """Extract likely file/function/class names from prompt."""
        # Remove common words
        stop_words = {
            'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
            'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
            'these', 'those', 'i', 'you', 'we', 'they', 'it', 'my', 'your',
            'find', 'analyze', 'check', 'review', 'look', 'fix', 'update',
            'code', 'file', 'function', 'class', 'method', 'issue', 'bug',
            'error', 'problem', 'security', 'performance', 'test'
        }

        # Split on non-alphanumeric
        words = re.split(r'[^a-zA-Z0-9_]+', prompt.lower())

        # Filter
        keywords = []
        for word in words:
            if len(word) >= 3 and word not in stop_words:
                keywords.append(word)

        return keywords

    def _find_files_by_keywords(self, keywords: list[str]) -> list[tuple[Path, str]]:
        """Find files that match keywords in name or content."""
        results = []

        # Search by filename
        for keyword in keywords:
            try:
                # Use find command for speed
                result = subprocess.run(
                    ['find', '.', '-type', 'f', '-iname', f'*{keyword}*',
                     '-not', '-path', '*/.*', '-not', '-path', '*/node_modules/*',
                     '-not', '-path', '*/__pycache__/*', '-not', '-path', '*/venv/*'],
                    cwd=self.root,
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode == 0:
                    for line in result.stdout.strip().split('\n'):
                        if line:
                            path = self.root / line.lstrip('./')
                            results.append((path, f'filename matches "{keyword}"'))
            except Exception:
                pass

        # Search by content (using grep)
        for keyword in keywords[:5]:  # Limit content search
            try:
                result = subprocess.run(
                    ['grep', '-r', '-l', '-i', keyword,
                     '--include=*.py', '--include=*.js', '--include=*.ts',
                     '--include=*.go', '--include=*.java', '--include=*.php',
                     '--exclude-dir=.*', '--exclude-dir=node_modules',
                     '--exclude-dir=__pycache__', '--exclude-dir=venv'],
                    cwd=self.root,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if result.returncode == 0:
                    for line in result.stdout.strip().split('\n')[:10]:
                        if line:
                            path = self.root / line
                            results.append((path, f'content matches "{keyword}"'))
            except Exception:
                pass

        return results

    def _get_diff_file_list(self) -> list[Path]:
        """Get list of files changed in git diff."""
        try:
            result = subprocess.run(
                ['git', 'diff', '--name-only', 'HEAD'],
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                return [self.root / f for f in result.stdout.strip().split('\n') if f]
        except Exception:
            pass
        return []

    def _should_include_file(self, path: Path) -> bool:
        """Check if file should be included in context."""
        if isinstance(path, str):
            path = Path(path)

        # Check filename
        if path.name in SKIP_FILES:
            return False

        # Check extension
        if path.suffix.lower() in SKIP_EXTENSIONS:
            return False

        # Check path components
        skip_dirs = {'.git', 'node_modules', '__pycache__', 'venv', '.venv',
                     'vendor', 'dist', 'build', '.cache', '.tox'}
        if any(part in skip_dirs for part in path.parts):
            return False

        return True

    def _read_file(self, path: Path, max_size: int = 100_000) -> Optional[str]:
        """Read file content with size limit and secret redaction."""
        try:
            if isinstance(path, str):
                path = Path(path)

            if not path.is_absolute():
                path = self.root / path

            if not path.exists() or not path.is_file():
                return None

            # Check size
            if path.stat().st_size > max_size:
                return f"[FILE TOO LARGE: {path.stat().st_size} bytes]"

            content = path.read_text(encoding='utf-8', errors='replace')
            return self._redact_secrets(content)

        except Exception as e:
            return f"[ERROR READING FILE: {e}]"

    def _redact_secrets(self, content: str) -> str:
        """Redact potential secrets from content."""
        for pattern, replacement in SECRET_PATTERNS:
            content = re.sub(pattern, replacement, content, flags=re.DOTALL)
        return content
