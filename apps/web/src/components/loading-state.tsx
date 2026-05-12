interface LoadingInlineProps {
  label: string;
  tone?: "default" | "soft";
  className?: string;
}

export function LoadingInline({ label, tone = "default", className }: LoadingInlineProps) {
  return (
    <span className={["loading-inline", tone === "soft" ? "is-soft" : "", className ?? ""].filter(Boolean).join(" ")}>
      <span className="loading-inline__orb" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function LoadingButtonLabel({ label }: { label: string }) {
  return (
    <span className="loading-button-label">
      <span className="loading-inline__orb" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function SkeletonLine({ width = "100%", size = "md" }: { width?: string; size?: "sm" | "md" | "lg" }) {
  return <span className={`skeleton-line skeleton-line--${size}`} style={{ width }} aria-hidden="true" />;
}

export function SubjectCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <article className="subject-card subject-card--skeleton" key={`subject-skeleton-${index}`} aria-hidden="true">
          <div className="subject-card__cover skeleton-block" />
          <div className="subject-card__body skeleton-stack">
            <div className="subject-card__header skeleton-header">
              <SkeletonLine width="68%" size="lg" />
              <SkeletonLine width="18%" size="sm" />
            </div>
            <SkeletonLine width="82%" />
            <SkeletonLine width="58%" />
            <div className="subject-card__tags">
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
              <span className="skeleton-pill skeleton-pill--short" />
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

export function TimelineSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <article className="timeline-card timeline-card--skeleton" key={`timeline-skeleton-${index}`} aria-hidden="true">
          <div className="timeline-card__avatar skeleton-avatar" />
          <div className="timeline-card__body skeleton-stack">
            <div className="timeline-card__header">
              <div className="skeleton-stack">
                <SkeletonLine width="132px" size="md" />
                <SkeletonLine width="86px" size="sm" />
              </div>
              <SkeletonLine width="54px" size="sm" />
            </div>
            <SkeletonLine width="94%" />
            <SkeletonLine width="72%" />
            <div className="timeline-photos timeline-photos--skeleton">
              <span className="skeleton-block" />
              <span className="skeleton-block" />
              <span className="skeleton-block" />
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

export function CommentSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="comment-list-lite">
      {Array.from({ length: count }).map((_, index) => (
        <article className="comment-card comment-card--skeleton" key={`comment-skeleton-${index}`} aria-hidden="true">
          <div className="comment-card__meta">
            <span className="comment-card__avatar skeleton-avatar skeleton-avatar--sm" />
            <div className="skeleton-stack">
              <SkeletonLine width="84px" size="md" />
              <SkeletonLine width="56px" size="sm" />
            </div>
          </div>
          <div className="skeleton-stack">
            <SkeletonLine width="96%" />
            <SkeletonLine width="88%" />
            <SkeletonLine width="52%" />
          </div>
        </article>
      ))}
    </div>
  );
}

export function PanelLoading({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="panel panel--loading" aria-busy="true">
      <div className="panel__header">
        <div className="skeleton-stack">
          <SkeletonLine width="144px" size="lg" />
          <SkeletonLine width="220px" />
        </div>
        <LoadingInline label={title} tone="soft" />
      </div>
      <p className="supporting">{detail}</p>
      <div className="skeleton-stack">
        <SkeletonLine width="100%" />
        <SkeletonLine width="82%" />
      </div>
    </section>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="page detail-page detail-page--loading" aria-busy="true">
      <div className="detail-hero detail-hero--skeleton">
        <div className="detail-hero__cover skeleton-block" />
        <div className="detail-hero__body skeleton-stack">
          <SkeletonLine width="72%" size="lg" />
          <SkeletonLine width="48%" />
          <SkeletonLine width="64%" />
        </div>
        <div className="detail-hero__actions detail-hero__actions--skeleton">
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
        </div>
      </div>
      <section className="detail-rating-panel detail-rating-panel--skeleton">
        <div className="detail-rating-card">
          <div className="skeleton-stack">
            <SkeletonLine width="92px" size="sm" />
            <SkeletonLine width="144px" size="lg" />
            <SkeletonLine width="96px" />
          </div>
          <div className="skeleton-stack">
            <SkeletonLine width="72px" size="sm" />
            <SkeletonLine width="128px" size="md" />
          </div>
        </div>
      </section>
      <section className="detail-section detail-summary-section">
        <div className="skeleton-stack">
          <SkeletonLine width="120px" size="lg" />
          <SkeletonLine width="100%" />
          <SkeletonLine width="94%" />
          <SkeletonLine width="68%" />
        </div>
      </section>
      <section className="detail-section comments-panel">
        <div className="comments-panel__header">
          <SkeletonLine width="90px" size="lg" />
          <LoadingInline label="载入中" tone="soft" />
        </div>
        <CommentSkeletonList count={4} />
      </section>
    </div>
  );
}
