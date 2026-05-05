import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@fba/db';
import { TOOL_DEFINITIONS } from './tools/definitions';
import { TOOL_HANDLERS, type ToolContext } from './tools/handlers';
import { buildSystemPrompt } from './system-prompt';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_AGENT_STEPS = 8; // safety cap on tool-use loops per user turn

export interface AgentDeps {
  db: Database;
  householdId: string;
  userDisplayName?: string | null;
  apiKey?: string;
  model?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  // Stored as Anthropic content blocks (text + tool_use + tool_result) so we can
  // round-trip exactly what the model saw last turn.
  content: Anthropic.ContentBlockParam[];
}

// Streaming events emitted up to the caller (HTTP handler -> SSE).
export type StreamEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'tool_call_start'; id: string; name: string; args: Record<string, unknown> }
  | { kind: 'tool_call_result'; id: string; name: string; rowsReturned: number | null; durationMs: number; error?: string }
  | { kind: 'message_done'; tokensIn: number; tokensOut: number; stopReason: string }
  | { kind: 'final'; assistantContent: Anthropic.ContentBlockParam[] };

export interface RunTurnOpts {
  history: ConversationMessage[];
  userText: string;
  onEvent: (e: StreamEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export class ChatbotAgent {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly toolCtx: ToolContext;
  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    const apiKey = deps.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the chatbot');
    this.client = new Anthropic({ apiKey });
    this.model = deps.model ?? process.env.ANTHROPIC_MODEL_CHATBOT ?? DEFAULT_MODEL;
    this.deps = deps;
    this.toolCtx = { db: deps.db, householdId: deps.householdId };
  }

  async runTurn(opts: RunTurnOpts): Promise<{ assistantContent: Anthropic.ContentBlockParam[] }> {
    const systemText = await buildSystemPrompt({
      db: this.deps.db,
      householdId: this.deps.householdId,
      userDisplayName: this.deps.userDisplayName,
    });

    // Build the messages array: history + new user message.
    const messages: Anthropic.MessageParam[] = [
      ...opts.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: [{ type: 'text', text: opts.userText }] },
    ];

    let totalIn = 0;
    let totalOut = 0;
    let lastStopReason = 'end_turn';
    const finalContent: Anthropic.ContentBlockParam[] = [];

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: systemText,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: TOOL_DEFINITIONS,
          messages,
        },
        { signal: opts.signal },
      );

      stream.on('text', (text) => {
        opts.onEvent({ kind: 'text_delta', text });
      });

      const finalMsg = await stream.finalMessage();
      totalIn += finalMsg.usage.input_tokens + (finalMsg.usage.cache_read_input_tokens ?? 0);
      totalOut += finalMsg.usage.output_tokens;
      lastStopReason = finalMsg.stop_reason ?? 'end_turn';

      // Append assistant message (text + tool_use blocks) to messages and finalContent.
      const assistantBlocks: Anthropic.ContentBlockParam[] = finalMsg.content.map((b) => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        if (b.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          };
        }
        // thinking / other block types not used here
        return { type: 'text', text: '' };
      });
      messages.push({ role: 'assistant', content: assistantBlocks });
      for (const b of assistantBlocks) finalContent.push(b);

      // If no tool calls, we're done.
      if (finalMsg.stop_reason !== 'tool_use') {
        break;
      }

      // Execute each tool call and feed results back.
      const toolResults: Anthropic.ContentBlockParam[] = [];
      for (const block of finalMsg.content) {
        if (block.type !== 'tool_use') continue;
        const handler = TOOL_HANDLERS[block.name];
        const start = Date.now();

        opts.onEvent({
          kind: 'tool_call_start',
          id: block.id,
          name: block.name,
          args: block.input as Record<string, unknown>,
        });

        if (!handler) {
          const err = `Unknown tool: ${block.name}`;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: err,
            is_error: true,
          });
          opts.onEvent({
            kind: 'tool_call_result',
            id: block.id,
            name: block.name,
            rowsReturned: null,
            durationMs: Date.now() - start,
            error: err,
          });
          continue;
        }

        try {
          const result = await handler(this.toolCtx, block.input);
          const json = JSON.stringify(result);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: json,
          });
          const rows = countRows(result);
          opts.onEvent({
            kind: 'tool_call_result',
            id: block.id,
            name: block.name,
            rowsReturned: rows,
            durationMs: Date.now() - start,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: msg,
            is_error: true,
          });
          opts.onEvent({
            kind: 'tool_call_result',
            id: block.id,
            name: block.name,
            rowsReturned: null,
            durationMs: Date.now() - start,
            error: msg,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      for (const r of toolResults) finalContent.push(r);
    }

    opts.onEvent({
      kind: 'message_done',
      tokensIn: totalIn,
      tokensOut: totalOut,
      stopReason: lastStopReason,
    });
    opts.onEvent({ kind: 'final', assistantContent: finalContent });

    return { assistantContent: finalContent };
  }
}

function countRows(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.count === 'number') return r.count;
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (Array.isArray(v)) return v.length;
  }
  return null;
}
