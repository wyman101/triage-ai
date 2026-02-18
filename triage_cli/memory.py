"""
Memory writer — saves triage findings to AI model memory files.

After triage runs, findings are written to model-specific memory files
so that Claude, Gemini, and Codex remember issues in future sessions.

Supported memory files:
- CLAUDE.md     — Claude Code project instructions
- GEMINI.md     — Gemini CLI project context
- AGENTS.md     — Codex/OpenAI agent instructions
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from .merge import MergedResult, FindingCluster


# Section markers for finding/replacing triage memory blocks
MEMORY_START = "<!-- triage:start -->"
MEMORY_END = "<!-- triage:end -->"

# Model memory file names (in project root)
MEMORY_FILES = {
    "claude": "CLAUDE.md",
    "gemini": "GEMINI.md",
    "codex": "AGENTS.md",
}


def write_memory(
    merged: MergedResult,
    prompt: str,
    root: Optional[Path] = None,
    models: Optional[list[str]] = None,
) -> dict[str, bool]:
    """
    Write triage findings to AI model memory files.

    Replaces any existing triage section (between markers) or appends
    a new one. This way, memory stays current — old findings are replaced
    by the latest run, not accumulated forever.

    Args:
        merged: Merged triage results
        prompt: Original user prompt
        root: Project root directory (default: cwd)
        models: Which memory files to write (default: all)

    Returns:
        Dict of {filename: success} for each file written
    """
    root = root or Path.cwd()
    models = models or list(MEMORY_FILES.keys())
    content = _build_memory_content(merged, prompt)

    if not content:
        # No findings — clear any stale triage blocks from memory files
        return clear_memory(root=root, models=models)

    results = {}
    for model in models:
        filename = MEMORY_FILES.get(model)
        if not filename:
            continue

        filepath = root / filename
        success = _update_memory_file(filepath, content)
        results[filename] = success

        if success:
            print(f"  Updated {filename} with triage findings")

    return results


def clear_memory(
    root: Optional[Path] = None,
    models: Optional[list[str]] = None,
) -> dict[str, bool]:
    """
    Remove triage sections from AI model memory files.

    Args:
        root: Project root directory (default: cwd)
        models: Which memory files to clear (default: all)

    Returns:
        Dict of {filename: success} for each file cleared
    """
    root = root or Path.cwd()
    models = models or list(MEMORY_FILES.keys())

    results = {}
    for model in models:
        filename = MEMORY_FILES.get(model)
        if not filename:
            continue

        filepath = root / filename
        if not filepath.exists():
            continue

        try:
            existing = filepath.read_text(encoding="utf-8")
            if MEMORY_START not in existing:
                continue

            # Remove the triage section
            before = existing[:existing.index(MEMORY_START)].rstrip()
            after_idx = existing.index(MEMORY_END) + len(MEMORY_END)
            after = existing[after_idx:].lstrip("\n")

            new_content = before
            if after:
                new_content += "\n\n" + after
            new_content = new_content.rstrip() + "\n"

            filepath.write_text(new_content, encoding="utf-8")
            results[filename] = True
            print(f"  Cleared triage section from {filename}")

        except Exception as e:
            print(f"  Failed to clear {filename}: {e}")
            results[filename] = False

    return results


def _build_memory_content(merged: MergedResult, prompt: str) -> str:
    """Build the memory content block from merged results."""
    # Only write if there are meaningful findings
    total = (len(merged.blockers) + len(merged.high) +
             len(merged.medium) + len(merged.low))

    if total == 0:
        return ""

    lines = []
    lines.append(MEMORY_START)
    lines.append("")
    lines.append("## Triage Findings")
    lines.append("")
    lines.append(f"*Last run: {datetime.now().strftime('%Y-%m-%d %H:%M')} — "
                 f"{total} issues found, "
                 f"{len(merged.consensus)} consensus*")
    lines.append("")

    if prompt:
        lines.append(f"> **Scope:** {prompt}")
        lines.append("")

    # Blockers — always include full detail
    if merged.blockers:
        lines.append("### Blockers (must fix)")
        lines.append("")
        for cluster in merged.blockers:
            lines.extend(_format_cluster(cluster))
        lines.append("")

    # High priority — include full detail
    if merged.high:
        lines.append("### High Priority")
        lines.append("")
        for cluster in merged.high:
            lines.extend(_format_cluster(cluster))
        lines.append("")

    # Medium — summary only to keep memory concise
    if merged.medium:
        lines.append("### Medium Priority")
        lines.append("")
        for cluster in merged.medium:
            f = cluster.representative
            consensus = " **(consensus)**" if cluster.is_consensus else ""
            lines.append(f"- [{f.severity}] {f.title} — "
                         f"`{f.location.path}:{f.location.start_line}`{consensus}")
        lines.append("")

    # Low — just count
    if merged.low:
        lines.append(f"*Plus {len(merged.low)} low-priority items (S3).*")
        lines.append("")

    # Key patterns to watch for
    if merged.consensus:
        lines.append("### Patterns to Watch")
        lines.append("")
        lines.append("These issues were flagged by multiple models — "
                     "avoid introducing similar patterns:")
        lines.append("")
        categories = set()
        for cluster in merged.consensus:
            f = cluster.representative
            categories.add(f.category)
            lines.append(f"- **{f.title}**: {f.recommendation}")
        lines.append("")

    lines.append(MEMORY_END)

    return "\n".join(lines)


def _format_cluster(cluster: FindingCluster) -> list[str]:
    """Format a finding cluster for memory."""
    lines = []
    f = cluster.representative
    consensus = " **(consensus)**" if cluster.is_consensus else ""
    models = ", ".join(sorted(cluster.models))

    lines.append(f"- **[{f.severity}] {f.title}**{consensus}")
    lines.append(f"  - Location: `{f.location.path}:{f.location.start_line}-{f.location.end_line}`")
    lines.append(f"  - Models: {models}")

    if f.recommendation:
        # Keep recommendation concise for memory
        rec = f.recommendation[:200]
        if len(f.recommendation) > 200:
            rec += "..."
        lines.append(f"  - Fix: {rec}")

    return lines


def _update_memory_file(filepath: Path, content: str) -> bool:
    """
    Update a memory file with triage content.

    If the file exists and has an existing triage section, replace it.
    If the file exists without a triage section, append.
    If the file doesn't exist, create it with a header.
    """
    try:
        if filepath.exists():
            existing = filepath.read_text(encoding="utf-8")

            if MEMORY_START in existing and MEMORY_END in existing:
                # Replace existing triage section
                before = existing[:existing.index(MEMORY_START)].rstrip()
                after_idx = existing.index(MEMORY_END) + len(MEMORY_END)
                after = existing[after_idx:].lstrip("\n")

                new_content = before + "\n\n" + content
                if after:
                    new_content += "\n\n" + after
                new_content = new_content.rstrip() + "\n"

            else:
                # Append triage section
                new_content = existing.rstrip() + "\n\n" + content + "\n"

        else:
            # Create new file with minimal header
            filename = filepath.name.replace(".md", "")
            new_content = f"# {filename}\n\n{content}\n"

        filepath.write_text(new_content, encoding="utf-8")
        return True

    except Exception as e:
        print(f"  Failed to write {filepath.name}: {e}")
        return False
