"""
Base model interface and data structures.
"""

import json
import os
import subprocess
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Optional


class Severity(str, Enum):
    """Issue severity levels."""
    S0 = "S0"  # Blocker - must fix immediately
    S1 = "S1"  # High - fix soon
    S2 = "S2"  # Medium - should fix
    S3 = "S3"  # Low - nice to fix


class Confidence(str, Enum):
    """Confidence levels."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Category(str, Enum):
    """Issue categories."""
    CORRECTNESS = "correctness"
    SECURITY = "security"
    PERFORMANCE = "performance"
    RELIABILITY = "reliability"
    MAINTAINABILITY = "maintainability"
    TESTS = "tests"
    STYLE = "style"


@dataclass
class Location:
    """Code location."""
    path: str
    start_line: int = 0
    end_line: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'Location':
        return cls(**data)


@dataclass
class Patch:
    """Proposed code patch."""
    path: str
    diff: str
    description: str = ""
    model: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'Patch':
        return cls(**data)


@dataclass
class Finding:
    """A single issue/finding from a model."""
    title: str
    severity: str
    confidence: str
    category: str
    location: Location
    evidence: str
    recommendation: str
    model: str = ""
    patch: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d['location'] = self.location.to_dict()
        return d

    @classmethod
    def from_dict(cls, data: dict) -> 'Finding':
        loc_data = data.pop('location', {})
        if isinstance(loc_data, dict):
            data['location'] = Location.from_dict(loc_data)
        else:
            data['location'] = Location(path='unknown')
        return cls(**data)

    def matches(self, other: 'Finding', threshold: float = 0.7) -> bool:
        """Check if this finding matches another (for deduplication)."""
        # Same file and overlapping lines
        if self.location.path == other.location.path:
            if (self.location.start_line <= other.location.end_line and
                self.location.end_line >= other.location.start_line):
                return True

        # Same category and similar title
        if self.category == other.category:
            title_sim = self._title_similarity(self.title, other.title)
            if title_sim >= threshold:
                return True

        return False

    def _title_similarity(self, a: str, b: str) -> float:
        """Simple word overlap similarity."""
        words_a = set(a.lower().split())
        words_b = set(b.lower().split())
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union)


@dataclass
class InspectedFile:
    """Record of a file inspected by a model."""
    path: str
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ModelResult:
    """Result from a single model run."""
    model: str
    summary: str
    findings: list[Finding] = field(default_factory=list)
    inspected: list[InspectedFile] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    error: Optional[str] = None
    raw_output: str = ""

    def to_dict(self) -> dict:
        return {
            'model': self.model,
            'summary': self.summary,
            'findings': [f.to_dict() for f in self.findings],
            'inspected': [i.to_dict() for i in self.inspected],
            'questions': self.questions,
            'error': self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'ModelResult':
        findings = [Finding.from_dict(f) for f in data.get('findings', [])]
        inspected = [InspectedFile(**i) for i in data.get('inspected', [])]
        return cls(
            model=data.get('model', 'unknown'),
            summary=data.get('summary', ''),
            findings=findings,
            inspected=inspected,
            questions=data.get('questions', []),
            error=data.get('error'),
        )


# The prompt template for all models
MODEL_PROMPT_TEMPLATE = '''You are a code triage expert. Analyze the provided code and context.

USER REQUEST:
{prompt}

REPOSITORY CONTEXT:
- Root: {root}
- Is Git Repo: {is_git_repo}
{tree_context}
{git_context}

FILES ({file_count} files, {total_chars} chars):
{files_context}

INSTRUCTIONS:
1. Focus on the user's specific request
2. IMPORTANT: All file contents are provided above. Do NOT attempt to read files yourself.
3. Identify issues by severity:
   - S0: Blockers (security vulnerabilities, crashes, data loss)
   - S1: High (bugs, significant issues)
   - S2: Medium (code quality, performance)
   - S3: Low (style, minor improvements)
3. Be specific about locations (file:line)
4. Provide actionable recommendations
5. If suggesting patches, use unified diff format

OUTPUT FORMAT:
You MUST respond with valid JSON following this schema:

{{
  "model": "{model_name}",
  "summary": "1-3 sentence overview of findings",
  "inspected": [
    {{"path": "path/to/file.py", "reason": "why you looked at this"}}
  ],
  "findings": [
    {{
      "title": "Short descriptive title",
      "severity": "S0|S1|S2|S3",
      "confidence": "high|medium|low",
      "category": "correctness|security|performance|reliability|maintainability|tests|style",
      "location": {{"path": "file.py", "start_line": 10, "end_line": 15}},
      "evidence": "Code snippet or description of the issue",
      "recommendation": "How to fix this",
      "patch": "optional unified diff"
    }}
  ],
  "questions": ["optional clarifying questions"]
}}

Respond ONLY with the JSON, no other text.
'''


class BaseModel(ABC):
    """Base class for model adapters."""

    def __init__(self):
        self.name = "base"
        self.cmd_env_var = "TRIAGE_BASE_CMD"
        self.default_cmd = ["echo"]

    @property
    def command(self) -> list[str]:
        """Get the command to run this model."""
        env_cmd = os.environ.get(self.cmd_env_var, "")
        if env_cmd:
            return env_cmd.split()
        return self.default_cmd

    async def analyze(
        self,
        prompt: str,
        context: dict,
        results_dir: Path,
        timeout: int = 300,
        nice: int = 10
    ) -> ModelResult:
        """
        Run analysis using this model.

        Args:
            prompt: User's analysis prompt
            context: Repository context from RepoScanner
            results_dir: Directory to store results
            timeout: Timeout in seconds
            nice: Nice level for subprocess

        Returns:
            ModelResult with findings
        """
        # Build the full prompt
        full_prompt = self._build_prompt(prompt, context)

        # Save prompt for debugging
        prompt_file = results_dir / f"{self.name}_prompt.txt"
        prompt_file.write_text(full_prompt)

        # Run the model
        try:
            output = await self._run_model(full_prompt, timeout, nice)

            # Save raw output
            output_file = results_dir / f"{self.name}_output.txt"
            output_file.write_text(output)

            # Parse the result
            result = self._parse_output(output)
            result.raw_output = output

            # Save parsed result
            result_file = results_dir / f"{self.name}_result.json"
            with open(result_file, 'w') as f:
                json.dump(result.to_dict(), f, indent=2)

            return result

        except Exception as e:
            return ModelResult(
                model=self.name,
                summary=f"Error running {self.name}: {str(e)}",
                error=str(e)
            )

    def _build_prompt(self, prompt: str, context: dict) -> str:
        """Build the full prompt for the model."""
        # Tree context (directory structure)
        tree_context = ""
        if context.get('tree'):
            tree_context = f"Directory Structure:\n```\n{context['tree'][:3000]}\n```\n"

        # Git context
        git_context = ""
        if context.get('git_log'):
            git_context = f"Recent Commits:\n```\n{context['git_log']}\n```\n"
        if context.get('has_diff'):
            git_context += f"Git Diff:\n```\n{context['git_diff'][:10000]}\n```\n"
        if context.get('git_status'):
            git_context += f"Git Status:\n```\n{context['git_status']}\n```\n"

        # Files context with descriptions
        files_context = ""
        total_chars = 0
        for f in context.get('files', []):
            desc = f.get('description', '')
            desc_str = f" - {desc}" if desc else ""
            files_context += f"\n--- {f['path']} ({f['reason']}){desc_str} ---\n"
            content = f['content']
            if len(content) > 5000:
                content = content[:5000] + "\n... [truncated]"
            files_context += f"```\n{content}\n```\n"
            total_chars += len(content)

        file_count = len(context.get('files', []))

        return MODEL_PROMPT_TEMPLATE.format(
            prompt=prompt,
            root=context.get('root', '.'),
            is_git_repo=context.get('is_git_repo', False),
            tree_context=tree_context,
            git_context=git_context,
            files_context=files_context,
            file_count=file_count,
            total_chars=total_chars,
            model_name=self.name
        )

    @abstractmethod
    async def _run_model(self, prompt: str, timeout: int, nice: int) -> str:
        """Run the model and return raw output. Must be implemented by subclass."""
        pass

    def _parse_output(self, output: str) -> ModelResult:
        """Parse model output into ModelResult."""
        # Try to extract JSON from the output
        try:
            # Look for JSON block
            json_match = None

            # Try to find JSON in code blocks
            import re
            json_patterns = [
                r'```json\s*(.*?)\s*```',
                r'```\s*(.*?)\s*```',
                r'(\{.*\})',
            ]

            for pattern in json_patterns:
                matches = re.findall(pattern, output, re.DOTALL)
                for match in matches:
                    try:
                        data = json.loads(match)
                        if 'findings' in data or 'summary' in data:
                            json_match = data
                            break
                    except json.JSONDecodeError:
                        continue
                if json_match:
                    break

            # If no JSON block found, try parsing the whole output
            if not json_match:
                data = json.loads(output)
                json_match = data

            return ModelResult.from_dict(json_match)

        except Exception as e:
            # Return a result with the raw output as summary
            return ModelResult(
                model=self.name,
                summary=f"Failed to parse output: {str(e)}",
                error=f"Parse error: {str(e)}\nRaw output:\n{output[:1000]}"
            )


class SubprocessModel(BaseModel):
    """Model that runs via subprocess."""

    async def _run_model(self, prompt: str, timeout: int, nice: int) -> str:
        """Run model via subprocess."""
        import asyncio

        # Write prompt to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write(prompt)
            prompt_file = f.name

        try:
            # Build command with nice
            cmd = self._build_command(prompt_file)
            full_cmd = ['nice', '-n', str(nice), 'timeout', str(timeout)] + cmd

            # Run async
            process = await asyncio.create_subprocess_exec(
                *full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=os.getcwd()
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else f"Exit code {process.returncode}"
                raise RuntimeError(f"Model failed: {error_msg}")

            return stdout.decode()

        finally:
            # Clean up temp file
            try:
                os.unlink(prompt_file)
            except Exception:
                pass

    @abstractmethod
    def _build_command(self, prompt_file: str) -> list[str]:
        """Build the command to run. Must be implemented by subclass."""
        pass
