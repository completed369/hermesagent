import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { MarketplaceActions } from '@/components/marketplace-actions';

interface AssetVersion {
  id: string;
  attempt: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  generatedAt: string;
}
interface ProductAsset {
  id: string;
  kind: string;
  label: string;
  versions: AssetVersion[];
}
interface QualityCheckResult {
  id: string;
  ruleId: string;
  result: string;
  message: string;
  severity: string;
}
interface QualityCheck {
  id: string;
  checkType: string;
  status: string;
  results: QualityCheckResult[];
}
interface LicenceRecord {
  id: string;
  productAssetVersionId: string;
  licenceType: string;
  termsSummary: string;
  attribution: string | null;
}
interface ProductBrief {
  productType: string;
  targetAssetKinds: string[];
}
interface ProductVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
  brief: ProductBrief | null;
  assets: ProductAsset[];
  qualityChecks: QualityCheck[];
  licenceRecords: LicenceRecord[];
}
interface ListingImage {
  id: string;
  position: number;
  altText: string | null;
  productAssetVersionId: string;
}
interface ListingFile {
  id: string;
  displayName: string;
  productAssetVersionId: string;
}
interface PriceProposal {
  id: string;
  priceEur: string;
  rationale: string;
  createdAt: string;
}
interface SeoCheck {
  ruleId: string;
  result: string;
  message: string;
}
interface SeoEvaluation {
  id: string;
  score: number;
  checks: SeoCheck[];
  evaluatedAt: string;
}
interface PublicationAttempt {
  id: string;
  marketplace: string;
  status: string;
  blockedReason: string | null;
  attemptedAt: string;
}
interface ListingVersion {
  id: string;
  versionNumber: number;
  title: string;
  description: string;
  tags: string[];
  category: string;
  currency: string;
  priceEur: string;
  images: ListingImage[];
  files: ListingFile[];
  priceProposals: PriceProposal[];
  seoEvaluations: SeoEvaluation[];
  publicationAttempts: PublicationAttempt[];
}
interface Listing {
  id: string;
  marketplace: string;
  status: string;
  versions: ListingVersion[];
}
interface ProductDetail {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  versions: ProductVersion[];
  listings: Listing[];
}

interface MarketplaceAccountSummary {
  mode: string;
  marketplace: string;
}
interface MarketplacePublicationAttempt {
  id: string;
  status: string;
  blockedReason: string | null;
  errorMessage: string | null;
  attemptedAt: string;
  completedAt: string | null;
  externalListingId: string | null;
  externalListingUrl: string | null;
  marketplaceAccount: MarketplaceAccountSummary | null;
}
interface ApprovalDecisionSummary {
  decision: string;
  decidedAt: string;
  founderIdentity: string;
}
interface PublicationApprovalRequest {
  id: string;
  state: string;
  requestedAction: string;
  expiresAt: string;
  decisions: ApprovalDecisionSummary[];
}
interface MarketplaceStatus {
  publicationAttempts: MarketplacePublicationAttempt[];
  approvalRequests: PublicationApprovalRequest[];
}

function statusBadgeClass(status: string) {
  if (['PASSED', 'QA_PASSED', 'APPROVED', 'PASS'].includes(status)) return 'vos-badge--ok';
  if (['FAILED', 'QA_FAILED', 'REJECTED', 'FAIL'].includes(status)) return 'vos-badge--danger';
  return 'vos-badge--mock';
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, status } = await serverApiFetch<ProductDetail>(`/products/${id}`);
  if (status === 404 || !data) {
    notFound();
  }
  const product = data;
  const latestVersion = product.versions[0];

  // Phase 6: fetch marketplace publication status for each listing's latest
  // version -- a separate call to the new /marketplace/listings/:id
  // endpoint rather than folding this onto /products/:id, since it's a
  // distinct module (@ventureos/marketplace-connectors) with its own
  // permission (marketplace:view).
  const marketplaceStatusByListingVersionId = new Map<string, MarketplaceStatus>();
  await Promise.all(
    product.listings.map(async (listing) => {
      const lv = listing.versions[0];
      if (!lv) return;
      const { data: marketplaceStatus } = await serverApiFetch<MarketplaceStatus>(
        `/marketplace/listings/${lv.id}`,
      );
      if (marketplaceStatus) {
        marketplaceStatusByListingVersionId.set(lv.id, marketplaceStatus);
      }
    }),
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/dashboard/board-room" style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          ← Back to Board Room
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 4px' }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{product.title}</h1>
          <span className={`vos-badge ${statusBadgeClass(product.status)}`}>{product.status}</span>
        </div>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13 }}>
          Created {new Date(product.createdAt).toLocaleString()}
        </p>
      </div>

      {!latestVersion ? (
        <div className="vos-card">
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No product version generated yet.
          </p>
        </div>
      ) : (
        <>
          <div className="vos-card">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>
              Version {latestVersion.versionNumber} — Assets
            </h2>
            {latestVersion.brief && (
              <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
                <strong>Product type:</strong> {latestVersion.brief.productType} &nbsp;·&nbsp;
                <strong>Target kinds:</strong> {latestVersion.brief.targetAssetKinds.join(', ')}
              </p>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                  <th style={{ padding: '8px 0' }}>Kind</th>
                  <th>Label</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Content hash</th>
                </tr>
              </thead>
              <tbody>
                {latestVersion.assets.map((asset) => {
                  const v = asset.versions[0];
                  return (
                    <tr key={asset.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                      <td style={{ padding: '8px 0' }}>{asset.kind}</td>
                      <td>{asset.label}</td>
                      <td>{v?.fileName ?? '—'}</td>
                      <td>{v ? `${v.sizeBytes} B` : '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {v ? `${v.contentHash.slice(0, 12)}...` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="vos-card">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Quality checks</h2>
            {latestVersion.qualityChecks.length === 0 ? (
              <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
                QA has not run for this version yet.
              </p>
            ) : (
              latestVersion.qualityChecks.map((qc) => (
                <div key={qc.id} style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>
                    {qc.checkType.replaceAll('_', ' ')}{' '}
                    <span className={`vos-badge ${statusBadgeClass(qc.status)}`}>{qc.status}</span>
                  </p>
                  <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                    {qc.results.map((r) => (
                      <li
                        key={r.id}
                        style={{
                          color:
                            r.result === 'FAIL'
                              ? 'var(--vos-danger)'
                              : r.result === 'WARN'
                                ? 'var(--vos-text-muted)'
                                : undefined,
                        }}
                      >
                        [{r.result}] {r.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className="vos-card">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Licence records</h2>
            {latestVersion.licenceRecords.length === 0 ? (
              <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
                No licence records yet.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                    <th style={{ padding: '8px 0' }}>Type</th>
                    <th>Terms summary</th>
                    <th>Attribution</th>
                  </tr>
                </thead>
                <tbody>
                  {latestVersion.licenceRecords.map((lr) => (
                    <tr key={lr.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                      <td style={{ padding: '8px 0' }}>{lr.licenceType}</td>
                      <td>{lr.termsSummary}</td>
                      <td>{lr.attribution ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Listing Studio</h2>
        {product.listings.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No listing yet — the listing is only generated automatically once QA passes.
          </p>
        ) : (
          product.listings.map((listing) => {
            const lv = listing.versions[0];
            const seo = lv?.seoEvaluations[0];
            const pub = lv?.publicationAttempts[0];
            return (
              <div key={listing.id} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {listing.marketplace} listing
                  </p>
                  <span className={`vos-badge ${statusBadgeClass(listing.status)}`}>
                    {listing.status}
                  </span>
                </div>
                {lv && (
                  <>
                    <p style={{ fontSize: 14, marginTop: 8 }}>
                      <strong>{lv.title}</strong>
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>{lv.description}</p>
                    <p style={{ fontSize: 13 }}>
                      <strong>Tags:</strong> {lv.tags.join(', ') || '—'} &nbsp;·&nbsp;
                      <strong>Category:</strong> {lv.category} &nbsp;·&nbsp;
                      <strong>Price:</strong> {lv.currency} {lv.priceEur}
                    </p>
                    <p style={{ fontSize: 13 }}>
                      <strong>Images:</strong> {lv.images.length} &nbsp;·&nbsp;
                      <strong>Files:</strong> {lv.files.map((f) => f.displayName).join(', ') || '—'}
                    </p>
                    {lv.priceProposals[0] && (
                      <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
                        <strong>Price rationale:</strong> {lv.priceProposals[0].rationale}
                      </p>
                    )}
                    {seo && (
                      <div style={{ marginTop: 8 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>
                          SEO score: {seo.score}/100
                        </p>
                        <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
                          {seo.checks.map((c, i) => (
                            <li
                              key={i}
                              style={{
                                color:
                                  c.result === 'FAIL'
                                    ? 'var(--vos-danger)'
                                    : c.result === 'WARN'
                                      ? 'var(--vos-text-muted)'
                                      : undefined,
                              }}
                            >
                              [{c.result}] {c.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pub && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          borderRadius: 8,
                          background: 'var(--vos-bg-elevated)',
                        }}
                      >
                        <p style={{ fontSize: 13, margin: 0 }}>
                          <strong>Publication attempt:</strong>{' '}
                          <span className={`vos-badge ${statusBadgeClass(pub.status)}`}>
                            {pub.status}
                          </span>
                        </p>
                        {pub.blockedReason && (
                          <p
                            style={{
                              fontSize: 12,
                              color: 'var(--vos-text-muted)',
                              margin: '6px 0 0',
                            }}
                          >
                            {pub.blockedReason}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {product.listings.map((listing) => {
        const lv = listing.versions[0];
        if (!lv) return null;
        const marketplaceStatus = marketplaceStatusByListingVersionId.get(lv.id);
        const mode = marketplaceStatus?.publicationAttempts.find((a) => a.marketplaceAccount)
          ?.marketplaceAccount?.mode;
        const latestPublished = marketplaceStatus?.publicationAttempts.find(
          (a) => a.status === 'PUBLISHED',
        );
        return (
          <div key={`marketplace-${listing.id}`} className="vos-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>
                Marketplace Publication ({listing.marketplace})
              </h2>
              <span className="vos-badge vos-badge--mock">{mode ?? 'not started'}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', marginTop: 4 }}>
              Founder decision recorded 2026-07-14: mock-only for Phase 6 -- no real Etsy account is
              connected, so every draft/publish action here is simulated by the mock adapter, never
              a live network call.
            </p>

            {latestPublished?.externalListingUrl && (
              <p
                style={{
                  fontSize: 13,
                  margin: '8px 0',
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--vos-bg-elevated)',
                }}
              >
                <strong>Published (mock):</strong>{' '}
                <span style={{ fontFamily: 'monospace' }}>
                  {latestPublished.externalListingUrl}
                </span>
              </p>
            )}

            <div style={{ marginTop: 12 }}>
              <MarketplaceActions listingVersionId={lv.id} />
            </div>

            {marketplaceStatus && marketplaceStatus.publicationAttempts.length > 0 && (
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                    <th style={{ padding: '8px 0' }}>Attempted</th>
                    <th>Status</th>
                    <th>External listing</th>
                    <th>Blocked / error</th>
                  </tr>
                </thead>
                <tbody>
                  {marketplaceStatus.publicationAttempts.map((attempt) => (
                    <tr key={attempt.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                      <td style={{ padding: '8px 0' }}>
                        {new Date(attempt.attemptedAt).toLocaleString()}
                      </td>
                      <td>
                        <span className={`vos-badge ${statusBadgeClass(attempt.status)}`}>
                          {attempt.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {attempt.externalListingId ?? '—'}
                      </td>
                      <td>{attempt.blockedReason ?? attempt.errorMessage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {marketplaceStatus && marketplaceStatus.approvalRequests.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>
                  PUBLICATION approval (second, distinct gate from the earlier product/listing
                  approval)
                </p>
                {marketplaceStatus.approvalRequests.map((req) => (
                  <p key={req.id} style={{ fontSize: 13, margin: '4px 0' }}>
                    <span className={`vos-badge ${statusBadgeClass(req.state)}`}>{req.state}</span>{' '}
                    {req.requestedAction}
                    {req.decisions[0] && (
                      <span style={{ color: 'var(--vos-text-muted)' }}>
                        {' '}
                        — decided {req.decisions[0].decision} by {req.decisions[0].founderIdentity}{' '}
                        at {new Date(req.decisions[0].decidedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                ))}
                <p style={{ fontSize: 13 }}>
                  <Link href="/dashboard/approvals" style={{ color: 'var(--vos-accent)' }}>
                    Decide in the Approval Centre →
                  </Link>
                </p>
              </div>
            )}
          </div>
        );
      })}

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
