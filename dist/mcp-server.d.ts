/**
 * MCP (Model Context Protocol) server for triage-ai.
 *
 * Exposes triage functionality as the "triage" tool that any MCP-compatible
 * client (Claude Desktop, Claude Code, Cursor, Windsurf, Cline, etc.) can call.
 *
 * Transport: stdio (stdin/stdout) — standard for local MCP servers.
 *
 * Port of triage_cli/mcp_server.py:
 *   - McpServer high-level API from @modelcontextprotocol/sdk
 *   - StdioServerTransport for stdio transport
 *   - Zod schema validation on tool inputs
 *   - Per-request UUID-suffixed results directories for concurrent safety
 *   - Old results directories pruned to MAX_RESULTS_DIRS newest
 *   - Errors from individual models appended as Notes in the report
 */
/**
 * Create the MCP server, connect the stdio transport and start listening.
 *
 * Called from cli.ts when the --mcp flag is set.
 * Resolves when the transport closes (client disconnects).
 */
export declare function startMcpServer(): Promise<void>;
//# sourceMappingURL=mcp-server.d.ts.map