import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getTimeline, proxiedImageUrl } from "../api";

function subjectRouteFromUrl(url: string | null) {
  if (!url) {
    return null;
  }
  const patterns: Array<[RegExp, string]> = [
    [/movie\.douban\.com\/subject\/(\d+)/, "movie"],
    [/music\.douban\.com\/subject\/(\d+)/, "music"],
    [/book\.douban\.com\/subject\/(\d+)/, "book"],
    [/douban\.com\/game\/(\d+)/, "game"]
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
      <span>{"★".repeat(5 - score)}</span>
      <em>{rating.toFixed(1)}</em>
    </span>
  );
}

export function TimelinePage() {
  const timelineQuery = useQuery({
    queryKey: ["timeline", "following"],
    queryFn: () => getTimeline("following"),
    retry: 1
  });

  return (
    <div className="page timeline-page">
      <section className="page-header">
        <p className="eyebrow">动态</p>
        <h1>豆瓣动态</h1>
        <p className="supporting">聚合自己和关注的人最近标记。</p>
      </section>

      {timelineQuery.data?.stale ? <p className="notice">实时抓取失败，当前显示最近一次缓存。</p> : null}
      {timelineQuery.error ? <p className="form-error">{timelineQuery.error.message}</p> : null}

      <div className="timeline-list">
        {timelineQuery.isFetching ? <p className="empty-state">正在读取豆瓣动态...</p> : null}
        {timelineQuery.data?.items.map((item) => {
          const authorAvatarUrl = proxiedImageUrl(item.authorAvatarUrl);
          const subjectCoverUrl = proxiedImageUrl(item.subjectCoverUrl);
          const content = splitTimelineContent(item.content);
          const subjectRoute = subjectRouteFromUrl(item.subjectUrl);
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
                {content.body && !item.subjectTitle ? <p className="timeline-card__content">{content.body}</p> : null}
                {item.subjectTitle || item.subjectUrl ? (
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
              </div>
            </article>
          );
        })}
        {!timelineQuery.isFetching && timelineQuery.data?.items.length === 0 ? <p className="empty-state">暂时没有解析到动态内容。</p> : null}
      </div>
    </div>
  );
}
