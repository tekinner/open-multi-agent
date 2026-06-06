/**
 * @fileoverview Minimal HTTP client for the MCP Streamable HTTP transport.
 *
 * Implements the MCP 2024-11-05 protocol over HTTP POST:
 *   initialize → notifications/initialized → tools/list → tools/call
 *
 * Compatible with any MCP server that exposes a single HTTP endpoint
 * (e.g. https://agent.robinhood.com/mcp/trading).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single content block in an MCP tool result. */
export interface MCPContentBlock {
  readonly type: 'text' | 'image' | 'resource'
  readonly text?: string
  readonly data?: string
  readonly mimeType?: string
}

/** An MCP tool definition as returned by `tools/list`. */
export interface MCPTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema: {
    readonly type?: string
    readonly properties?: Record<string, unknown>
    readonly required?: string[]
    readonly [key: string]: unknown
  }
}

/** Result of a `tools/call` request. */
export interface MCPCallToolResult {
  readonly content: MCPContentBlock[]
  readonly isError?: boolean
}

/** Options for constructing an {@link MCPClient}. */
export interface MCPClientOptions {
  /** Full URL of the MCP server endpoint. */
  readonly url: string
  /** Additional HTTP headers (e.g. `Authorization: Bearer <token>`). */
  readonly headers?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Internal JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcResponse<T> {
  readonly jsonrpc: '2.0'
  readonly id?: number
  readonly result?: T
  readonly error?: { readonly code: number; readonly message: string }
}

// ---------------------------------------------------------------------------
// MCPClient
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP client for the MCP Streamable HTTP transport.
 *
 * Sessions are maintained via the `Mcp-Session-Id` header returned by the
 * server on `initialize`. The client is lazy — the session is opened on the
 * first call that needs it and reused for all subsequent requests.
 *
 * @example
 * ```ts
 * const client = new MCPClient({
 *   url: 'https://agent.robinhood.com/mcp/trading',
 *   headers: { Authorization: 'Bearer <token>' },
 * })
 *
 * const tools = await client.listTools()
 * const result = await client.callTool('get_quote', { symbol: 'AAPL' })
 * ```
 */
export class MCPClient {
  private readonly url: string
  private readonly baseHeaders: Record<string, string>
  private sessionId: string | null = null
  private requestCounter = 0
  private initialized = false

  constructor(options: MCPClientOptions) {
    this.url = options.url
    this.baseHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...options.headers,
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initialise the MCP session.
   *
   * Sends `initialize` then `notifications/initialized`. Subsequent calls are
   * no-ops — the session is kept alive via the session ID.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.post({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'open-multi-agent', version: '0.1.0' },
      },
    })

    // Fire-and-forget — servers may respond with 204 No Content
    await this.post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }).catch(() => undefined)

    this.initialized = true
  }

  /**
   * Fetch the list of tools available on this MCP server.
   * Initialises the session if it has not been opened yet.
   */
  async listTools(): Promise<MCPTool[]> {
    await this.initialize()

    const response = await this.post<{ tools: MCPTool[] }>({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
      params: {},
    })

    return this.unwrap(response).tools
  }

  /**
   * Invoke a tool by name with the given arguments.
   * Initialises the session if it has not been opened yet.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPCallToolResult> {
    await this.initialize()

    const response = await this.post<MCPCallToolResult>({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: { name, arguments: args },
    })

    if (response.error !== undefined) {
      return {
        content: [{ type: 'text', text: response.error.message }],
        isError: true,
      }
    }

    return this.unwrap(response)
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private nextId(): number {
    return ++this.requestCounter
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.baseHeaders }
    if (this.sessionId !== null) {
      headers['Mcp-Session-Id'] = this.sessionId
    }
    return headers
  }

  private async post<T>(body: unknown): Promise<JsonRpcResponse<T>> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })

    const sid = res.headers.get('Mcp-Session-Id')
    if (sid !== null) {
      this.sessionId = sid
    }

    if (res.status === 204) {
      return { jsonrpc: '2.0' } as JsonRpcResponse<T>
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`MCP server returned HTTP ${res.status}: ${text}`)
    }

    const contentType = res.headers.get('Content-Type') ?? ''
    if (contentType.includes('text/event-stream')) {
      return this.parseSSE<T>(await res.text())
    }

    return res.json() as Promise<JsonRpcResponse<T>>
  }

  private parseSSE<T>(text: string): JsonRpcResponse<T> {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6)) as JsonRpcResponse<T>
        } catch {
          // Try the next data line
        }
      }
    }
    throw new Error('No valid data event found in SSE response')
  }

  private unwrap<T>(response: JsonRpcResponse<T>): T {
    if (response.error !== undefined) {
      throw new Error(
        `MCP error ${response.error.code}: ${response.error.message}`,
      )
    }
    if (response.result === undefined) {
      throw new Error('MCP response missing "result" field')
    }
    return response.result
  }
}
