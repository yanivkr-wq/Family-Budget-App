import { he } from './he';
import { en } from './en';

export type Locale = 'he' | 'en';

export const dictionaries = { he, en } as const;

export function t(locale: Locale) {
  return dictionaries[locale];
}

export { he, en };
