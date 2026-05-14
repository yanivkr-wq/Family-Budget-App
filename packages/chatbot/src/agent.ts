import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@fba/db';
import { TOOL_DEFINITIONS } from './tools/definitions';
import { TOOL_HANDLERS, type ToolContext } from './tools/handlers';
import { buildSystemPrompt } from './system-prompt';
import { runValidator, MIN_ACCEPTABLE_CONFIDENCE, type ValidatorVerdict } from './validator';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_AGENT_STEPS = 8; // safety cap on tool-use loops per user turn
const MAX_VALIDATION_RETRIES = 2; // cap re-asks before we accept whatever we have

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
  // Validation pass — see validator.ts. validation_start fires before the
  // critic call; validation_result carries the verdict. iteration_start
  // fires when we re-run the main agent because the verdict said to retry.
  | { kind: 'validation_start'; round: number }
  | { kind: 'validation_result'; round: number; confidence: number; accepted: boolean; issues: string[]; summaryHe: string }
  | { kind: 'iteration_start'; round: number }
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

    // Tool trace accumulates across the validation-retry rounds so the critic
    // sees everything that fed into the final answer, not just the last loop.
    const toolTrace: Array<{ toolName: string; args: Record<string, unknown>; result: string; isError?: boolean }> = [];

    // The main generation runs inside a validation-retry loop. The first
    // iteration is the "real" turn; subsequent iterations are forced retries
    // triggered by the critic when the answer didn't meet confidence threshold.
    for (let round = 0; round <= MAX_VALIDATION_RETRIES; round++) {
      if (round > 0) {
        opts.onEvent({ kind: 'iteration_start', round });
      }

      const { lastText, stopReason } = await this.runMainLoop({
        systemText,
        messages,
        finalContent,
        toolTrace,
        signal: opts.signal,
        onEvent: opts.onEvent,
        onUsage: (inTok, outTok, stop) => {
          totalIn += inTok;
          totalOut += outTok;
          lastStopReason = stop;
        },
      });
      void stopReason; // (unused; kept for future logging hooks)

      // No tool calls AND no text → nothing to validate; we're done.
      if (toolTrace.length === 0 && lastText.length < 50) break;

      // Validation pass — see validator.ts. We send the question, the
      // candidate answer, and the tool trace so the critic can cross-check
      // claims against the actual data.
      opts.onEvent({ kind: 'validation_start', round: round + 1 });
      const verdict = await runValidator({
        client: this.client,
        model: this.model,
        userText: opts.userText,
        candidateAnswerText: lastText,
        toolTrace,
        signal: opts.signal,
      });
      const accepted = verdict.confidence >= MIN_ACCEPTABLE_CONFIDENCE || !verdict.shouldRetry;
      opts.onEvent({
        kind: 'validation_result',
        round: round + 1,
        confidence: verdict.confidence,
        accepted,
        issues: verdict.issues,
        summaryHe: verdict.summaryHe,
      });

      if (accepted) break;

      // Critic wants a retry. Append a synthetic user message with the
      // feedback and re-enter the main loop. The user's original question
      // stays at its original position in the history — only this nudge is
      // appended.
      if (round < MAX_VALIDATION_RETRIES) {
        const { buildRetryNudge } = await import('./validator');
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: buildRetryNudge(verdict) }],
        });
        // We intentionally do NOT push the retry nudge to finalContent — it
        // is internal scaffolding and shouldn't be persisted as a real user
        // message in chat history.
      }
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

  /**
   * Runs the main tool-use loop once. Returns the final assistant text from
   * this loop and the stop reason. Side effects: mutates `messages` (full
   * conversation including tool results) and `finalContent` (assistant
   * blocks emitted this turn). Pushes any tool calls into `toolTrace` so
   * the validator can audit them later.
   *
   * Split out from runTurn so the validator-retry loop can re-invoke it
   * without duplicating the streaming + tool-dispatch boilerplate.
   */
  private async runMainLoop(args: {
    systemText: string;
    messages: Anthropic.MessageParam[];
    finalContent: Anthropic.ContentBlockParam[];
    toolTrace: Array<{ toolName: string; args: Record<string, unknown>; result: string; isError?: boolean }>;
    signal: AbortSignal | undefined;
    onEvent: RunTurnOpts['onEvent'];
    onUsage: (inTok: number, outTok: number, stopReason: string) => void;
  }): Promise<{ lastText: string; stopReason: string }> {
    let lastText = '';
    let lastStopReason: string = 'end_turn';

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: args.systemText,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: TOOL_DEFINITIONS,
          messages: args.messages,
        },
        { signal: args.signal },
      );

      stream.on('text', (text) => {
        args.onEvent({ kind: 'text_delta', text });
      });

      const finalMsg = await stream.finalMessage();
      args.onUsage(
        finalMsg.usage.input_tokens + (finalMsg.usage.cache_read_input_tokens ?? 0),
        finalMsg.usage.output_tokens,
        finalMsg.stop_reason ?? 'end_turn',
      );
      lastStopReason = finalMsg.stop_reason ?? 'end_turn';

      // Append assistant message (text + tool_use blocks) to messages and finalContent.
      // Also capture the latest assistant text — the validator will look at it.
      const assistantBlocks: Anthropic.ContentBlockParam[] = [];
      let textThisStep = '';
      for (const b of finalMsg.content) {
        if (b.type === 'text') {
          assistantBlocks.push({ type: 'text', text: b.text });
          textThisStep += b.text;
        } else if (b.type === 'tool_use') {
          assistantBlocks.push({
            type: 'tool_use',
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          });
        }
        // thinking / other block types not used here
      }
      args.messages.push({ role: 'assistant', content: assistantBlocks });
      for (const b of assistantBlocks) args.finalContent.push(b);
      if (textThisStep.length > 0) lastText = textThisStep;

      // If no tool calls, we're done with this main-loop pass.
      if (finalMsg.stop_reason !== 'tool_use') {
        break;
      }

      // Execute each tool call and feed results back.
      const toolResults: Anthropic.ContentBlockParam[] = [];
      for (const block of finalMsg.content) {
        if (block.type !== 'tool_use') continue;
        const handler = TOOL_HANDLERS[block.name];
        const start = Date.now();

        args.onEvent({
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
          args.toolTrace.push({
            toolName: block.name,
            args: block.input as Record<string, unknown>,
            result: err,
            isError: true,
          });
          args.onEvent({
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
          args.toolTrace.push({
            toolName: block.name,
            args: block.input as Record<string, unknown>,
            result: json,
          });
          const rows = countRows(result);
          args.onEvent({
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
          args.toolTrace.push({
            toolName: block.name,
            args: block.input as Record<string, unknown>,
            result: msg,
            isError: true,
          });
          args.onEvent({
            kind: 'tool_call_result',
            id: block.id,
            name: block.name,
            rowsReturned: null,
            durationMs: Date.now() - start,
            error: msg,
          });
        }
      }

      args.messages.push({ role: 'user', content: toolResults });
      for (const r of toolResults) args.finalContent.push(r);
    }

    return { lastText, stopReason: lastStopReason };
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
