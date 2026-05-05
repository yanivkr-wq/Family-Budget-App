import { auth } from '@/lib/auth';
import { workerHeaders, workerUrl } from '@/lib/worker-client';

export const runtime = 'nodejs';
export const maxDuration = 120; // seconds — long enough for multi-step tool use

interface ChatRequestBody {
  householdId: string;
  userId: string;
  userDisplayName?: string | null;
  sessionId?: string | null;
  message: string;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = (await req.json()) as ChatRequestBody;

  // Defense in depth: never trust the body's householdId/userId — overwrite from session.
  const safeBody: ChatRequestBody = {
    householdId: session.user.householdId,
    userId: session.user.id,
    userDisplayName: session.user.name ?? null,
    sessionId: body.sessionId ?? null,
    message: body.message,
  };

  const upstream = await fetch(workerUrl('/chat'), {
    method: 'POST',
    headers: workerHeaders(),
    body: JSON.stringify(safeBody),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text || 'Worker error', { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
