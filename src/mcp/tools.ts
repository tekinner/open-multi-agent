/**
 * @fileoverview Convert MCP tool definitions into framework ToolDefinitions.
 *
 * The key challenge is round-tripping the tool schema:
 *   MCP JSON Schema  →  Zod  →  zodToJsonSchema  →  LLM API
 *
 * A lightweight JSON-Schema-to-Zod converter preserves field types and
 * descriptions so the LLM receives accurate parameter information.
 */

import { z } from 'zod'
import { defineTool } from '../tool/framework.js'
import type { ToolDefinition } from '../types.js'
import type { MCPClient, MCPTool } from './client.js'

// ---------------------------------------------------------------------------
// JSON Schema → Zod
// ---------------------------------------------------------------------------

type JSONSchemaNode = Record<string, unknown>

/**
 * Convert a JSON Schema node to a Zod schema.
 *
 * Handles the subset of JSON Schema that MCP tool definitions typically use:
 * object, string, number, integer, boolean, null, array, enum, anyOf.
 * Everything else falls back to `z.unknown()`.
 */
function jsonSchemaToZod(schema: JSONSchemaNode): z.ZodTypeAny {
  const description =
    typeof schema['description'] === 'string' ? schema['description'] : undefined

  const addDesc = (s: z.ZodTypeAny): z.ZodTypeAny =>
    description !== undefined ? s.describe(description) : s

  // Top-level enum (independent of "type")
  if (Array.isArray(schema['enum'])) {
    const vals = (schema['enum'] as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    )
    if (vals.length >= 1) {
      return addDesc(z.enum(vals as [string, ...string[]]))
    }
  }

  // anyOf / oneOf → union
  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[unionKey])) {
      const options = (schema[unionKey] as JSONSchemaNode[]).map(jsonSchemaToZod)
      if (options.length >= 2) {
        return addDesc(
          z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        )
      }
      if (options.length === 1) return addDesc(options[0]!)
    }
  }

  const type = schema['type']

  if (type === 'string') return addDesc(z.string())
  if (type === 'number') return addDesc(z.number())
  if (type === 'integer') return addDesc(z.number().int())
  if (type === 'boolean') return addDesc(z.boolean())
  if (type === 'null') return addDesc(z.null())

  if (type === 'array') {
    const items = schema['items'] as JSONSchemaNode | undefined
    const itemSchema = items !== undefined ? jsonSchemaToZod(items) : z.unknown()
    return addDesc(z.array(itemSchema))
  }

  // Object: explicit type or implicit (has "properties" but no "type")
  if (type === 'object' || (type === undefined && schema['properties'] !== undefined)) {
    const properties = schema['properties'] as
      | Record<string, JSONSchemaNode>
      | undefined
    const required = Array.isArray(schema['required'])
      ? (schema['required'] as string[])
      : []

    if (properties === undefined) {
      return addDesc(z.record(z.unknown()))
    }

    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, propSchema] of Object.entries(properties)) {
      const fieldZod = jsonSchemaToZod(propSchema)
      shape[key] = required.includes(key) ? fieldZod : fieldZod.optional()
    }

    // passthrough() allows the server to return or accept extra undeclared keys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return addDesc((z.object(shape) as z.ZodObject<any>).passthrough())
  }

  return addDesc(z.unknown())
}

// ---------------------------------------------------------------------------
// MCP tool → ToolDefinition
// ---------------------------------------------------------------------------

function extractTextContent(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n')
    .trim()
}

function mcpToolToDefinition(
  tool: MCPTool,
  client: MCPClient,
): ToolDefinition<Record<string, unknown>> {
  const zodSchema = jsonSchemaToZod(
    tool.inputSchema as JSONSchemaNode,
  ) as z.ZodSchema<Record<string, unknown>>

  return defineTool({
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: zodSchema,
    execute: async input => {
      const result = await client.callTool(tool.name, input)
      const text = extractTextContent(result.content)
      return {
        data: text !== '' ? text : JSON.stringify(result.content),
        isError: result.isError,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect to an MCP server, discover its tools, and return them as
 * {@link ToolDefinition} objects ready to be registered with a
 * {@link ToolRegistry}.
 *
 * @example
 * ```ts
 * const client = new MCPClient({
 *   url: 'https://agent.robinhood.com/mcp/trading',
 *   headers: { Authorization: 'Bearer <token>' },
 * })
 *
 * const tools = await createMCPTools(client)
 * for (const tool of tools) registry.register(tool)
 * ```
 */
export async function createMCPTools(
  client: MCPClient,
): Promise<ToolDefinition<Record<string, unknown>>[]> {
  const mcpTools = await client.listTools()
  return mcpTools.map(tool => mcpToolToDefinition(tool, client))
}
