/**
 * NEW — Foreign currency exposure.
 *
 * Per non-ILS currency: count of transactions, original-currency total,
 * ILS-converted total, and the top 3 merchants. Useful after travel /
 * online purchases.
 */

import Link from 'next/link';
import { formatIls } from '@fba/shared';
import { Globe2 } from 'lucide-react';
import { InsightCard } from '@/components/insights/insight-card';
import type { ForeignCurrencyBucket } from '@/app/(app)/insights/queries';
import { INSIGHT_EXPLANATIONS } from '@/app/(app)/insights/explanations';

interface Props {
  windowLabel: string;
  buckets: ForeignCurrencyBucket[];
}

const CURRENCY_FLAG: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CHF: '🇨🇭',
  AUD: '🇦🇺',
  CAD: '🇨🇦',
};

export function CardForeignCurrency({ windowLabel, buckets }: Props) {
  if (buckets.length === 0) {
    return (
      <InsightCard
        id="foreign-currency"
        title="חשיפה למטבע זר"
        subtitle={windowLabel}
        icon={<Globe2 className="size-4 shrink-0" aria-hidden />}
        tone="neutral"
        info={INSIGHT_EXPLANATIONS['foreign-currency']}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-xs text-muted-foreground">לא נמצאו תנועות במטבע זר בטווח הנבחר</p>
          <p className="text-2xs text-muted-foreground/80">
            יופיעו כאן רכישות בדולר, אירו, וכו'
          </p>
        </div>
      </InsightCard>
    );
  }

  const totalIls = buckets.reduce((s, b) => s + b.totalIls, 0);

  return (
    <InsightCard
      id="foreign-currency"
      title="חשיפה למטבע זר"
      subtitle={windowLabel}
      icon={<Globe2 className="size-4 shrink-0" aria-hidden />}
      tone="accent"
      info={INSIGHT_EXPLANATIONS['foreign-currency']}
    >
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">
            {formatIls(totalIls, { decimals: false })}
          </span>
          <span className="text-2xs text-muted-foreground">סה"כ ב-{buckets.length} מטבעות</span>
        </div>

        <ul className="space-y-2">
          {buckets.slice(0, 3).map((b) => (
            <li key={b.currency} className="rounded-md border bg-muted/20 p-2">
              <div className="flex items-baseline justify-between gap-2">
                {/* RTL-correct order: Hebrew text reads right-to-left so the
                    flag + currency code anchor on the visual LEFT (logical
                    "end" in RTL). The count + Hebrew label flow to the right. */}
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-2xs text-muted-foreground">
                    {b.countTransactions} תנועות ב-
                  </span>
                  <span className="font-semibold tabular-nums" dir="ltr">
                    {b.currency}
                  </span>
                  <span aria-hidden>{CURRENCY_FLAG[b.currency] ?? '🌐'}</span>
                </span>
                <span className="text-xs tabular-nums shrink-0">
                  {formatIls(b.totalIls, { decimals: false })}
                  <span className="ms-1 text-2xs text-muted-foreground" dir="ltr">
                    ({b.totalOriginal.toLocaleString('he-IL', { maximumFractionDigits: 0 })} {b.currency})
                  </span>
                </span>
              </div>
              {b.topMerchants.length > 0 && (
                <p className="mt-1 truncate text-2xs text-muted-foreground">
                  {b.topMerchants.map((m, i) => (
                    <span key={m.merchant}>
                      {i > 0 && <span aria-hidden> · </span>}
                      <Link
                        href={`/transactions?text=${encodeURIComponent(m.merchant)}`}
                        className="hover:text-accent hover:underline transition-colors"
                      >
                        {m.merchant}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </InsightCard>
  );
}
