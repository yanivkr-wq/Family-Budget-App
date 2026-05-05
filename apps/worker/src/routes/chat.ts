import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, schema, encryptString, decryptString } from '@fba/db';
import { ChatbotAgent, type ConversationMessage, type StreamEvent } from '@fba/chatbot';
import { and, asc, eq } from 'drizzle-orm';
import type { Config } from '../config';

const ChatRequest = z.object({
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  userDisplayName: z.string().optional().nullable(),
  sessionId: z.string().uuid().nullable().optional(), // null = new session
  message: z.string().min(1).max(4000),
});

export async function registerChatRoutes(
  app: FastifyInstance,
  opts: { config: Config },
) {
  app.post('/chat', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      return;
    }
    const body = parsed.data;
    const db = getDb();

    // Find or create chat session
    let sessionId = body.sessionId;
    if (!sessionId) {
      const [session] = await db
        .insert(schema.chatSessions)
        .values({ householdId: body.householdId, userId: body.userId })
        .returning();
      sessionId = session!.id;
    } else {
      // Verify session belongs to the household — defense in depth.
      const [s] = await db
        .select()
        .from(schema.chatSessions)
        .where(
          and(
            eq(schema.chatSessions.id, sessionId),
            eq(schema.chatSessions.householdId, body.householdId),
          ),
        )
        .limit(1);
      if (!s) {
        reply.code(404).send({ error: 'session_not_found' });
        return;
      }
    }

    // Load last 20 turns of history for the model
    const historyRows = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessionId))
      .orderBy(asc(schema.chatMessages.createdAt))
      .limit(40);

    const history: ConversationMessage[] = historyRows
      .filter((r) => r.role !== 'tool') // tool blocks live inside assistant content
      .map((r) => ({
        role: r.role as 'user' | 'assistant',
        content: JSON.parse(decryptString(r.contentEncrypted)),
      }));

    // Persist the new user message before calling the model.
    const [userMsg] = await db
      .insert(schema.chatMessages)
      .values({
        sessionId,
        role: 'user',
        contentEncrypted: encryptString(JSON.stringify([{ type: 'text', text: body.message }])),
      })
      .returning();

    // SSE response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ kind: 'session', sessionId, userMessageId: userMsg!.id });

    const agent = new ChatbotAgent({
      db,
      householdId: body.householdId,
      userDisplayName: body.userDisplayName ?? null,
      model: opts.config.ANTHROPIC_MODEL_CHATBOT,
      apiKey: opts.config.ANTHROPIC_API_KEY,
    });

    const toolCallLogQueue: Array<{
      toolName: string;
      argsJson: unknown;
      durationMs: number;
      rowsReturned: number | null;
      error?: string;
    }> = [];

    let assistantContent: unknown[] = [];
    let usageIn = 0;
    let usageOut = 0;
    let stopReason = 'end_turn';

    const onEvent = (e: StreamEvent) => {
      send(e);
      if (e.kind === 'tool_call_result') {
        toolCallLogQueue.push({
          toolName: e.name,
          argsJson: {}, // populated below by matching id
          durationMs: e.durationMs,
          rowsReturned: e.rowsReturned,
          error: e.error,
        });
      }
      if (e.kind === 'message_done') {
        usageIn = e.tokensIn;
        usageOut = e.tokensOut;
        stopReason = e.stopReason;
      }
      if (e.kind === 'final') {
        assistantContent = e.assistantContent;
      }
    };

    try {
      const abort = new AbortController();
      req.raw.on('close', () => abort.abort());
      await agent.runTurn({ history, userText: body.message, onEvent, signal: abort.signal });
    } catch (err) {
      app.log.error({ err }, 'Chat agent error');
      send({ kind: 'error', message: err instanceof Error ? err.message : 'unknown' });
      reply.raw.end();
      return;
    }

    // Persist assistant message and tool-call log entries.
    const [asstMsg] = await db
      .insert(schema.chatMessages)
      .values({
        sessionId,
        role: 'assistant',
        contentEncrypted: encryptString(JSON.stringify(assistantContent)),
        model: opts.config.ANTHROPIC_MODEL_CHATBOT,
        tokensIn: usageIn,
        tokensOut: usageOut,
        stopReason,
      })
      .returning();

    if (toolCallLogQueue.length > 0) {
      // Match each result to its tool_use block by index — adequate for our purposes.
      const toolUses = (assistantContent as Array<{ type: string; id?: string; name?: string; input?: unknown }>)
        .filter((b) => b.type === 'tool_use');
      const rows = toolCallLogQueue.map((q, i) => ({
        messageId: asstMsg!.id,
        toolName: q.toolName,
        argsJson: (toolUses[i]?.input ?? {}) as object,
        durationMs: q.durationMs,
        rowsReturned: q.rowsReturned,
        resultSummary: null,
        error: q.error ?? null,
      }));
      await db.insert(schema.chatToolCallLog).values(rows);
    }

    await db
      .update(schema.chatSessions)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.chatSessions.id, sessionId));

    send({ kind: 'persisted', assistantMessageId: asstMsg!.id });
    reply.raw.end();
  });
}
