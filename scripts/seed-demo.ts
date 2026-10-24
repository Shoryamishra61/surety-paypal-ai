// Seeds the demo database through the public API so the console
// has data to show: a full agent run over the adversarial inbox.
import 'dotenv/config';

const base = process.env.SEED_BASE_URL || 'http://127.0.0.1:3100';

async function main() {
  const config = (await (await fetch(`${base}/api/config`)).json()) as { csrf: string };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Surety-CSRF': config.csrf },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`${path}: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  };
  const run = await post('/api/agent/run', {
    ids: ['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005', 'msg-006', 'msg-007', 'msg-008', 'msg-009', 'msg-010', 'msg-011'],
  });
  const summary = run as { outcomes: { proposal: { decision: string; executionState: string } | null }[] };
  const decisions = summary.outcomes.map((o) => o.proposal?.decision ?? o.action);
  console.log('Agent run complete:', JSON.stringify(decisions));
  // Approve one review item so the queue shows both states over time.
  const review = summary.outcomes.find((o) => o.proposal?.decision === 'REVIEW');
  if (review) {
    // Deliberately leave it pending: the review queue should have work to show.
    console.log('Left one case in review for the demo queue.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
