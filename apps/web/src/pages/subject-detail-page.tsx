import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { SubjectComment } from "../../../../packages/shared/src";
import { mediumLabels, mediumSchema, statusLabels } from "../../../../packages/shared/src";
import { getSubjectComments, getSubjectDetail, proxiedImageUrl, updateLibraryState } from "../api";
import { StatusEditor } from "../components/status-editor";

export function SubjectDetailPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const medium = mediumSchema.parse(params.medium);
  const doubanId = params.doubanId!;

  const detailQuery = useQuery({
    queryKey: ["subject", medium, doubanId],
    queryFn: () => getSubjectDetail(medium, doubanId)
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

  if (detailQuery.isPending) {
    return (
      <div className="page">
        <p className="empty-state">载入条目详情中...</p>
      </div>
    );
  }

  if (detailQuery.error || !subject) {
    return (
      <div className="page">
        <p className="form-error">{detailQuery.error?.message ?? "条目详情加载失败"}</p>
      </div>
    );
  }

  return (
    <div className="page detail-page">
      <section className="detail-hero">
        <div className="detail-hero__cover">
          {coverUrl ? <img src={coverUrl} alt={subject.title} /> : <span>无封面</span>}
        </div>
        <div className="detail-hero__body">
          <p className="eyebrow">{mediumLabels[medium]}</p>
          <h1>{subject.title}</h1>
          {subject.subtitle ? <p className="subject-card__subtitle">{subject.subtitle}</p> : null}
          <p className="subject-card__meta">
            {subject.averageRating ? `豆瓣 ${subject.averageRating.toFixed(1)}` : "暂无豆瓣评分"}
            {subject.creators.length > 0 ? ` · ${subject.creators.join(" / ")}` : ""}
          </p>
          {subject.summary ? <p className="detail-summary">{subject.summary}</p> : null}
        </div>
      </section>

      <section className="panel status-panel">
        <div className="status-panel__header">
          <div>
            <strong>我的状态</strong>
            <p>
              当前：{userItem ? statusLabels[medium][userItem.status] : "未标记"}
              {userItem?.rating ? ` · ${userItem.rating} 星` : ""}
            </p>
          </div>
          {userItem?.syncState ? <span className={`pill pill--${userItem.syncState}`}>{userItem.syncState === "synced" ? "已同步" : userItem.syncState === "pending_push" ? "待写回" : "需处理"}</span> : null}
        </div>
        <StatusEditor
          medium={medium}
          status={userItem?.status ?? "wish"}
          rating={userItem?.rating ?? null}
          disabled={mutation.isPending}
          onChange={(input) => mutation.mutate(input)}
        />
        {mutation.error ? <p className="form-error">{mutation.error.message}</p> : null}
      </section>

      <section className="panel comments-panel">
        <div className="comments-panel__header">
          <div>
            <strong>豆瓣短评</strong>
            <p className="supporting">来自条目页的近期公开短评，用来快速判断口碑。</p>
          </div>
          {commentsQuery.isFetching ? <span className="pill pill--info">读取中</span> : null}
        </div>
        {comments.length > 0 ? (
          <div className="comment-list-lite">
            {comments.map((comment, index) => (
              <article className="comment-card" key={comment.id ?? `${comment.author}-${index}`}>
                <div className="comment-card__meta">
                  <strong>{comment.author ?? "豆瓣用户"}</strong>
                  <span>{comment.rating ?? comment.createdAt ?? ""}</span>
                </div>
                <p>{comment.content}</p>
                {comment.votes ? <span className="comment-card__votes">{comment.votes} 有用</span> : null}
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
