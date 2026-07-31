import { serverApiFetch } from '@/lib/server-api';
import Link from 'next/link';
import { BoardRoomActions } from '@/components/board-room-actions';
import { ProductStudioActions } from '@/components/product-studio-actions';

interface BoardVote {
  id: string;
  agentRole: string;
  decision: string;
  confidence: number;
  output: { summary: string; reasons: string[] };
}
interface BoardVeto {
  id: string;
  agentRole: string;
  type: string;
  reason: string;
}
interface DecisionSummary {
  agreementSummary: string;
  disagreementSummary: string;
  vetoSummary: string;
  overallConfidence: number;
  recommendation: string;
}
interface BoardReview {
  id: string;
  status: string;
  blocked: boolean | null;
  meetsThreshold: boolean | null;
  votingResult: { weightedScore: number; approvalThreshold: number } | null;
  votes: BoardVote[];
  vetoes: BoardVeto[];
  decisionSummary: DecisionSummary | null;
  createdAt: string;
}
interface ProductSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

function decisionBadgeClass(decision: string) {
  if (decision === 'APPROVE') return 'vos-badge--ok';
  if (decision === 'REJECT') return 'vos-badge--danger';
  return 'vos-badge--mock';
}

function productBadgeClass(status: string) {
  if (status === 'QA_PASSED' || status === 'APPROVED') return 'vos-badge--ok';
  if (status === 'QA_FAILED' || status === 'REJECTED') return 'vos-badge--danger';
  return 'vos-badge--mock';
}

export default async function BoardRoomPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const [{ data }, { data: productData }] = await Promise.all([
    serverApiFetch<BoardReview[]>(`/venture-proposals/${proposalId}/board-reviews`),
    serverApiFetch<ProductSummary[]>(`/venture-proposals/${proposalId}/products`),
  ]);
  const reviews = data ?? [];
  const products = productData ?? [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link
          href="/dashboard/opportunities"
          style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}
        >
          ← Back to Opportunity Feed
        </Link>
        <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>Board Room</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, maxWidth: 720 }}>
          The 8 voting board agents (mock provider, Phase 3) review this venture proposal and vote.
          The Decision Synthesiser summarises the result -- it never votes or decides itself; only
          the founder&apos;s decision in the Approval Centre is authoritative.
        </p>
      </div>

      <div className="vos-card">
        <BoardRoomActions proposalId={proposalId} />
      </div>

      {reviews.length === 0 ? (
        <div className="vos-card">
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No board reviews yet. Click &quot;Run Board Review&quot; to start one.
          </p>
        </div>
      ) : (
        reviews.map((review) => (
          <div key={review.id} className="vos-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>
                Review from {new Date(review.createdAt).toLocaleString()}
              </h2>
              <span
                className={`vos-badge ${review.status === 'COMPLETED' ? 'vos-badge--ok' : review.status === 'FAILED' ? 'vos-badge--danger' : 'vos-badge--mock'}`}
              >
                {review.status}
              </span>
            </div>

            {review.votingResult && (
              <p style={{ fontSize: 14, marginTop: 8 }}>
                Weighted score: <strong>{review.votingResult.weightedScore}</strong> /{' '}
                {review.votingResult.approvalThreshold} threshold &nbsp;·&nbsp; Meets threshold:{' '}
                {review.meetsThreshold ? 'Yes' : 'No'} &nbsp;·&nbsp; Blocked:{' '}
                {review.blocked ? 'Yes' : 'No'}
              </p>
            )}

            {review.decisionSummary && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--vos-bg-elevated)',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>
                  Decision Synthesiser summary (informational only)
                </p>
                <p style={{ fontSize: 13, margin: '4px 0' }}>
                  {review.decisionSummary.agreementSummary}
                </p>
                <p style={{ fontSize: 13, margin: '4px 0' }}>
                  {review.decisionSummary.disagreementSummary}
                </p>
                <p style={{ fontSize: 13, margin: '4px 0' }}>
                  {review.decisionSummary.vetoSummary}
                </p>
                <p style={{ fontSize: 13, margin: '4px 0' }}>
                  Overall confidence: {review.decisionSummary.overallConfidence} &nbsp;·&nbsp;
                  Recommendation:{' '}
                  <span
                    className={`vos-badge ${decisionBadgeClass(review.decisionSummary.recommendation)}`}
                  >
                    {review.decisionSummary.recommendation}
                  </span>
                </p>
              </div>
            )}

            {review.vetoes.length > 0 && (
              <p className="vos-error" style={{ marginTop: 12 }}>
                Active vetoes:{' '}
                {review.vetoes.map((v) => `${v.agentRole} (${v.type}): ${v.reason}`).join(' | ')}
              </p>
            )}

            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                  <th style={{ padding: '8px 0' }}>Agent</th>
                  <th>Decision</th>
                  <th>Confidence</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {review.votes.map((vote) => (
                  <tr key={vote.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                    <td style={{ padding: '8px 0' }}>{vote.agentRole.replaceAll('_', ' ')}</td>
                    <td>
                      <span className={`vos-badge ${decisionBadgeClass(vote.decision)}`}>
                        {vote.decision}
                      </span>
                    </td>
                    <td>{vote.confidence}</td>
                    <td style={{ maxWidth: 400 }}>{vote.output.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Product Studio</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', marginTop: 0, maxWidth: 720 }}>
          Once the founder has approved this venture proposal above, start product generation.
          Generation, QA checks, mock Etsy listing generation, and SEO evaluation all run inside a
          single durable workflow -- the result (including the second founder approval request) is
          shown on the product page below.
        </p>
        <ProductStudioActions proposalId={proposalId} />

        {products.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, marginTop: 16 }}>
            No products generated yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Product</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>{product.title}</td>
                  <td>
                    <span className={`vos-badge ${productBadgeClass(product.status)}`}>
                      {product.status}
                    </span>
                  </td>
                  <td>{new Date(product.createdAt).toLocaleString()}</td>
                  <td>
                    <a
                      href={`/dashboard/products/${product.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      View →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vos-card">
        <p style={{ fontSize: 14 }}>
          <Link href="/dashboard/approvals" style={{ color: 'var(--vos-accent)' }}>
            View pending approvals in the Approval Centre →
          </Link>
        </p>
      </div>
    </div>
  );
}
