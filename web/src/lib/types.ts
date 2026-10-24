// Shared server contract types for the console.

export interface CaseRecord {
  caseId: string;
  version: number;
  agentId: string | null;
  injectionSuspected?: boolean;
  extractionMode: 'MODEL' | 'FIXTURE' | 'MANUAL';
  action: {
    actionType: string;
    captureId: string;
    orderId: string;
    amount: number;
    currency: string;
    merchantId: string;
    customerId: string;
    reason: string;
  };
  claim: {
    claimType: string;
    orderReference: string | null;
    captureReference: string | null;
    rawStatement: string;
    extractedAmount: number | null;
    extractedCurrency: string | null;
  };
  verification: {
    verdict: 'VERIFIED' | 'CONTRADICTED' | 'UNKNOWN';
    decision: 'EXECUTE' | 'DENY' | 'REVIEW';
    reasonCodes: string[];
    unresolvedFacts: string[];
    evidenceUsed: EvidenceRecord[];
    relationshipBinding: {
      valid: boolean;
      warnings: string[];
      graph: RelationshipNode[];
    };
  };
  policy: {
    permitted: boolean;
    requiresApproval: boolean;
    reasonCodes: string[];
    violations: string[];
    maxAutonomousAmount: number;
    remainingRefundable: number;
    policyVersion: string;
  };
  decision: 'EXECUTE' | 'DENY' | 'REVIEW';
  executionState: string;
  refundId: string | null;
  approvalId: string | null;
  createdAt: string;
  updatedAt?: string;
  error: string | null;
  mode: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  provider: string;
  providerId: string;
  parentId: string | null;
  recordType: string;
  state: string;
  timestamp: string;
  data: Record<string, unknown>;
  provenance: string;
}

export interface RelationshipNode {
  id: string;
  type: string;
  provider: string;
  providerId: string;
  parentId: string | null;
  state: string;
  metadata: Record<string, unknown>;
}

export interface InboxMessageView {
  id: string;
  from: string;
  subject: string;
  body: string;
  orderHint: string | null;
}

export interface AgentRunSummary {
  runId: string;
  mode: 'LLM' | 'HEURISTIC';
  startedAt: string;
  outcomes: {
    messageId: string;
    mode: string;
    action: string;
    thought: string;
    reply: string;
    error: string | null;
    proposal: {
      caseId: string;
      decision: string;
      executionState: string;
      refundId: string | null;
      reasonCodes: string[];
      violations: string[];
      injectionSuspected: boolean;
      amount: number;
      currency: string;
    } | null;
  }[];
}

export interface SuretyEventWire {
  id: number;
  at: string;
  type: string;
  runId: string | null;
  payload: Record<string, unknown>;
}

export interface WebhookEventRow {
  event_id: string;
  event_type: string;
  resource_id: string | null;
  verification: string;
  received_at: string;
}

export interface PolicyConfigWire {
  currencies: {
    currency: string;
    maxAutonomousRefundAmount: number;
    customerDailyLimit: number;
    merchantDailyLimit: number;
  }[];
  alwaysRequireApproval: boolean;
  allowedActionTypes: string[];
  version: string;
}
