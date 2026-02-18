#!/usr/bin/env python3
"""
Main entry point for triage CLI.

Usage:
    triage "analyze the authentication flow for security issues"
    triage --models claude,gemini --diff-only "review recent changes"
    triage --format json --out report.json "find performance issues"
"""

import argparse
import asyncio
import os
import sys
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from .repo_scan import RepoScanner
from .models.base import ModelResult, Finding
from .models.claude import ClaudeModel
from .models.gemini import GeminiModel
from .models.codex import CodexModel
from .merge import MergeEngine
from .report import ReportGenerator
from .patch import PatchApplicator
from .memory import write_memory, clear_memory


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        prog="triage",
        description="Multi-model code triage tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    triage "analyze authentication for security issues"
    triage --models claude,gemini --diff-only "review recent changes"
    triage --format json --out report.json "find performance bottlenecks"
    triage --apply "fix the SQL injection in user.py"
        """
    )

    parser.add_argument(
        "prompt",
        nargs="?",
        help="The analysis prompt/question for the models"
    )

    parser.add_argument(
        "--models",
        default="claude,gemini,codex",
        help="Comma-separated list of models to use (default: claude,gemini,codex)"
    )

    parser.add_argument(
        "--diff-only",
        action="store_true",
        help="Send only git diff instead of full files when possible"
    )

    parser.add_argument(
        "--max-files",
        type=int,
        default=30,
        help="Maximum files to send per model (default: 30)"
    )

    parser.add_argument(
        "--format",
        choices=["md", "json"],
        default="md",
        help="Output format (default: md)"
    )

    parser.add_argument(
        "--out",
        type=Path,
        help="Write report to file instead of stdout"
    )

    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply best-effort safe patches (creates git branch first)"
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show patches but don't apply them"
    )

    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Timeout per model in seconds (default: 300)"
    )

    parser.add_argument(
        "--nice",
        type=int,
        default=10,
        help="Nice level for subprocess priority (default: 10)"
    )

    parser.add_argument(
        "--results-dir",
        type=Path,
        default=Path("./triage_results"),
        help="Directory to store intermediate results"
    )

    parser.add_argument(
        "--remember",
        action="store_true",
        help="Save findings to AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md)"
    )

    parser.add_argument(
        "--forget",
        action="store_true",
        help="Remove triage findings from AI memory files and exit"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )

    parser.add_argument(
        "--version",
        action="version",
        version="%(prog)s 1.1.0"
    )

    return parser.parse_args()


def get_model_instances(model_names: list[str]) -> list:
    """Get model instances for the requested models."""
    model_map = {
        "claude": ClaudeModel,
        "gemini": GeminiModel,
        "codex": CodexModel,
    }

    models = []
    for name in model_names:
        name = name.strip().lower()
        if name in model_map:
            models.append(model_map[name]())
        else:
            print(f"Warning: Unknown model '{name}', skipping", file=sys.stderr)

    return models


async def run_model_async(
    model,
    prompt: str,
    context: dict,
    results_dir: Path,
    timeout: int,
    nice: int
) -> Optional[ModelResult]:
    """Run a single model asynchronously."""
    try:
        return await model.analyze(prompt, context, results_dir, timeout, nice)
    except Exception as e:
        print(f"Error running {model.name}: {e}", file=sys.stderr)
        return None


async def run_models_parallel(
    models: list,
    prompt: str,
    context: dict,
    results_dir: Path,
    timeout: int,
    nice: int,
    verbose: bool
) -> list[ModelResult]:
    """Run all models in parallel and collect results."""
    if verbose:
        print(f"Starting {len(models)} models in parallel...")
        for m in models:
            print(f"  - {m.name}")

    tasks = [
        run_model_async(model, prompt, context, results_dir, timeout, nice)
        for model in models
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out None results and exceptions
    valid_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"Model {models[i].name} failed: {result}", file=sys.stderr)
        elif result is not None:
            valid_results.append(result)
            if verbose:
                print(f"  {result.model}: {len(result.findings)} findings")

    return valid_results


def main():
    """Main entry point."""
    args = parse_args()

    # Handle --forget (clear memory and exit)
    if args.forget:
        print("Clearing triage findings from AI memory files...")
        clear_memory()
        return 0

    # Check for prompt
    if not args.prompt:
        print("Error: No prompt provided", file=sys.stderr)
        print("Usage: triage \"<your analysis prompt>\"", file=sys.stderr)
        sys.exit(1)

    # Create results directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = args.results_dir / timestamp
    results_dir.mkdir(parents=True, exist_ok=True)

    if args.verbose:
        print(f"Results directory: {results_dir}")

    # Scan repository
    scanner = RepoScanner()
    context = scanner.scan(
        diff_only=args.diff_only,
        max_files=args.max_files,
        prompt=args.prompt
    )

    if args.verbose:
        print(f"Scanned {len(context.get('files', []))} files")
        if context.get('has_diff'):
            print("  (using git diff)")

    # Get models
    model_names = [m.strip() for m in args.models.split(",")]
    models = get_model_instances(model_names)

    if not models:
        print("Error: No valid models specified", file=sys.stderr)
        sys.exit(1)

    # Run models in parallel
    print(f"\n=== Running Triage with {len(models)} models ===\n")

    start_time = time.time()
    results = asyncio.run(run_models_parallel(
        models=models,
        prompt=args.prompt,
        context=context,
        results_dir=results_dir,
        timeout=args.timeout,
        nice=args.nice,
        verbose=args.verbose
    ))
    elapsed = time.time() - start_time

    if not results:
        print("Error: All models failed", file=sys.stderr)
        sys.exit(1)

    print(f"\nCompleted in {elapsed:.1f}s ({len(results)}/{len(models)} models succeeded)\n")

    # Merge results
    merger = MergeEngine()
    merged = merger.merge(results)

    # Generate report
    reporter = ReportGenerator()

    if args.format == "json":
        report = reporter.to_json(merged, args.prompt, context, elapsed)
    else:
        report = reporter.to_markdown(merged, args.prompt, context, elapsed)

    # Output report
    if args.out:
        args.out.write_text(report)
        print(f"Report written to: {args.out}")
    else:
        print(report)

    # Handle patches
    if merged.patches and (args.apply or args.dry_run):
        applicator = PatchApplicator()

        if args.dry_run:
            print("\n=== Patches (dry-run) ===\n")
            for patch in merged.patches:
                print(f"--- {patch.path} ---")
                print(patch.diff)
                print()
        elif args.apply:
            if not context.get('is_git_repo'):
                print("Error: Cannot apply patches - not a git repository", file=sys.stderr)
                sys.exit(1)

            applied = applicator.apply_patches(
                merged.patches,
                create_branch=True,
                branch_name=f"triage/{timestamp}"
            )
            print(f"\nApplied {applied} patches to branch triage/{timestamp}")

    # Save findings to AI memory files
    if args.remember:
        print("\n=== Saving to AI Memory ===\n")
        write_memory(merged, args.prompt)

    # Save merged results
    merged_path = results_dir / "merged.json"
    with open(merged_path, "w") as f:
        json.dump(merged.to_dict(), f, indent=2)

    if args.verbose:
        print(f"\nMerged results saved to: {merged_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
