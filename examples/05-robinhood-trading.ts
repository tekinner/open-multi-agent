/**
 * Example 05 — Robinhood MCP Trading
 *
 * Demonstrates how to connect to Robinhood's MCP trading server at
 * https://agent.robinhood.com/mcp/trading, load its tools, and wire them
 * into a Claude-powered trading assistant.
 *
 * Run:
 *   ROBINHOOD_ACCESS_TOKEN=<token> npx tsx examples/05-robinhood-trading.ts
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY env var must be set
 *   - ROBINHOOD_ACCESS_TOKEN env var must be set (OAuth access token from
 *     Robinhood's authentication flow)
 */

import {
  Agent,
  ToolRegistry,
  ToolExecutor,
  registerBuiltInTools,
} from '../src/index.js'
import {
  createRobinhoodTradingTools,
  createRobinhoodMCPClient,
} from '../src/mcp/index.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const accessToken = process.env['ROBINHOOD_ACCESS_TOKEN']
if (!accessToken) {
  console.error('Error: ROBINHOOD_ACCESS_TOKEN environment variable is required.')
  console.error('Obtain one via Robinhood\'s OAuth flow, then set it and re-run.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Part 1: Discover available trading tools
// ---------------------------------------------------------------------------

console.log('Connecting to Robinhood MCP trading server...')

const tradingTools = await createRobinhoodTradingTools({ accessToken })

console.log(`\nDiscovered ${tradingTools.length} trading tool(s):`)
for (const tool of tradingTools) {
  console.log(`  · ${tool.name}: ${tool.description}`)
}

// ---------------------------------------------------------------------------
// Part 2: Build a registry with trading + built-in tools
// ---------------------------------------------------------------------------

const registry = new ToolRegistry()
registerBuiltInTools(registry)

for (const tool of tradingTools) {
  registry.register(tool)
}

const executor = new ToolExecutor(registry)

// ---------------------------------------------------------------------------
// Part 3: Create a trading assistant agent
// ---------------------------------------------------------------------------

const agent = new Agent(
  {
    name: 'trading-assistant',
    model: 'claude-opus-4-6',
    systemPrompt: [
      'You are a helpful trading assistant with access to Robinhood trading tools.',
      'Help users check their portfolio, get stock quotes, and manage orders.',
      'Always present financial data clearly and confirm before placing or cancelling orders.',
    ].join(' '),
    tools: tradingTools.map(t => t.name),
    maxTurns: 5,
  },
  registry,
  executor,
)

// ---------------------------------------------------------------------------
// Part 4: Run a portfolio query
// ---------------------------------------------------------------------------

console.log('\nAsking about portfolio...\n')

const result = await agent.run(
  'What is my current portfolio value and what are my top holdings?',
)

if (result.success) {
  console.log('Trading Assistant:')
  console.log('─'.repeat(60))
  console.log(result.output)
  console.log('─'.repeat(60))
} else {
  console.error('Agent failed:', result.output)
}

console.log(`\nToken usage — input: ${result.tokenUsage.input_tokens}, output: ${result.tokenUsage.output_tokens}`)
console.log(`Tool calls made: ${result.toolCalls.length}`)
if (result.toolCalls.length > 0) {
  console.log('Tools used:', result.toolCalls.map(c => c.toolName).join(', '))
}

// ---------------------------------------------------------------------------
// Part 5: Show direct MCP client usage
// ---------------------------------------------------------------------------

console.log('\n\nPart 5: Direct MCPClient usage')
console.log('─'.repeat(60))

const client = createRobinhoodMCPClient({ accessToken })
const toolList = await client.listTools()
console.log(`Tools available via direct client (${toolList.length}):`)
for (const t of toolList) {
  const paramCount = Object.keys(t.inputSchema.properties ?? {}).length
  console.log(`  ${t.name} (${paramCount} param${paramCount !== 1 ? 's' : ''})`)
}
