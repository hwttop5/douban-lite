import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ShelfStatus, SubjectComment } from "../../../../packages/shared/src";
import { mediumLabels, mediumSchema, statusLabels } from "../../../../packages/shared/src";
import { getDoubanSessionStatus, getSubjectComments, getSubjectDetail, proxiedImageUrl, updateLibraryState } from "../api";

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

export function SubjectDetailPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
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
    queryKey: ["douban-session-status"],
    queryFn: getDoubanSessionStatus
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

  const mutation = useMutation({
    mutationFn: (input: { status: "wish" | "doing" | "done"; rating: number | null }) => updateLibraryState(medium, doubanId, input),
    onSuccess: async () => {
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
  const coverUrl = proxiedImageUrl(subject?.coverUrl);
  const hasDoubanSession = sessionQuery.data?.status === "valid";
  const sessionPending = sessionQuery.isPending;
  const visibleUserItem = hasDoubanSession ? userItem : null;
  const currentStatus = visibleUserItem?.status ?? "wish";
  const currentRating = visibleUserItem?.rating ?? null;
  const requireLoginThenMutate = (input: { status: ShelfStatus; rating: number | null }) => {
    if (!hasDoubanSession) {
      setLoginMessage("请先登录豆瓣后再标记和评分。");
      return;
    }
    setLoginMessage(null);
    mutation.mutate(input);
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
    return (
      <div className="page">
        <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
          <span>‹</span>
        </button>
        <p className="empty-state">载入条目详情中...</p>
      </div>
    );
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
              onClick={() => requireLoginThenMutate({ status: value, rating: currentRating })}
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
          {currentRating != null ? (
            <div className="detail-my-rating">
              <span>我的评分</span>
              <div className="detail-my-rating__stars" aria-label="我的评分">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    disabled={mutation.isPending || sessionPending}
                    className={value <= currentRating ? "is-active" : ""}
                    onClick={() => requireLoginThenMutate({ status: currentStatus, rating: value })}
                    aria-label={`${value} 星`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button type="button" disabled={mutation.isPending || sessionPending} onClick={() => requireLoginThenMutate({ status: currentStatus, rating: null })}>
                清空
              </button>
            </div>
          ) : null}
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

      <section className="detail-section comments-panel">
        <div className="comments-panel__header">
          <div>
            <h2>短评</h2>
          </div>
          {commentsQuery.isFetching ? <span className="pill pill--info">读取中</span> : null}
        </div>
        {comments.length > 0 ? (
          <div className="comment-list-lite">
            {comments.map((comment, index) => (
              <article className="comment-card" key={comment.id ?? `${comment.author}-${index}`}>
                <div className="comment-card__meta">
                  <span className="comment-card__avatar">{comment.author?.slice(0, 1) ?? "豆"}</span>
                  <div>
                    <strong>{comment.author ?? "豆瓣用户"}</strong>
                    {renderStars(ratingLabelToScore(comment.rating))}
                    {comment.createdAt ? <time>{comment.createdAt}</time> : comment.rating ? <time>{comment.rating}</time> : null}
                  </div>
                  <button type="button" aria-label="更多">•••</button>
                </div>
                <p>{comment.content}</p>
                {comment.votes ? <span className="comment-card__votes">♡ {comment.votes}</span> : null}
              </article>
            ))}
          </div>
        ) : commentsQuery.error ? (
          <p className="form-error">{commentsQuery.error.message}</p>
        ) : (
          <p className="empty-state">暂时没有解析到公开短评。</p>
        )}
        {loadMoreMutation.error ? <p className="form-error">{loadMoreMutation.error.message}</p> : null}
        {hasMore && nextStart != null ? (
          <button className="secondary-button comments-more-button" type="button" disabled={loadMoreMutation.isPending} onClick={() => loadMoreMutation.mutate(nextStart)}>
            {loadMoreMutation.isPending ? "加载中..." : "查看更多"}
          </button>
        ) : comments.length > 0 ? (
          <p className="empty-state">没有更多短评了。</p>
        ) : null}
      </section>
    </div>
  );
}
