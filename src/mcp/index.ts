/**
 * @fileoverview MCP (Model Context Protocol) integration for open-multi-agent.
 *
 * Provides an HTTP client for the MCP Streamable HTTP transport, a tool
 * loader that converts MCP tool definitions into framework ToolDefinitions,
 * and a ready-to-use integration for the Robinhood trading MCP server.
 */

export { MCPClient } from './client.js'
export type {
  MCPClientOptions,
  MCPTool,
  MCPContentBlock,
  MCPCallToolResult,
} from './client.js'

export { createMCPTools } from './tools.js'

export {
  ROBINHOOD_MCP_URL,
  createRobinhoodMCPClient,
  createRobinhoodTradingTools,
} from './robinhood.js'
export type { RobinhoodMCPOptions } from './robinhood.js'
