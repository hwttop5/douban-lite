import { useQuery } from "@tanstack/react-query";
import { getTimeline, proxiedImageUrl } from "../api";

export function TimelinePage() {
  const timelineQuery = useQuery({
    queryKey: ["timeline", "following"],
    queryFn: () => getTimeline("following"),
    retry: 1
  });

  return (
    <div className="page">
      <section className="page-header">
        <p className="eyebrow">动态</p>
        <h1>豆瓣动态</h1>
      </section>

      {timelineQuery.data?.stale ? <p className="notice">实时抓取失败，当前显示最近一次缓存。</p> : null}
      {timelineQuery.error ? <p className="form-error">{timelineQuery.error.message}</p> : null}

      <div className="timeline-list">
        {timelineQuery.isFetching ? <p className="empty-state">正在读取豆瓣动态...</p> : null}
        {timelineQuery.data?.items.map((item) => {
          const authorAvatarUrl = proxiedImageUrl(item.authorAvatarUrl);
          const subjectCoverUrl = proxiedImageUrl(item.subjectCoverUrl);
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
                {item.content ? <p className="timeline-card__content">{item.content}</p> : null}
                {item.subjectTitle || item.subjectUrl ? (
                  <a className="timeline-subject" href={item.subjectUrl ?? "#"} target="_blank" rel="noreferrer">
                    {subjectCoverUrl ? <img src={subjectCoverUrl} alt="" /> : <span className="timeline-subject__placeholder">条目</span>}
                    <span>{item.subjectTitle ?? "关联条目"}</span>
                  </a>
                ) : null}
                {item.engagements.length > 0 ? (
                  <div className="timeline-card__engagements">
                    {item.engagements.map((engagement) => (
                      <span key={engagement.label}>
                        {engagement.count ?? ""} {engagement.label}
                      </span>
                    ))}
                  </div>
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
