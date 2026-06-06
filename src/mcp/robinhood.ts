/**
 * @fileoverview Robinhood MCP trading server integration.
 *
 * Provides helpers for connecting to Robinhood's official MCP trading
 * endpoint at https://agent.robinhood.com/mcp/trading and loading its
 * tools into the open-multi-agent framework.
 *
 * Authentication requires a Robinhood OAuth access token, which can be
 * obtained via Robinhood's standard OAuth 2.0 flow.
 */

import { MCPClient } from './client.js'
import { createMCPTools } from './tools.js'
import type { ToolDefinition } from '../types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** URL of Robinhood's official MCP trading server. */
export const ROBINHOOD_MCP_URL = 'https://agent.robinhood.com/mcp/trading'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Authentication options for the Robinhood MCP trading server. */
export interface RobinhoodMCPOptions {
  /** OAuth access token obtained from Robinhood's authentication flow. */
  readonly accessToken: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a pre-configured {@link MCPClient} for the Robinhood trading server.
 *
 * Useful when you need direct access to `listTools()` / `callTool()` or want
 * to share a single client across multiple tool registries.
 *
 * @example
 * ```ts
 * const client = createRobinhoodMCPClient({ accessToken: process.env.ROBINHOOD_TOKEN! })
 * await client.initialize()
 * const tools = await client.listTools()
 * ```
 */
export function createRobinhoodMCPClient(
  options: RobinhoodMCPOptions,
): MCPClient {
  return new MCPClient({
    url: ROBINHOOD_MCP_URL,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
    },
  })
}

/**
 * Discover and return all trading tools available on Robinhood's MCP server.
 *
 * Connects to `https://agent.robinhood.com/mcp/trading`, initialises the MCP
 * session, retrieves the tool list, and wraps each tool as a framework-
 * compatible {@link ToolDefinition} ready to register with a
 * {@link ToolRegistry}.
 *
 * @example
 * ```ts
 * import { Agent, ToolRegistry, ToolExecutor, registerBuiltInTools } from 'open-multi-agent'
 * import { createRobinhoodTradingTools } from 'open-multi-agent/mcp'
 *
 * const tradingTools = await createRobinhoodTradingTools({
 *   accessToken: process.env.ROBINHOOD_ACCESS_TOKEN!,
 * })
 *
 * const registry = new ToolRegistry()
 * registerBuiltInTools(registry)
 * for (const tool of tradingTools) registry.register(tool)
 *
 * const agent = new Agent(
 *   { name: 'trader', model: 'claude-opus-4-6', tools: tradingTools.map(t => t.name) },
 *   registry,
 *   new ToolExecutor(registry),
 * )
 *
 * const result = await agent.run('What is my current portfolio value?')
 * console.log(result.output)
 * ```
 */
export async function createRobinhoodTradingTools(
  options: RobinhoodMCPOptions,
): Promise<ToolDefinition<Record<string, unknown>>[]> {
  const client = createRobinhoodMCPClient(options)
  return createMCPTools(client)
}
