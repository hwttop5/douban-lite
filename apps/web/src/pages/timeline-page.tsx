import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { TimelineActionResponse, TimelineItem, TimelineResponse } from "../../../../packages/shared/src";
import { ApiError, getAuthMe, getTimeline, likeTimelineStatus, proxiedImageUrl, replyTimelineStatus, repostTimelineStatus } from "../api";
import { LoadingButtonLabel, LoadingInline, TimelineSkeletonList } from "../components/loading-state";
import { useAutoLoadMore } from "../hooks/use-auto-load-more";

interface TimelineDialogState {
  item: TimelineItem;
  mode: "reply" | "repost";
  text: string;
}

type TimelineEngagementLabel = TimelineItem["engagements"][number]["label"];

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

function timelineCount(engagements: TimelineItem["engagements"], label: TimelineEngagementLabel) {
  return engagements.find((item) => item.label === label)?.count ?? 0;
}

function updateTimelinePages(current: InfiniteData<TimelineResponse, number> | undefined, result: TimelineActionResponse) {
  if (!current) {
    return current;
  }
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === result.statusId
          ? {
              ...item,
              engagements: result.engagements,
              userLikeState: result.userLikeState ?? item.userLikeState
            }
          : item
      )
    }))
  };
}

function applyTimelineActionResult(queryClient: ReturnType<typeof useQueryClient>, result: TimelineActionResponse) {
  queryClient.setQueriesData({ queryKey: ["timeline"] }, (current: InfiniteData<TimelineResponse, number> | undefined) =>
    updateTimelinePages(current, result)
  );
}

function refreshAuthIfNeeded(error: unknown, queryClient: ReturnType<typeof useQueryClient>) {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
}

function TimelineActionButton({
  label,
  count,
  active,
  disabled,
  onClick
}: {
  label: string;
  count: number;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const text = `${label} (${count})`;
  return (
    <button type="button" className={active ? "is-active" : ""} disabled={disabled} onClick={onClick} aria-label={text}>
      {text}
    </button>
  );
}

export function TimelinePage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<TimelineDialogState | null>(null);

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });
  const sessionStatus = authQuery.data?.sessionStatus.status ?? "missing";
  const hasSession = authQuery.data?.authenticated && authQuery.data?.sessionStatus.status === "valid";

  const timelineQuery = useInfiniteQuery({
    queryKey: ["timeline", "following"],
    queryFn: ({ pageParam }) => getTimeline("following", pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore && lastPage.nextStart != null ? lastPage.nextStart : undefined),
    enabled: Boolean(hasSession),
    retry: 1
  });

  const likeMutation = useMutation({
    mutationFn: (item: TimelineItem) => {
      if (!item.detailUrl) {
        throw new Error("该动态缺少详情地址，暂时不能操作。");
      }
      return likeTimelineStatus(item.id, item.detailUrl);
    },
    onSuccess: (result) => {
      applyTimelineActionResult(queryClient, result);
    },
    onError: (error) => {
      refreshAuthIfNeeded(error, queryClient);
    }
  });

  const submitActionMutation = useMutation({
    mutationFn: (state: TimelineDialogState) => {
      if (!state.item.detailUrl) {
        throw new Error("该动态缺少详情地址，暂时不能操作。");
      }
      if (state.mode === "reply") {
        return replyTimelineStatus(state.item.id, state.item.detailUrl, state.text.trim());
      }
      return repostTimelineStatus(state.item.id, state.item.detailUrl, state.text.trim() || undefined);
    },
    onSuccess: (result) => {
      applyTimelineActionResult(queryClient, result);
      setDialog(null);
    },
    onError: (error) => {
      refreshAuthIfNeeded(error, queryClient);
    }
  });

  const firstPage = timelineQuery.data?.pages[0];
  const items = timelineQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const timelineIsStale = Boolean(firstPage?.stale);
  const timelineActionsDisabled = !hasSession || timelineIsStale || sessionStatus === "invalid";
  const timelineNotice =
    sessionStatus === "invalid"
      ? "豆瓣登录已失效，请重新导入 Cookie 后重试。"
      : timelineIsStale
        ? "实时抓取失败，当前显示的是缓存动态。赞、回复和转发已禁用，请重新导入有效的豆瓣 Cookie 后重试。"
        : null;
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

  const submitDialog = () => {
    if (!dialog) {
      return;
    }
    if (dialog.mode === "reply" && dialog.text.trim().length === 0) {
      return;
    }
    submitActionMutation.mutate(dialog);
  };

  return (
    <div className="page timeline-page">
      <section className="page-header">
        <p className="eyebrow">动态</p>
        <h1>豆瓣动态</h1>
        <p className="supporting">聚合自己和关注的人的最近标记。</p>
      </section>

      {timelineNotice ? <p className="notice">{timelineNotice}</p> : null}
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
          const likeCount = timelineCount(item.engagements, "赞");
          const replyCount = timelineCount(item.engagements, "回应");
          const repostCount = timelineCount(item.engagements, "转发");
          const availableActions = item.availableActions ?? { like: false, reply: false, repost: false };
          const userLikeState = item.userLikeState ?? "unknown";
          const likePending = likeMutation.isPending && likeMutation.variables?.id === item.id;
          const dialogPending = submitActionMutation.isPending && submitActionMutation.variables?.item.id === item.id;
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

                <p className="timeline-card__engagements">
                  <span>
                    <TimelineActionButton
                      label="赞"
                      count={likeCount}
                      active={userLikeState === "liked"}
                      disabled={timelineActionsDisabled || !availableActions.like || !item.detailUrl || likePending || dialogPending}
                      onClick={() => likeMutation.mutate(item)}
                    />
                  </span>
                  <span>
                    <TimelineActionButton
                      label="回复"
                      count={replyCount}
                      disabled={timelineActionsDisabled || !availableActions.reply || !item.detailUrl || likePending || dialogPending}
                      onClick={() => setDialog({ item, mode: "reply", text: "" })}
                    />
                  </span>
                  <span>
                    <TimelineActionButton
                      label="转发"
                      count={repostCount}
                      disabled={timelineActionsDisabled || !availableActions.repost || !item.detailUrl || likePending || dialogPending}
                      onClick={() => setDialog({ item, mode: "repost", text: "" })}
                    />
                  </span>
                </p>
              </div>
            </article>
          );
        })}
        {!showTimelineSkeleton && !timelineQuery.isFetching && items.length === 0 ? <p className="empty-state">暂时没有解析到动态内容。</p> : null}
      </div>

      {likeMutation.error ? <p className="form-error">{likeMutation.error.message}</p> : null}
      {submitActionMutation.error ? <p className="form-error">{submitActionMutation.error.message}</p> : null}
      {timelineQuery.hasNextPage ? <div ref={autoLoadMoreRef} className="auto-load-sentinel" aria-hidden="true" /> : null}
      {showTimelineRefreshHint ? <p className="auto-load-status"><LoadingInline label="正在展开更多动态" tone="soft" /></p> : null}
      {!timelineQuery.hasNextPage && !timelineQuery.isFetching && items.length > 0 ? <p className="empty-state">没有更多动态了。</p> : null}

      {dialog ? (
        <div className="timeline-action-dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-action-dialog-title">
          <div className="timeline-action-dialog__scrim" onClick={() => (submitActionMutation.isPending ? null : setDialog(null))} />
          <section className="timeline-action-dialog__panel">
            <header className="timeline-action-dialog__header">
              <button type="button" onClick={() => setDialog(null)} disabled={submitActionMutation.isPending}>
                取消
              </button>
              <h2 id="timeline-action-dialog-title">{dialog.mode === "reply" ? "回复动态" : "转发动态"}</h2>
              <button
                type="button"
                onClick={submitDialog}
                disabled={submitActionMutation.isPending || (dialog.mode === "reply" && dialog.text.trim().length === 0)}
              >
                {submitActionMutation.isPending ? <LoadingButtonLabel label="提交中" /> : "发送"}
              </button>
            </header>
            <div className="timeline-action-dialog__body">
              <p className="timeline-action-dialog__hint">{dialog.item.subjectTitle ?? dialog.item.content ?? "写点什么吧"}</p>
              <label className="timeline-action-dialog__input">
                <span>{dialog.mode === "reply" ? "回复内容" : "转发附言"}</span>
                <textarea
                  autoFocus
                  placeholder={dialog.mode === "reply" ? "写下你的回复" : "给这条动态补一句话（可选）"}
                  value={dialog.text}
                  onChange={(event) => setDialog((current) => (current ? { ...current, text: event.target.value.slice(0, 1000) } : current))}
                />
              </label>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
