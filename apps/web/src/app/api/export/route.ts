/**
 * GET /api/export — Excel export endpoint.
 *
 * Query params:
 *   sheets    Comma-separated list of sheet kinds. Default: all.
 *             Values: transactions, category-summary, recurring,
 *             installments, notifications, accounts
 *   from      YYYY-MM-DD start of date filter (transactions + summary only)
 *   to        YYYY-MM-DD end of date filter
 *
 * Returns: an .xlsx file as application/octet-stream with
 * Content-Disposition: attachment; the filename includes the date stamp
 * and (when only one sheet was requested) the sheet name.
 *
 * Auth: same NextAuth session as everywhere else; rejects with 401 if no
 * user. Household scope is enforced inside the export builder, never
 * trusted from query params.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { buildExportWorkbook, type SheetKind } from '@/lib/export-builder';

const ALL_SHEETS: SheetKind[] = [
  'transactions',
  'category-summary',
  'recurring',
  'installments',
  'notifications',
  'accounts',
];

const VALID = new Set<string>(ALL_SHEETS);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  // Parse + validate sheets
  const requested = searchParams.get('sheets');
  let sheets: SheetKind[];
  if (!requested) {
    sheets = ALL_SHEETS;
  } else {
    sheets = requested
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SheetKind => VALID.has(s));
    if (sheets.length === 0) {
      return NextResponse.json({ error: 'no valid sheets requested' }, { status: 400 });
    }
  }

  // Parse date range — minimal validation; the SQL parameterizer handles
  // anything malformed gracefully (just returns no rows).
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const isIsoDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  const { buffer, filename } = await buildExportWorkbook({
    householdId: session.user.householdId,
    dateFrom:    isIsoDate(from) ? from : null,
    dateTo:      isIsoDate(to)   ? to   : null,
    sheets,
  });

  // Copy into a fresh ArrayBuffer-backed Uint8Array to satisfy strict TS
  // BlobPart typing (Buffer's underlying ArrayBufferLike could in theory be
  // a SharedArrayBuffer, which Blob doesn't accept).
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  const body = new Blob([ab], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  // Content-Disposition header bytes must be ASCII-only. The Hebrew sheet
  // names in our filename (e.g. "family-budget_תנועות_2026-05-09.xlsx") are
  // not — Chrome rejects the response as "Site wasn't available" + falls
  // back to a generic "export.txt" name.
  //
  // RFC 5987 fix: provide both an ASCII-safe filename (for legacy clients)
  // and a UTF-8 percent-encoded filename* parameter (for modern browsers).
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/_+/g, '_');
  const utf8Encoded   = encodeURIComponent(filename);
  const contentDisposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition,
      'Content-Length':      String(buffer.byteLength),
      'Cache-Control':       'no-store',
    },
  });
}
