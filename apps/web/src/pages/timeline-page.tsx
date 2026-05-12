import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getAuthMe, getTimeline, proxiedImageUrl } from "../api";
import { LoadingInline, TimelineSkeletonList } from "../components/loading-state";
import { useAutoLoadMore } from "../hooks/use-auto-load-more";

function subjectRouteFromUrl(url: string | null) {
  if (!url) {
    return null;
  }
  const patterns: Array<[RegExp, string]> = [
    [/movie\.douban\.com\/subject\/(\d+)/, "movie"],
    [/music\.douban\.com\/subject\/(\d+)/, "music"],
    [/book\.douban\.com\/subject\/(\d+)/, "book"],
    [/(?:www\.)?douban\.com\/(?:\?[^#]*?\/)?game\/(?:subject\/)?(\d+)/, "game"],
    [/(?:www\.)?douban\.com\/game\/(?:subject\/)?(\d+)/, "game"],
    [/game\.douban\.com\/subject\/(\d+)/, "game"]
  ];
  for (const [pattern, medium] of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return `/subject/${medium}/${match[1]}`;
    }
  }
  return null;
}

function splitTimelineContent(content: string | null) {
  if (!content) {
    return { rating: null, body: null };
  }
  const match = content.match(/^(\d(?:\.\d)?)\s+(.+)$/);
  if (!match) {
    return { rating: null, body: content };
  }
  return { rating: Number(match[1]), body: match[2] };
}

function renderStars(rating: number | null) {
  if (!rating) {
    return null;
  }
  const score = Math.max(1, Math.min(5, Math.round(rating / 2)));
  return (
    <span className="douban-stars timeline-subject__stars" aria-label={`${score} 星`}>
      <span>{"★".repeat(score)}</span>
      <span>{"☆".repeat(5 - score)}</span>
      <em>{rating.toFixed(1)}</em>
    </span>
  );
}

function renderEngagements(engagements: Array<{ label: "回应" | "转发" | "赞"; count: number | null }>) {
  if (engagements.length === 0) {
    return null;
  }
  const counts = new Map(engagements.map((item) => [item.label, item.count]));
  const orderedLabels: Array<{ key: "赞" | "回应" | "转发"; text: string }> = [
    { key: "赞", text: "赞" },
    { key: "回应", text: "回复" },
    { key: "转发", text: "转发" }
  ];
  return (
    <p className="timeline-card__engagements">
      {orderedLabels.map(({ key, text }) => (
        <span key={key}>
          {text} ({counts.get(key) ?? 0})
        </span>
      ))}
    </p>
  );
}

export function TimelinePage() {
  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });
  const hasSession = authQuery.data?.authenticated && authQuery.data?.sessionStatus.status === "valid";

  const timelineQuery = useInfiniteQuery({
    queryKey: ["timeline", "following"],
    queryFn: ({ pageParam }) => getTimeline("following", pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore && lastPage.nextStart != null ? lastPage.nextStart : undefined),
    enabled: Boolean(hasSession),
    retry: 1
  });

  const firstPage = timelineQuery.data?.pages[0];
  const items = timelineQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const showTimelineSkeleton = timelineQuery.isFetching && items.length === 0;
  const showTimelineRefreshHint = timelineQuery.isFetchingNextPage;
  const autoLoadMoreRef = useAutoLoadMore({
    enabled: Boolean(hasSession),
    hasMore: Boolean(timelineQuery.hasNextPage),
    isLoading: timelineQuery.isFetchingNextPage,
    onLoadMore: () => {
      void timelineQuery.fetchNextPage();
    }
  });

  return (
    <div className="page timeline-page">
      <section className="page-header">
        <p className="eyebrow">动态</p>
        <h1>豆瓣动态</h1>
        <p className="supporting">聚合自己和关注的人的最近标记。</p>
      </section>

      {firstPage?.stale ? <p className="notice">实时抓取失败，当前显示最近一次缓存。</p> : null}
      {!hasSession ? (
        <section className="timeline-state-panel" role="status">
          <strong>登录后查看动态</strong>
          <p className="supporting">动态页按用户隔离，需要先导入你的豆瓣 Cookie。</p>
        </section>
      ) : timelineQuery.error ? (
        <section className="timeline-state-panel" role="status">
          <strong>动态暂时不可用</strong>
          <p className="supporting">请确认豆瓣 Cookie 已导入且本地 API 正常运行，稍后重试动态页。</p>
          <p className="form-error">{timelineQuery.error.message}</p>
        </section>
      ) : null}

      <div className="timeline-list">
        {showTimelineSkeleton ? <TimelineSkeletonList count={4} /> : null}
        {items.map((item) => {
          const authorAvatarUrl = proxiedImageUrl(item.authorAvatarUrl);
          const subjectCoverUrl = proxiedImageUrl(item.subjectCoverUrl);
          const photoUrls = (item.photoUrls ?? []).map((url) => proxiedImageUrl(url) ?? url);
          const content = splitTimelineContent(item.content);
          const subjectRoute = subjectRouteFromUrl(item.subjectUrl);
          const hasLinkedSubject = Boolean(item.subjectTitle || item.subjectUrl);
          const hasPhotoPost = !hasLinkedSubject && photoUrls.length > 0;
          const subjectContent = (
            <>
              {subjectCoverUrl ? <img src={subjectCoverUrl} alt="" /> : <span className="timeline-subject__placeholder">条目</span>}
              <span className="timeline-subject__body">
                <strong>{item.subjectTitle ?? "关联条目"}</strong>
                {renderStars(content.rating)}
                {content.body ? <span>{content.body}</span> : null}
              </span>
            </>
          );

          return (
            <article className="timeline-card" key={item.id}>
              <div className="timeline-card__avatar">
                {authorAvatarUrl ? <img src={authorAvatarUrl} alt="" /> : <span>{item.authorName?.slice(0, 1) ?? "豆"}</span>}
              </div>
              <div className="timeline-card__body">
                <div className="timeline-card__header">
                  <div>
                    <strong>{item.authorName ?? "豆瓣用户"}</strong>
                    {item.actionText ? <p>{item.actionText}</p> : null}
                  </div>
                  {item.createdAtText ? <span>{item.createdAtText}</span> : null}
                </div>

                {content.body && !hasLinkedSubject ? <p className="timeline-card__content">{content.body}</p> : null}

                {hasPhotoPost ? (
                  <div className="timeline-photos">
                    {photoUrls.map((url, index) => (
                      <a
                        className="timeline-photos__item"
                        href={item.detailUrl ?? url}
                        target="_blank"
                        rel="noreferrer"
                        key={`${item.id}-photo-${index}`}
                      >
                        <img src={url} alt="" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {hasLinkedSubject ? (
                  subjectRoute ? (
                    <Link className="timeline-subject" to={subjectRoute}>
                      {subjectContent}
                    </Link>
                  ) : (
                    <a className="timeline-subject" href={item.subjectUrl ?? "#"} target="_blank" rel="noreferrer">
                      {subjectContent}
                    </a>
                  )
                ) : null}

                {renderEngagements(item.engagements)}
              </div>
            </article>
          );
        })}
        {!showTimelineSkeleton && !timelineQuery.isFetching && items.length === 0 ? <p className="empty-state">暂时没有解析到动态内容。</p> : null}
      </div>

      {timelineQuery.hasNextPage ? <div ref={autoLoadMoreRef} className="auto-load-sentinel" aria-hidden="true" /> : null}
      {showTimelineRefreshHint ? <p className="auto-load-status"><LoadingInline label="正在展开更多动态" tone="soft" /></p> : null}
      {!timelineQuery.hasNextPage && !timelineQuery.isFetching && items.length > 0 ? <p className="empty-state">没有更多动态了。</p> : null}
    </div>
  );
}
