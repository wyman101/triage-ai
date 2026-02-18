"""
MCP (Model Context Protocol) server for triage-ai.

Exposes triage functionality as MCP tools that any MCP-compatible client
(Claude Desktop, Claude Code, Cursor, etc.) can call.

Usage:
    # Install with MCP support
    pip install triage-ai[mcp]

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
    print("  pip install triage-ai[mcp]", file=sys.stderr)
    sys.exit(1)

from .repo_scan import RepoScanner
from .models.claude import ClaudeModel
from .models.gemini import GeminiModel
from .models.codex import CodexModel
from .merge import MergeEngine
from .report import ReportGenerator


server = Server("triage-ai")


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
    max_files = arguments.get("max_files", 30)
    output_format = arguments.get("format", "md")
    timeout = arguments.get("timeout", 300)

    # Create results directory
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
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

    results = [r for r in raw_results if r is not None and not isinstance(r, Exception)]
    elapsed = time.time() - start_time

    if not results:
        return [TextContent(type="text", text="Error: All models failed")]

    # Merge results
    merger = MergeEngine()
    merged = merger.merge(results)

    # Generate report
    reporter = ReportGenerator()
    if output_format == "json":
        report = reporter.to_json(merged, prompt, context, elapsed)
    else:
        report = reporter.to_markdown(merged, prompt, context, elapsed)

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
