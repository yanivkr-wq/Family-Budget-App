/**
 * Internal route used by the web app's "Send test now" button on the
 * notification modal. Bypasses the cron and the database — fires straight
 * through the channel adapters with whatever payload the caller sends.
 *
 * Output: per-channel × per-recipient counts so the UI can show
 * "5 sent, 1 failed, 2 skipped".
 *
 * No event_log writes — this is purely transient. The user is debugging
 * their setup, they don't want test fires polluting the bell history.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendEmail, sendInApp, sendWhatsApp, type ChannelOutcome } from '../notifications/channels';
import type { Config } from '../config';

const Body = z.object({
  title:       z.string().default('בדיקה'),
  description: z.string().default(''),
  channels:    z.object({
    in_app:   z.boolean(),
    email:    z.boolean(),
    whatsapp: z.boolean(),
  }),
  recipients:  z.array(z.object({
    email: z.string().nullable(),
    phone: z.string().nullable(),
    label: z.string().optional(),
  })),
});

export async function registerNotificationRoutes(app: FastifyInstance, opts: { config: Config }) {
  app.post('/notifications/test-fire', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid body', details: parsed.error.format() });
      return;
    }
    const { title, description, channels, recipients } = parsed.data;
    const body = description ? `${description}\n\n(זוהי הודעת בדיקה ידנית — לא נשמרה במערכת)` : '(הודעת בדיקה)';

    let sent = 0, failed = 0, skipped = 0;

    // in_app: shared, fires once regardless of recipient count.
    if (channels.in_app) {
      const out = await sendInApp({ title, body });
      tally(out);
    }

    // email + whatsapp: per recipient.
    for (const r of recipients) {
      if (channels.email) {
        const out = await sendEmail({ title, body, toEmail: r.email, toPhone: r.phone }, opts.config);
        tally(out);
      }
      if (channels.whatsapp) {
        const out = await sendWhatsApp({ title, body, toEmail: r.email, toPhone: r.phone }, opts.config);
        tally(out);
      }
    }

    function tally(o: ChannelOutcome) {
      if (o.ok) sent += 1;
      else if ('skipped' in o && o.skipped) skipped += 1;
      else failed += 1;
    }

    reply.code(200).send({ sent, failed, skipped });
  });
}
