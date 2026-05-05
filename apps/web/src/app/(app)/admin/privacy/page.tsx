import { auth } from '@/lib/auth';
import { getDb, schema } from '@fba/db';
import { desc, eq } from 'drizzle-orm';
import { describeCategorization, describeChatToolCall } from '@/lib/privacy-narratives';
import { Shield, Eye, EyeOff, ScrollText, MessageCircle, Bot } from 'lucide-react';
import { PrivacyEntryToggle } from './client';

export const dynamic = 'force-dynamic';

export default async function PrivacyLedgerPage() {
  const session = await auth();
  const householdId = session!.user.householdId;
  const db = getDb();

  // Categorization log
  const catLogs = await db
    .select()
    .from(schema.categorizationLog)
    .where(eq(schema.categorizationLog.householdId, householdId))
    .orderBy(desc(schema.categorizationLog.createdAt))
    .limit(100);

  // Chat tool-call log — join via chat_message → chat_session for household scoping
  const chatLogs = await db
    .select({
      id: schema.chatToolCallLog.id,
      toolName: schema.chatToolCallLog.toolName,
      argsJson: schema.chatToolCallLog.argsJson,
      rowsReturned: schema.chatToolCallLog.rowsReturned,
      durationMs: schema.chatToolCallLog.durationMs,
      error: schema.chatToolCallLog.error,
      createdAt: schema.chatToolCallLog.createdAt,
      sessionId: schema.chatMessages.sessionId,
    })
    .from(schema.chatToolCallLog)
    .innerJoin(
      schema.chatMessages,
      eq(schema.chatMessages.id, schema.chatToolCallLog.messageId),
    )
    .innerJoin(
      schema.chatSessions,
      eq(schema.chatSessions.id, schema.chatMessages.sessionId),
    )
    .where(eq(schema.chatSessions.householdId, householdId))
    .orderBy(desc(schema.chatToolCallLog.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">יומן פרטיות</h1>
        <p className="text-sm text-muted-foreground">
          רשימה מלאה של כל קריאה שיצאה ל-Claude. ניתן לראות את הסיפור (תיאור פשוט) או את הלוג הטכני המלא.
        </p>
      </header>

      <section className="tile space-y-3 border-accent/40 bg-accent-soft/30">
        <div className="flex items-center gap-2 text-sm font-medium text-accent">
          <Shield className="size-4" />
          <span>מה Claude ראה ולא ראה — בקצרה</span>
        </div>
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="rounded-md border border-success/30 bg-success-soft/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-success">
              <Eye className="size-4" />
              <strong>נשלח ל-Claude:</strong>
            </div>
            <ul className="ms-5 list-disc space-y-1 text-muted-foreground">
              <li>שמות בתי עסק (לדוגמה: "שופרסל ירושלים")</li>
              <li>סכומי תנועות</li>
              <li>תאריכים וחודשי חיוב</li>
              <li>שמות קטגוריות (לבחירה)</li>
              <li>תוצאות שאילתות מהמאגר (כקריאה בלבד)</li>
            </ul>
          </div>
          <div className="rounded-md border border-destructive/30 bg-destructive-soft/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-destructive">
              <EyeOff className="size-4" />
              <strong>לא נשלח ל-Claude:</strong>
            </div>
            <ul className="ms-5 list-disc space-y-1 text-muted-foreground">
              <li>סיסמאות, אימיילים, שמות משתמש</li>
              <li>מספרי חשבון בנק / כרטיסי אשראי</li>
              <li>יתרות חשבון</li>
              <li>שמות חשבונות אמיתיים (מוסווים ל-Account 1, Account 2)</li>
              <li>הרשאת כתיבה — אין כלי שמאפשר שינוי נתונים</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- Categorization log ---------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ScrollText className="size-4 text-muted-foreground" />
          <span>קטגוריזציה אוטומטית</span>
          <span className="pill bg-muted text-muted-foreground">{catLogs.length}</span>
        </h2>
        {catLogs.length === 0 ? (
          <div className="rounded-md border border-dashed bg-subtle p-6 text-center text-sm text-muted-foreground">
            אין רשומות. כשמייבאים תנועות והמערכת לא מזהה קטגוריה לפי כללים, היא שולחת את שם בית העסק ל-Claude כדי לקבל הצעה. כל קריאה כזו תופיע כאן.
          </div>
        ) : (
          <div className="space-y-2">
            {catLogs.map((row) => {
              const story = describeCategorization(row);
              return (
                <PrivacyEntryToggle
                  key={row.id}
                  icon={<Bot className="size-4" />}
                  title={story.title}
                  body={story.body}
                  whatLeft={story.whatLeft}
                  whatStayed={story.whatStayed}
                  technical={{
                    request: row.requestPayload,
                    model: row.model,
                    durationMs: row.durationMs,
                    tokensIn: row.tokensIn,
                    tokensOut: row.tokensOut,
                    response: {
                      categoryId: row.responseCategoryId,
                      subCategoryId: row.responseSubCategoryId,
                      confidence: row.confidence,
                    },
                    createdAt: row.createdAt.toISOString(),
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Chat tool calls ---------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <MessageCircle className="size-4 text-muted-foreground" />
          <span>קריאות כלים בצ׳אט</span>
          <span className="pill bg-muted text-muted-foreground">{chatLogs.length}</span>
        </h2>
        {chatLogs.length === 0 ? (
          <div className="rounded-md border border-dashed bg-subtle p-6 text-center text-sm text-muted-foreground">
            אין רשומות. כשאת/ה שואל/ת את הצ׳אטבוט שאלה, הוא משתמש בכלים שונים כדי להגיע למידע. כל שימוש כזה מתועד כאן.
          </div>
        ) : (
          <div className="space-y-2">
            {chatLogs.map((row) => {
              const story = describeChatToolCall(row);
              return (
                <PrivacyEntryToggle
                  key={row.id}
                  icon={<MessageCircle className="size-4" />}
                  title={story.title}
                  body={story.body}
                  whatLeft={story.whatLeft}
                  whatStayed={story.whatStayed}
                  technical={{
                    toolName: row.toolName,
                    args: row.argsJson,
                    rowsReturned: row.rowsReturned,
                    durationMs: row.durationMs,
                    error: row.error,
                    sessionId: row.sessionId,
                    createdAt: row.createdAt.toISOString(),
                  }}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
