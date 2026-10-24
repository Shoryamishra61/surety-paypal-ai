import { ApprovalEngine } from '../src/core/approval-engine';
import { SuretyDatabase } from '../src/db/database';
process.send?.('ready');
process.once('message', (input: any) => {
  const db = new SuretyDatabase(input.file);
  try {
    const result = new ApprovalEngine(db).validateAndConsume(
      input.approvalId,
      input.action,
      input.claim,
      input.evidence,
      'test-policy',
    );
    process.send?.({ valid: result.valid });
  } finally {
    db.close();
    process.disconnect?.();
  }
});
