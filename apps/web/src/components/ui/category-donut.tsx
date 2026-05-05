'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatIls } from '@fba/shared';

export interface CategoryDonutDatum {
  name: string;
  value: number;
  color: string;
}

interface CategoryDonutProps {
  data: CategoryDonutDatum[];
  /** Center number, e.g. total spent. Hidden if undefined. */
  centerValue?: number;
  centerLabel?: string;
  height?: number;
}

const FALLBACK_COLORS = [
  'hsl(215 65% 35%)',
  'hsl(175 50% 38%)',
  'hsl(35 70% 50%)',
  'hsl(145 40% 38%)',
  'hsl(280 35% 45%)',
  'hsl(358 55% 50%)',
  'hsl(195 50% 40%)',
];

export function CategoryDonut({ data, centerValue, centerLabel, height = 220 }: CategoryDonutProps) {
  const cleaned = data.filter((d) => d.value > 0);
  if (cleaned.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        אין נתונים
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={cleaned}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {cleaned.map((d, i) => (
              <Cell key={d.name} fill={d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]!} />
            ))}
          </Pie>
          <Tooltip
            cursor={false}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
              fontSize: '12px',
              padding: '8px 10px',
              boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.1)',
            }}
            formatter={(value: number, name) => [formatIls(value), name]}
            labelFormatter={() => ''}
          />
        </PieChart>
      </ResponsiveContainer>

      {centerValue !== undefined && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              {centerLabel}
            </span>
          )}
          <span className="text-xl font-semibold tabular-nums">
            {formatIls(centerValue, { decimals: false })}
          </span>
        </div>
      )}
    </div>
  );
}
