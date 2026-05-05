/**
 * Shared icon map for the dashboard's AI Insights widget.
 *
 * Insights store an icon NAME (string) instead of the Lucide component itself
 * so the data can cross the Server → Client component boundary. Both the
 * server-rendered InsightsWidget (in page.tsx) and the client-side
 * InsightDetailsToggle resolve the name to a component via this map.
 *
 * Add a new icon: import it here, add the name → component entry below.
 */

import {
  AlertOctagon,
  AlertTriangle,
  CreditCard,
  PartyPopper,
  Repeat,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export const INSIGHT_ICONS = {
  AlertOctagon,
  AlertTriangle,
  CreditCard,
  PartyPopper,
  Repeat,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} satisfies Record<string, LucideIcon>;

export type InsightIconName = keyof typeof INSIGHT_ICONS;
