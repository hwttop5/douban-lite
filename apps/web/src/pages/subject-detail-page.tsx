import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ShelfStatus, SubjectComment, SubjectDetailResponse, SubjectMediaItem, SubjectSectionLink, UpdateLibraryStateInput } from "../../../../packages/shared/src";
import { mediumLabels, mediumSchema, statusLabels } from "../../../../packages/shared/src";
import { getAuthMe, getSubjectComments, getSubjectDetail, proxiedImageUrl, updateLibraryState, voteSubjectComment } from "../api";
import { CommentSkeletonList, DetailPageSkeleton, LoadingButtonLabel, LoadingInline } from "../components/loading-state";
import { SubjectCard } from "../components/subject-card";
import { useAutoLoadMore } from "../hooks/use-auto-load-more";

const tagSuggestions = ["温情", "治愈", "经典", "想再看", "剧情", "家庭", "冒险", "音乐", "文学", "独立", "动作", "怀旧"];

interface MarkDialogState {
  status: ShelfStatus;
  rating: number | null;
  comment: string;
  tags: string[];
  syncToTimeline: boolean;
}

function ratingLabelToScore(label: string | null) {
  if (!label) {
    return null;
  }
  const scores: Record<string, number> = {
    力荐: 5,
    推荐: 4,
    还行: 3,
    较差: 2,
    很差: 1
  };
  return scores[label] ?? null;
}

function renderStars(score: number | null) {
  if (!score) {
    return null;
  }
  const normalized = Math.max(1, Math.min(5, Math.round(score)));
  return (
    <span className="douban-stars" aria-label={`${normalized} 星`}>
      <span>{"★".repeat(normalized)}</span>
      <span>{"★".repeat(5 - normalized)}</span>
    </span>
  );
}

function scoreFromAverage(average: number | null) {
  return average ? Math.round(average / 2) : null;
}

function sectionLinkMap(links: SubjectSectionLink[] | undefined) {
  return new Map((links ?? []).map((item) => [item.key, item]));
}

function detailSectionTitle(medium: ReturnType<typeof mediumSchema.parse>) {
  if (medium === "music") {
    return "曲目";
  }
  if (medium === "book") {
    return "目录";
  }
  return "内容扩展";
}

function relatedTitle(medium: ReturnType<typeof mediumSchema.parse>) {
  if (medium === "movie") {
    return "喜欢这部电影的人也喜欢";
  }
  if (medium === "music") {
    return "喜欢听此专辑的人也喜欢";
  }
  if (medium === "book") {
    return "喜欢读此书的人也喜欢";
  }
  return "喜欢此游戏的人也喜欢";
}

function renderMediaLabel(item: SubjectMediaItem) {
  return item.type === "video" ? "视频" : "图片";
}

function myRatingSummary(medium: ReturnType<typeof mediumSchema.parse>, item: NonNullable<ReturnType<typeof getVisibleUserItem>>) {
  return `${statusLabels[medium][item.status]}${item.rating ? ` · ${item.rating} 星` : ""}`;
}

function metadataValue(subject: SubjectDetailResponse["subject"], key: string) {
  const value = subject.metadata[key];
  if (Array.isArray(value)) {
    return value.join(" / ");
  }
  return typeof value === "string" ? value : null;
}

function buildRelatedMeta(subject: SubjectDetailResponse["subject"]) {
  const values = [
    subject.averageRating ? `豆瓣 ${subject.averageRating.toFixed(1)}` : "暂无豆瓣评分",
    subject.year ? subject.year.replace(/[()]/g, "") : null,
    metadataValue(subject, "类型"),
    metadataValue(subject, "平台")
  ].filter((value): value is string => Boolean(value));
  return values.slice(0, 4);
}

function buildRelatedHighlights(subject: SubjectDetailResponse["subject"]) {
  const values = [metadataValue(subject, "开发商"), metadataValue(subject, "发行商"), metadataValue(subject, "发行日期")]
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  return values;
}

function getVisibleUserItem(userItem: SubjectDetailResponse["userItem"], hasDoubanSession: boolean) {
  return hasDoubanSession ? userItem : null;
}

export function SubjectDetailPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [markDialog, setMarkDialog] = useState<MarkDialogState | null>(null);
  const medium = mediumSchema.parse(params.medium);
  const doubanId = params.doubanId!;
  const from = typeof location.state === "object" && location.state && "from" in location.state ? location.state.from : null;
  const handleBack = () => {
    if (from === "/rankings" || from === "/search" || from === "/me") {
      navigate(from);
      return;
    }
    navigate(-1);
  };

  const detailQuery = useQuery({
    queryKey: ["subject", medium, doubanId],
    queryFn: () => getSubjectDetail(medium, doubanId)
  });
  const sessionQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });

  const commentsQuery = useQuery({
    queryKey: ["subject-comments", medium, doubanId, 0],
    queryFn: () => getSubjectComments(medium, doubanId, 0, 20),
    enabled: Boolean(detailQuery.data),
    retry: 1
  });

  const loadMoreMutation = useMutation({
    mutationFn: (start: number) => getSubjectComments(medium, doubanId, start, 20),
    onSuccess: (data) => {
      queryClient.setQueryData(["subject-comments", medium, doubanId, 0], (current: typeof data | undefined) => {
        if (!current) {
          return data;
        }
        const seen = new Set(current.items.map((item) => item.id ?? item.content));
        const nextItems = data.items.filter((item) => !seen.has(item.id ?? item.content));
        return {
          ...data,
          items: [...current.items, ...nextItems]
        };
      });
    }
  });

  const voteMutation = useMutation({
    mutationFn: (commentId: string) => voteSubjectComment(medium, doubanId, commentId),
    onSuccess: (result) => {
      const applyVote = (items: SubjectComment[]) =>
        items.map((comment) =>
          comment.id === result.commentId ? { ...comment, votes: result.votes, userVoteState: result.userVoteState } : comment
        );
      queryClient.setQueryData(["subject", medium, doubanId], (current: SubjectDetailResponse | undefined) =>
        current
          ? {
              ...current,
              comments: applyVote(current.comments)
            }
          : current
      );
      queryClient.setQueryData(
        ["subject-comments", medium, doubanId, 0],
        (current: { items: SubjectComment[]; start: number; nextStart: number | null; hasMore: boolean } | undefined) =>
          current
            ? {
                ...current,
                items: applyVote(current.items)
              }
            : current
      );
    }
  });

  const mutation = useMutation({
    mutationFn: (input: UpdateLibraryStateInput) => updateLibraryState(medium, doubanId, input),
    onSuccess: async () => {
      setMarkDialog(null);
      await queryClient.invalidateQueries({ queryKey: ["subject", medium, doubanId] });
      await queryClient.invalidateQueries({ queryKey: ["library", medium] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    }
  });

  const subject = detailQuery.data?.subject;
  const userItem = detailQuery.data?.userItem;
  const initialComments = detailQuery.data?.comments ?? [];
  const loadedComments = commentsQuery.data?.items ?? [];
  const comments: SubjectComment[] = loadedComments.length > 0 ? loadedComments : initialComments;
  const nextStart = commentsQuery.data?.nextStart ?? (comments.length > 0 ? comments.length : null);
  const hasMore = commentsQuery.data?.hasMore ?? comments.length > 0;
  const commentsAutoLoadRef = useAutoLoadMore({
    enabled: comments.length > 0 && nextStart != null,
    hasMore: hasMore && nextStart != null,
    isLoading: loadMoreMutation.isPending,
    onLoadMore: () => {
      if (nextStart != null) {
        loadMoreMutation.mutate(nextStart);
      }
    }
  });
  const coverUrl = proxiedImageUrl(subject?.coverUrl);
  const hasDoubanSession = Boolean(sessionQuery.data?.authenticated && sessionQuery.data?.sessionStatus.status === "valid");
  const sessionPending = sessionQuery.isPending;
  const showCommentSkeleton = commentsQuery.isFetching && comments.length === 0;
  const visibleUserItem = getVisibleUserItem(userItem ?? null, hasDoubanSession);
  const currentStatus = visibleUserItem?.status ?? "wish";
  const currentRating = visibleUserItem?.rating ?? null;
  const sectionLinks = sectionLinkMap(detailQuery.data?.sectionLinks);
  const staff = detailQuery.data?.staff ?? [];
  const media = detailQuery.data?.media ?? { videos: [], images: [] };
  const trackList = detailQuery.data?.trackList ?? [];
  const tableOfContents = detailQuery.data?.tableOfContents ?? [];
  const relatedSubjects = detailQuery.data?.relatedSubjects ?? [];
  const mediaItems = [...media.videos, ...media.images];
  const [visibleMediaCount, setVisibleMediaCount] = useState(6);
  const [visibleRelatedCount, setVisibleRelatedCount] = useState(4);
  const visibleMediaItems = mediaItems.slice(0, visibleMediaCount);
  const visibleRelatedSubjects = relatedSubjects.slice(0, visibleRelatedCount);
  const hasMoreMediaItems = visibleMediaCount < mediaItems.length;
  const hasMoreRelatedSubjects = visibleRelatedCount < relatedSubjects.length;
  const openMarkDialog = (input: { status: ShelfStatus; rating: number | null }) => {
    if (!hasDoubanSession) {
      setLoginMessage("请先登录豆瓣后再标记和评分。");
      return;
    }
    setLoginMessage(null);
    setMarkDialog({
      status: input.status,
      rating: input.rating,
      comment: visibleUserItem?.comment ?? "",
      tags: visibleUserItem?.tags ?? [],
      syncToTimeline: visibleUserItem?.syncToTimeline ?? true
    });
  };
  const updateMarkDialog = (partial: Partial<MarkDialogState>) => {
    setMarkDialog((current) => (current ? { ...current, ...partial } : current));
  };
  const toggleTag = (tag: string) => {
    setMarkDialog((current) => {
      if (!current) {
        return current;
      }
      const tags = current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag].slice(0, 6);
      return { ...current, tags };
    });
  };
  const submitMarkDialog = () => {
    if (!markDialog) {
      return;
    }
    mutation.mutate({
      status: markDialog.status,
      rating: markDialog.rating,
      comment: markDialog.comment.trim(),
      tags: markDialog.tags,
      syncToTimeline: markDialog.syncToTimeline
    });
  };
  const handleShare = async () => {
    if (!subject) {
      return;
    }
    const url = window.location.href;
    const shareData = {
      title: subject.title,
      text: subject.subtitle ? `${subject.title} - ${subject.subtitle}` : subject.title,
      url
    };
    try {
      if ("share" in navigator && typeof navigator.share === "function") {
        await navigator.share(shareData);
        setShareMessage("已打开分享");
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("链接已复制");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setShareMessage("分享失败");
    }
    window.setTimeout(() => setShareMessage(null), 1800);
  };

  if (detailQuery.isPending) {
    return <DetailPageSkeleton />;
  }

  if (detailQuery.error || !subject) {
    return (
      <div className="page">
        <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
          <span>‹</span>
        </button>
        <p className="form-error">{detailQuery.error?.message ?? "条目详情加载失败"}</p>
      </div>
    );
  }

  return (
    <div className="page detail-page">
      <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
        <span>‹</span>
      </button>
      <button className="detail-share-button" type="button" onClick={handleShare} aria-label="分享">
        <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none">
          <path d="M8.6 12.7 15.4 16.4" />
          <path d="M15.4 7.6 8.6 11.3" />
          <circle cx="6.4" cy="12" r="2.4" />
          <circle cx="17.6" cy="6.4" r="2.4" />
          <circle cx="17.6" cy="17.6" r="2.4" />
        </svg>
      </button>
      {shareMessage ? <span className="detail-share-toast">{shareMessage}</span> : null}
      <section className="detail-hero">
        <div className="detail-hero__cover">
          {coverUrl ? <img src={coverUrl} alt={subject.title} /> : <span>无封面</span>}
        </div>
        <div className="detail-hero__body">
          <h1>{subject.title}</h1>
          {subject.subtitle ? <p className="subject-card__subtitle">{subject.subtitle}</p> : null}
          <p className="subject-card__meta">
            {mediumLabels[medium]}
            {subject.year ? ` / ${subject.year.replace(/[()]/g, "")}` : ""}
            {subject.creators.length > 0 ? ` / ${subject.creators.join(" / ")}` : ""}
          </p>
        </div>
        <div className="detail-hero__actions" aria-label="收藏状态">
          {(Object.entries(statusLabels[medium]) as Array<[ShelfStatus, string]>).map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={mutation.isPending || sessionPending}
              className={`${value === currentStatus && visibleUserItem ? "detail-action is-active" : "detail-action"}${!hasDoubanSession && !sessionPending ? " is-disabled" : ""}`}
              onClick={() => openMarkDialog({ status: value, rating: currentRating })}
            >
              <span>{value === "wish" ? "⊕" : value === "doing" ? "⊙" : "☆"}</span>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="detail-rating-panel">
        <div className={currentRating == null ? "detail-rating-card detail-rating-card--public-only" : "detail-rating-card"}>
          <div>
            <span>豆瓣评分</span>
            <div className="detail-rating-card__score">
              <strong>{subject.averageRating ? subject.averageRating.toFixed(1) : "暂无"}</strong>
              {renderStars(scoreFromAverage(subject.averageRating))}
            </div>
            <p>{subject.averageRating ? "来自豆瓣公开评分" : "暂无公开评分"}</p>
          </div>
          <div className="detail-my-rating">
            <span>我的评分</span>
            <div className="detail-my-rating__stars" aria-label="我的评分">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={mutation.isPending || sessionPending}
                  className={currentRating != null && value <= currentRating ? "is-active" : ""}
                  onClick={() => openMarkDialog({ status: currentStatus, rating: value })}
                  aria-label={`${value} 星`}
                >
                  ★
                </button>
              ))}
            </div>
            {visibleUserItem ? (
              <div className="detail-my-rating__summary">
                <strong>{myRatingSummary(medium, visibleUserItem)}</strong>
                {visibleUserItem.tags.length > 0 ? <span>{visibleUserItem.tags.join(" · ")}</span> : null}
              </div>
            ) : (
              <p className="detail-my-rating__placeholder">登录后可以同步你的标记、评分和短评。</p>
            )}
            {visibleUserItem?.comment ? (
              <div className="detail-my-rating__comment">
                <span>我的短评</span>
                <p>{visibleUserItem.comment}</p>
              </div>
            ) : null}
          </div>
        </div>
        <p className="detail-current-state">
          当前：{visibleUserItem ? statusLabels[medium][visibleUserItem.status] : "未标记"}
          {visibleUserItem?.rating ? ` · ${visibleUserItem.rating} 星` : ""}
          {visibleUserItem?.syncState ? ` · ${visibleUserItem.syncState === "synced" ? "已同步" : visibleUserItem.syncState === "pending_push" ? "待写回" : "需处理"}` : ""}
        </p>
        {!hasDoubanSession && !sessionPending ? (
          <p className="notice">
            {loginMessage ?? "请先登录豆瓣后再标记和评分。"}
            <button className="notice-link" type="button" onClick={() => navigate("/settings")}>去登录</button>
          </p>
        ) : loginMessage ? (
          <p className="notice">{loginMessage}</p>
        ) : null}
        {mutation.error ? <p className="form-error">{mutation.error.message}</p> : null}
      </section>

      {subject.summary ? (
        <section className="detail-section detail-summary-section">
          <h2>剧情简介</h2>
          <p>{subject.summary}</p>
        </section>
      ) : null}

      {staff.length > 0 ? (
        <section className="detail-section">
          <div className="detail-section__header">
            <h2>职员</h2>
            {sectionLinks.get("staff") ? (
              <a href={sectionLinks.get("staff")!.url} target="_blank" rel="noreferrer" className="detail-section__link">
                查看全部
              </a>
            ) : null}
          </div>
          <div className="detail-staff-grid">
            {staff.map((member) => {
              const avatarUrl = proxiedImageUrl(member.avatarUrl);
              return (
                <a
                  key={`${member.name}-${member.role ?? ""}`}
                  className="detail-staff-card"
                  href={member.profileUrl ?? "#"}
                  target={member.profileUrl ? "_blank" : undefined}
                  rel={member.profileUrl ? "noreferrer" : undefined}
                >
                  <span className="detail-staff-card__avatar">
                    {avatarUrl ? <img src={avatarUrl} alt={member.name} loading="lazy" /> : <span>{member.name.slice(0, 1)}</span>}
                  </span>
                  <strong>{member.name}</strong>
                  {member.role ? <span>{member.role}</span> : null}
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      {trackList.length > 0 ? (
        <section className="detail-section">
          <div className="detail-section__header">
            <h2>{detailSectionTitle(medium)}</h2>
          </div>
          <ol className="detail-list detail-list--ordered">
            {trackList.map((track) => (
              <li key={track}>{track}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {tableOfContents.length > 0 ? (
        <section className="detail-section">
          <div className="detail-section__header">
            <h2>{detailSectionTitle(medium)}</h2>
          </div>
          <ul className="detail-list">
            {tableOfContents.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {media.videos.length > 0 || media.images.length > 0 ? (
        <section className="detail-section">
          <div className="detail-section__header">
            <h2>视频 / 图片</h2>
          </div>
          <div className="detail-media-grid">
            {visibleMediaItems.map((item) => {
              const thumbnailUrl = proxiedImageUrl(item.thumbnailUrl);
              return (
                <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="detail-media-card">
                  <span className="detail-media-card__thumb">
                    {thumbnailUrl ? <img src={thumbnailUrl} alt={item.title ?? renderMediaLabel(item)} loading="lazy" /> : <span>{renderMediaLabel(item)}</span>}
                  </span>
                  <span className="detail-media-card__meta">
                    <strong>{item.title ?? renderMediaLabel(item)}</strong>
                    <span>{renderMediaLabel(item)}</span>
                  </span>
                </a>
              );
            })}
          </div>
          {hasMoreMediaItems ? (
            <div className="detail-section__footer">
              <button type="button" className="detail-more-button" onClick={() => setVisibleMediaCount((count) => count + 6)}>
                查看更多
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {relatedSubjects.length > 0 ? (
        <section className="detail-section">
          <div className="detail-section__header">
            <h2>{relatedTitle(medium)}</h2>
          </div>
          <div className="detail-related-grid">
            {visibleRelatedSubjects.map((item) => (
              <SubjectCard
                key={`${item.medium}-${item.doubanId}`}
                medium={medium}
                subject={item}
                className="subject-card subject-card--related"
                extra={
                  <div className="subject-card__extra">
                    <div className="subject-card__meta-list">
                      {buildRelatedMeta(item).map((value) => (
                        <span key={value} className="subject-card__meta-chip">
                          {value}
                        </span>
                      ))}
                    </div>
                    {buildRelatedHighlights(item).length > 0 ? (
                      <div className="subject-card__facts">
                        {buildRelatedHighlights(item).map((value, index) => (
                          <p key={`${item.doubanId}-fact-${index}`}>{value}</p>
                        ))}
                      </div>
                    ) : item.summary ? (
                      <p className="subject-card__summary">{item.summary}</p>
                    ) : null}
                  </div>
                }
              />
            ))}
          </div>
          {hasMoreRelatedSubjects ? (
            <div className="detail-section__footer">
              <button type="button" className="detail-more-button" onClick={() => setVisibleRelatedCount((count) => count + 4)}>
                查看更多
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="detail-section comments-panel">
        <div className="comments-panel__header">
          <div>
            <h2>短评</h2>
          </div>
          {commentsQuery.isFetching ? <LoadingInline label="正在整理短评" tone="soft" /> : null}
        </div>
        {showCommentSkeleton ? (
          <CommentSkeletonList count={4} />
        ) : comments.length > 0 ? (
          <div className="comment-list-lite">
            {comments.map((comment, index) => (
              <article className="comment-card" key={comment.id ?? `${comment.author}-${index}`}>
                <div className="comment-card__meta">
                  {comment.authorAvatarUrl ? (
                    <img className="comment-card__avatar" src={proxiedImageUrl(comment.authorAvatarUrl) ?? comment.authorAvatarUrl} alt={comment.author ?? "豆瓣用户"} loading="lazy" />
                  ) : (
                    <span className="comment-card__avatar">{comment.author?.slice(0, 1) ?? "豆"}</span>
                  )}
                  <div className="comment-card__identity">
                    <strong>{comment.author ?? "豆瓣用户"}</strong>
                    <div className="comment-card__submeta">
                      {renderStars(ratingLabelToScore(comment.rating))}
                      {comment.platform ? <span className="comment-card__platform">{comment.platform}</span> : null}
                    </div>
                    {comment.createdAt ? <time>{comment.createdAt}</time> : null}
                  </div>
                </div>
                <p>{comment.content}</p>
                {comment.votes != null ? (
                  hasDoubanSession && comment.id ? (
                    <button
                      type="button"
                      className={`comment-card__votes comment-card__votes--button${comment.userVoteState === "voted" ? " is-active" : ""}`}
                      disabled={voteMutation.isPending}
                      onClick={() => voteMutation.mutate(comment.id!)}
                      aria-label={comment.userVoteState === "voted" ? "已投票" : "投票"}
                    >
                      {comment.userVoteState === "voted" ? "♥" : "♡"} {comment.votes}
                    </button>
                  ) : (
                    <span className="comment-card__votes">♡ {comment.votes}</span>
                  )
                ) : null}
              </article>
            ))}
          </div>
        ) : commentsQuery.error ? (
          <p className="form-error">{commentsQuery.error.message}</p>
        ) : (
          <p className="empty-state">暂时没有解析到公开短评。</p>
        )}
        {voteMutation.error ? <p className="form-error">{voteMutation.error.message}</p> : null}
        {loadMoreMutation.error ? <p className="form-error">{loadMoreMutation.error.message}</p> : null}
        {hasMore && nextStart != null ? <div ref={commentsAutoLoadRef} className="auto-load-sentinel" aria-hidden="true" /> : null}
        {loadMoreMutation.isPending ? <p className="auto-load-status"><LoadingInline label="正在补充更多短评" tone="soft" /></p> : null}
        {!hasMore && comments.length > 0 ? (
          <p className="empty-state">没有更多短评了。</p>
        ) : null}
      </section>
      {markDialog ? (
        <div className="mark-dialog" role="dialog" aria-modal="true" aria-labelledby="mark-dialog-title">
          <div className="mark-dialog__scrim" onClick={() => (mutation.isPending ? null : setMarkDialog(null))} />
          <section className="mark-dialog__panel">
            <header className="mark-dialog__header">
              <button type="button" onClick={() => setMarkDialog(null)} disabled={mutation.isPending}>
                取消
              </button>
              <h2 id="mark-dialog-title">{subject.title}</h2>
              <button type="button" onClick={submitMarkDialog} disabled={mutation.isPending}>
                {mutation.isPending ? <LoadingButtonLabel label="保存中" /> : "确定"}
              </button>
            </header>

            <div className="mark-dialog__body">
              <div className="mark-dialog__status" aria-label="标记状态">
                {(Object.entries(statusLabels[medium]) as Array<[ShelfStatus, string]>).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={markDialog.status === value ? "status-pill is-active" : "status-pill"}
                    onClick={() => updateMarkDialog({ status: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mark-dialog__rating">
                <span>评分</span>
                <div className="rating-row">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={markDialog.rating != null && value <= markDialog.rating ? "rating-star is-active" : "rating-star"}
                      onClick={() => updateMarkDialog({ rating: value })}
                      aria-label={`${value} 星`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <div className="mark-dialog__tags">
                <span>打标签</span>
                <div>
                  {tagSuggestions.map((tag) => (
                    <button type="button" key={tag} className={markDialog.tags.includes(tag) ? "tag-choice is-active" : "tag-choice"} onClick={() => toggleTag(tag)}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <label className="mark-dialog__comment">
                <span>
                  写短评
                  <small>{140 - markDialog.comment.length}</small>
                </span>
                <textarea
                  value={markDialog.comment}
                  maxLength={140}
                  rows={5}
                  placeholder="写几句自己的感受..."
                  onChange={(event) => updateMarkDialog({ comment: event.target.value.slice(0, 140) })}
                />
              </label>

              <label className="mark-dialog__sync">
                <input type="checkbox" checked={markDialog.syncToTimeline} onChange={(event) => updateMarkDialog({ syncToTimeline: event.target.checked })} />
                <span>同步到豆瓣</span>
              </label>

              {mutation.error ? <p className="form-error">{mutation.error.message}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
