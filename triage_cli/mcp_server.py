"""
MCP (Model Context Protocol) server for triage.

Exposes triage functionality as MCP tools that any MCP-compatible client
(Claude Desktop, Claude Code, Cursor, etc.) can call.

Usage:
    # Install with MCP support
    pip install triage[mcp]

    # Run the MCP server
    python -m triage_cli.mcp_server
"""

import asyncio
import json
import sys
import time
from pathlib import Path

try:
    from mcp.server import Server
    from mcp.server.stdio import run_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("MCP support requires the 'mcp' package. Install with:", file=sys.stderr)
    print("  pip install triage[mcp]", file=sys.stderr)
    sys.exit(1)

from .repo_scan import RepoScanner
from .models.claude import ClaudeModel
from .models.gemini import GeminiModel
from .models.codex import CodexModel
from .merge import MergeEngine
from .report import ReportGenerator
from .memory import write_memory


server = Server("triage")


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
    return models


async def run_model_async(model, prompt, context, results_dir, timeout, nice):
    """Run a single model asynchronously."""
    try:
        return await model.analyze(prompt, context, results_dir, timeout, nice)
    except Exception as e:
        return None


@server.list_tools()
async def list_tools():
    """List available triage tools."""
    return [
        Tool(
            name="triage",
            description=(
                "Run multi-model code triage using Claude, Gemini, and Codex in parallel. "
                "Analyzes code for bugs, security issues, performance problems, and more. "
                "Models run concurrently and findings are merged with consensus detection."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "What to analyze (e.g., 'find security vulnerabilities in authentication')"
                    },
                    "models": {
                        "type": "string",
                        "description": "Comma-separated models to use (default: claude,gemini,codex)",
                        "default": "claude,gemini,codex"
                    },
                    "diff_only": {
                        "type": "boolean",
                        "description": "Only analyze git diff instead of full files",
                        "default": False
                    },
                    "max_files": {
                        "type": "integer",
                        "description": "Maximum files to analyze (default: 30)",
                        "default": 30
                    },
                    "format": {
                        "type": "string",
                        "enum": ["md", "json"],
                        "description": "Output format (default: md)",
                        "default": "md"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout per model in seconds (default: 300)",
                        "default": 300
                    },
                    "remember": {
                        "type": "boolean",
                        "description": "Save findings to AI memory files (CLAUDE.md, GEMINI.md, AGENTS.md)",
                        "default": False
                    },
                },
                "required": ["prompt"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle triage tool calls."""
    if name != "triage":
        return [TextContent(type="text", text=f"Unknown tool: {name}")]

    prompt = arguments.get("prompt", "")
    if not prompt:
        return [TextContent(type="text", text="Error: No prompt provided")]

    model_names = [m.strip() for m in arguments.get("models", "claude,gemini,codex").split(",")]
    diff_only = arguments.get("diff_only", False)
    max_files = max(1, min(200, int(arguments.get("max_files", 30))))
    output_format = arguments.get("format", "md")
    timeout = max(30, min(1800, int(arguments.get("timeout", 300))))

    # Create results directory (UUID suffix prevents collisions under concurrent requests)
    from datetime import datetime
    import uuid
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
    results_dir = Path("./triage_results") / timestamp
    results_dir.mkdir(parents=True, exist_ok=True)

    # Scan repository
    scanner = RepoScanner()
    context = scanner.scan(diff_only=diff_only, max_files=max_files, prompt=prompt)

    # Get models
    models = get_model_instances(model_names)
    if not models:
        return [TextContent(type="text", text="Error: No valid models specified")]

    # Run models in parallel
    start_time = time.time()
    tasks = [
        run_model_async(model, prompt, context, results_dir, timeout, 10)
        for model in models
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    errors = []
    for i, r in enumerate(raw_results):
        if isinstance(r, Exception):
            errors.append(f"{model_names[i]}: {r}")
        elif r is not None:
            results.append(r)
        else:
            errors.append(f"{model_names[i]}: returned no output")
    elapsed = time.time() - start_time

    if not results:
        error_detail = "; ".join(errors) if errors else "unknown failure"
        return [TextContent(type="text", text=f"Error: All models failed — {error_detail}")]

    # Merge results
    merger = MergeEngine()
    merged = merger.merge(results)

    # Generate report
    reporter = ReportGenerator()
    if output_format == "json":
        report = reporter.to_json(merged, prompt, context, elapsed)
    else:
        report = reporter.to_markdown(merged, prompt, context, elapsed)

    # Append model failure notes to report
    if errors:
        error_note = "\n\n**Note:** " + ", ".join(errors)
        report += error_note

    # Save findings to AI memory files
    if arguments.get("remember", False):
        write_memory(merged, prompt)

    # Save merged results
    merged_path = results_dir / "merged.json"
    with open(merged_path, "w") as f:
        json.dump(merged.to_dict(), f, indent=2)

    return [TextContent(type="text", text=report)]


def main():
    """Run the MCP server."""
    asyncio.run(run_server(server))


if __name__ == "__main__":
    main()
