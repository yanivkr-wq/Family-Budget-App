import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  accounts,
  categories,
  transactions,
  installmentPlans,
  recurringPatterns,
  categoryRules,
  households,
  users,
  sessions,
  auditLog,
  undoStack,
  categorizationLog,
  chatSessions,
  chatMessages,
  chatToolCallLog,
  monthlySnapshots,
  anomalies,
} from './schema/index';

export type Household = InferSelectModel<typeof households>;
export type NewHousehold = InferInsertModel<typeof households>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type Category = InferSelectModel<typeof categories>;
export type NewCategory = InferInsertModel<typeof categories>;

export type Transaction = InferSelectModel<typeof transactions>;
export type NewTransaction = InferInsertModel<typeof transactions>;

export type InstallmentPlan = InferSelectModel<typeof installmentPlans>;
export type NewInstallmentPlan = InferInsertModel<typeof installmentPlans>;

export type RecurringPattern = InferSelectModel<typeof recurringPatterns>;
export type NewRecurringPattern = InferInsertModel<typeof recurringPatterns>;

export type CategoryRule = InferSelectModel<typeof categoryRules>;
export type NewCategoryRule = InferInsertModel<typeof categoryRules>;

export type AuditLog = InferSelectModel<typeof auditLog>;
export type NewAuditLog = InferInsertModel<typeof auditLog>;

export type UndoStack = InferSelectModel<typeof undoStack>;
export type NewUndoStack = InferInsertModel<typeof undoStack>;

export type CategorizationLog = InferSelectModel<typeof categorizationLog>;
export type NewCategorizationLog = InferInsertModel<typeof categorizationLog>;

export type ChatSession = InferSelectModel<typeof chatSessions>;
export type NewChatSession = InferInsertModel<typeof chatSessions>;

export type ChatMessage = InferSelectModel<typeof chatMessages>;
export type NewChatMessage = InferInsertModel<typeof chatMessages>;

export type ChatToolCallLog = InferSelectModel<typeof chatToolCallLog>;
export type NewChatToolCallLog = InferInsertModel<typeof chatToolCallLog>;

export type MonthlySnapshot = InferSelectModel<typeof monthlySnapshots>;
export type NewMonthlySnapshot = InferInsertModel<typeof monthlySnapshots>;

export type Anomaly = InferSelectModel<typeof anomalies>;
export type NewAnomaly = InferInsertModel<typeof anomalies>;
