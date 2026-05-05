/**
 * Shared icon renderer for savings goals.
 *
 * The DB stores the Lucide component NAME (e.g., "HeartPulse") on
 * `saving_goal.icon`. This component looks the name up in ICON_MAP and renders
 * the matching SVG, falling back to PiggyBank for null / unknown values.
 *
 * Used in:
 *   - apps/web/src/app/(app)/savings/client.tsx — picker + goal cards
 *   - apps/web/src/app/(app)/page.tsx           — dashboard savings snapshot
 *
 * To add a new preset, add a row to both ICON_MAP (here) and ICON_PRESETS
 * (savings/client.tsx).
 */

import {
  HeartPulse,
  Car,
  Home,
  Plane,
  BookOpen,
  Wallet,
  Target,
  TrendingUp,
  PiggyBank,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

export const GOAL_ICON_MAP: Record<string, LucideIcon> = {
  HeartPulse,
  Car,
  Home,
  Plane,
  BookOpen,
  Wallet,
  Target,
  TrendingUp,
  PiggyBank, // fallback / "general"
};

export type GoalIconName = keyof typeof GOAL_ICON_MAP;

export function GoalIcon({
  name,
  className,
  style,
}: {
  name: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon: LucideIcon = (name ? GOAL_ICON_MAP[name] : undefined) ?? PiggyBank;
  return <Icon className={className} style={style} />;
}
