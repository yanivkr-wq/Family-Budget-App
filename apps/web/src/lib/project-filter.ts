/**
 * Re-export of the shared project-exclusion SQL fragment from @fba/db.
 * Kept here so all the existing app-side imports stay stable; the actual
 * implementation lives in packages/db/src/helpers/project-filter.ts so
 * the chatbot package can use the same helper.
 */

export { excludeHiddenProjectTxns } from '@fba/db';
