/**
 * Post-answer validation pass for the chatbot.
 *
 * After the main agent loop produces a candidate answer, this validator runs
 * a SEPARATE LLM call in the role of a strict critic. The critic sees:
 *   - the user's question
 *   - the candidate answer (final assistant text)
 *   - every tool call the main agent made + its result (so the critic can
 *     verify claims against the actual data, not just rephrase the answer)
 *
 * The critic returns a structured JSON verdict with a 0-100 confidence score
 * and a list of issues. If confidence < threshold, the agent loop re-runs
 * with the critic's feedback appended as a system note, asking the main
 * model to correct or re-justify.
 *
 * Why a separate call: an LLM scoring its own answer in the same context
 * exhibits strong overconfidence bias. A fresh call with a critic system
 * prompt and no prior commitment to the answer is materially more skeptical.
 *
 * Cost note: the validator is roughly a single LLM call per turn — it
 * doesn't loop. The main agent may loop based on the verdict, capped by
 * MAX_VALIDATION_RETRIES in agent.ts.
 */

import Anthropic from '@anthropic-ai/sdk';

/** Score threshold below which we re-ask the main agent. Set high so the
 *  critic is actually doing work — at 95 the bar is "no meaningful concerns".
 *  Drop to 80 if validation is too aggressive in practice. */
export const MIN_ACCEPTABLE_CONFIDENCE = 95;

export interface ValidatorVerdict {
  /** 0-100. 100 = no concerns. */
  confidence: number;
  /** Specific issues the critic found, one per bullet. Empty when accepted. */
  issues: string[];
  /** True when the main agent should retry with the feedback above. */
  shouldRetry: boolean;
  /** Short summary the UI can show ("Looks good" / "Found 2 issues"). */
  summaryHe: string;
}

export interface ValidatorInput {
  client: Anthropic;
  model: string;
  /** The user's most recent question. */
  userText: string;
  /** The candidate assistant answer text (concatenation of text blocks). */
  candidateAnswerText: string;
  /** Tool calls + results from the turn, serialized compactly. */
  toolTrace: ToolTraceEntry[];
  /** Optional abort signal to cancel the validator mid-stream. */
  signal?: AbortSignal;
}

export interface ToolTraceEntry {
  toolName: string;
  args: Record<string, unknown>;
  /** Stringified result. Truncated by caller if huge. */
  result: string;
  isError?: boolean;
}

/**
 * Build the critic system prompt. Deliberately strict — we want the
 * validator to err toward flagging issues rather than rubber-stamping.
 */
function buildCriticSystemPrompt(): string {
  return [
    'You are a strict validator for a Hebrew family-budget chatbot. Your only job is to score whether a candidate answer is accurate, consistent, and well-supported by the data the assistant actually fetched.',
    '',
    'You will see:',
    '  1. The user question (Hebrew or English).',
    '  2. The assistant\'s candidate answer.',
    '  3. The trace of every tool call the assistant made and the results returned.',
    '',
    'Score the answer 0-100 on a SINGLE dimension: how confident you are that what the assistant said is FACTUALLY CORRECT given the tool results. Specifically check:',
    '',
    '- **Numbers**: Every ILS amount, count, percentage, or date in the answer must be derivable from the tool results. If the assistant said "₪1,200 was spent on groceries", grep the tool trace for that number. If it\'s not there, big red flag.',
    '- **Widget logic claims**: If the answer cites how a widget computes its value ("the income tile uses bank rows only", "it excludes projects"), and the assistant called `get_widget_spec`, verify the claim matches what the spec actually says.',
    '- **Time scope**: If the user asked about "this month" and the assistant cited a number, does the tool call use the right billing_month or date range? Don\'t let an answer about "this month" quote data from a different month without flagging it.',
    '- **Sign / direction**: If the assistant says "income was X" but X is negative, or "you saved Y" but Y is a spend, that\'s wrong even if the magnitude is right.',
    '- **Unsupported claims**: Any statement that isn\'t derivable from the tool trace and isn\'t obvious common knowledge (e.g. "today is Sunday") should count as an issue.',
    '',
    'Things that are NOT issues:',
    '- Style, brevity, formatting.',
    '- Generic budgeting advice (the assistant is allowed to give that).',
    '- The assistant correctly saying "I don\'t have enough data" or asking a clarifying question — that\'s good.',
    '',
    'You MUST return a single JSON object, nothing else, in EXACTLY this shape:',
    '{',
    '  "confidence": <integer 0-100>,',
    '  "issues": [<string>, ...],',
    '  "shouldRetry": <boolean>,',
    '  "summaryHe": "<short Hebrew summary, e.g. \'נראה תקין\' or \'נמצאו 2 בעיות\'>"',
    '}',
    '',
    `Set shouldRetry=true if confidence < ${MIN_ACCEPTABLE_CONFIDENCE} AND the issues are correctable (i.e. the assistant could re-answer better given the same data or one extra tool call). Set shouldRetry=false when:`,
    '  - confidence is high (no issues), OR',
    '  - the issue is "no tool was called and the question needed data" — but the assistant already said "I don\'t have enough info" appropriately, OR',
    '  - the only way to fix the issue is to fetch new data, but the user\'s question is genuinely unanswerable.',
    '',
    'Be terse. Each issue is one sentence. Do not write the corrected answer here — that\'s the main agent\'s job on retry.',
  ].join('\n');
}

/**
 * Build the user-role payload the critic reads. Compact: the question, the
 * candidate answer, then the tool trace.
 */
function buildCriticUserPayload(input: ValidatorInput): string {
  const lines: string[] = [];
  lines.push('## User question');
  lines.push(input.userText);
  lines.push('');
  lines.push('## Candidate assistant answer');
  lines.push(input.candidateAnswerText || '(empty)');
  lines.push('');
  lines.push('## Tool trace');
  if (input.toolTrace.length === 0) {
    lines.push('(no tool calls — the assistant answered from prior context or refused)');
  } else {
    input.toolTrace.forEach((t, i) => {
      lines.push(`### Call ${i + 1}: ${t.toolName}${t.isError ? ' [ERROR]' : ''}`);
      lines.push('args: ' + JSON.stringify(t.args));
      // Truncate very large results so the validator turn stays bounded.
      const result = t.result.length > 4000 ? t.result.slice(0, 4000) + '... [TRUNCATED]' : t.result;
      lines.push('result: ' + result);
      lines.push('');
    });
  }
  return lines.join('\n');
}

/**
 * Run the validator. Returns the parsed verdict, or a permissive fallback
 * verdict if the call fails / the JSON is malformed (we don't want a
 * validator outage to break the user's turn).
 */
export async function runValidator(input: ValidatorInput): Promise<ValidatorVerdict> {
  try {
    const systemText = buildCriticSystemPrompt();
    const userPayload = buildCriticUserPayload(input);

    const response = await input.client.messages.create(
      {
        model: input.model,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: systemText,
            // Critic prompt is stable across turns within a session, cache it.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPayload }],
      },
      { signal: input.signal },
    );

    // Concatenate text blocks (we asked for JSON only — any thinking blocks
    // are filtered out automatically since we didn't enable extended thinking).
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    const verdict = parseVerdictLenient(text);
    if (verdict) return verdict;

    // Malformed JSON — be permissive but log. We'd rather show the user a
    // good answer than block on validator weirdness.
    return permissiveFallback('Validator returned malformed JSON');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return permissiveFallback(`Validator call failed: ${msg}`);
  }
}

/**
 * Parse the critic's JSON output, tolerant to common variations (wrapped in
 * code fences, trailing prose, etc.).
 */
function parseVerdictLenient(text: string): ValidatorVerdict | null {
  // Strip code fences if present.
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Find the first '{' and last '}' and parse the slice between.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) return null;
  cleaned = cleaned.slice(first, last + 1);
  try {
    const obj = JSON.parse(cleaned) as Partial<ValidatorVerdict>;
    if (typeof obj.confidence !== 'number') return null;
    return {
      confidence: Math.max(0, Math.min(100, Math.round(obj.confidence))),
      issues: Array.isArray(obj.issues) ? obj.issues.filter((s): s is string => typeof s === 'string') : [],
      shouldRetry: typeof obj.shouldRetry === 'boolean' ? obj.shouldRetry : false,
      summaryHe: typeof obj.summaryHe === 'string' && obj.summaryHe.length > 0 ? obj.summaryHe : (obj.confidence >= MIN_ACCEPTABLE_CONFIDENCE ? 'נראה תקין' : 'נמצאו בעיות'),
    };
  } catch {
    return null;
  }
}

/** Conservative default when validation can't run — accept the answer. */
function permissiveFallback(reason: string): ValidatorVerdict {
  return {
    confidence: 100,
    issues: [`(validator skipped: ${reason})`],
    shouldRetry: false,
    summaryHe: 'בלי אימות',
  };
}

/**
 * Build the synthetic user message the main agent receives on retry. Frames
 * the validator's issues as a "reviewer note" so the model knows to address
 * them rather than re-defend its previous answer.
 */
export function buildRetryNudge(verdict: ValidatorVerdict): string {
  const lines: string[] = [];
  lines.push('## Internal validation feedback');
  lines.push(`A reviewer agent scored your previous answer ${verdict.confidence}/100 and flagged these issues:`);
  for (const issue of verdict.issues) {
    lines.push(`- ${issue}`);
  }
  lines.push('');
  lines.push('Please re-answer the original question, addressing the issues above. If you need to fetch more data to verify a claim, call a tool. Do not simply repeat your previous wording — fix the substance.');
  return lines.join('\n');
}
