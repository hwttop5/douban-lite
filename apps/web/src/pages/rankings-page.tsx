import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { boardCatalog } from "../../../../packages/shared/src";
import { getRanking } from "../api";
import { useAppContext } from "../app-context";
import { LoadingInline, SubjectCardSkeletonGrid } from "../components/loading-state";
import { SegmentedControl } from "../components/segmented-control";
import { useAutoLoadMore } from "../hooks/use-auto-load-more";
import { SubjectCard } from "../components/subject-card";

const RANKING_PAGE_SIZE = 25;

export function RankingsPage() {
  const { medium } = useAppContext();
  const boards = boardCatalog[medium];
  const [boardKey, setBoardKey] = useState(boards[0].key);
  const [visibleCount, setVisibleCount] = useState(RANKING_PAGE_SIZE);
  const activeBoardKey = boards.some((board) => board.key === boardKey) ? boardKey : boards[0].key;
  const activeBoard = boards.find((board) => board.key === activeBoardKey) ?? boards[0];

  useEffect(() => {
    if (activeBoardKey !== boardKey) {
      setBoardKey(boards[0].key);
    }
  }, [activeBoardKey, boardKey, boards]);

  useEffect(() => {
    setVisibleCount(RANKING_PAGE_SIZE);
  }, [medium, activeBoardKey]);

  const rankingQuery = useQuery({
    queryKey: ["ranking", medium, activeBoardKey],
    queryFn: () => getRanking(medium, activeBoardKey),
    retry: 1
  });

  const items = rankingQuery.data?.items ?? [];
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length;
  const showRankingSkeleton = rankingQuery.isFetching && items.length === 0;
  const showRankingRefreshHint = rankingQuery.isFetching && items.length > 0;
  const autoLoadMoreRef = useAutoLoadMore({
    enabled: items.length > 0,
    hasMore,
    isLoading: rankingQuery.isFetching,
    onLoadMore: () => setVisibleCount((current) => Math.min(current + RANKING_PAGE_SIZE, items.length))
  });

  return (
    <div className="page rankings-page">
      <section className="page-header">
        <p className="eyebrow">榜单</p>
        <h1>{rankingQuery.data?.board.name ?? activeBoard.name}</h1>
        <p className="supporting">浏览当前媒介的热门榜单。</p>
        {rankingQuery.data?.stale ? <p className="notice">刷新失败，当前显示最近一次缓存。</p> : null}
      </section>

      {boards.length > 1 ? (
        <SegmentedControl
          value={activeBoardKey}
          options={boards.map((board) => ({ value: board.key, label: board.name }))}
          onChange={setBoardKey}
        />
      ) : null}

      <div className="card-grid">
        {showRankingRefreshHint ? <p className="loading-row loading-row--full"><LoadingInline label="正在刷新榜单" tone="soft" /></p> : null}
        {rankingQuery.error ? <p className="form-error">{rankingQuery.error.message}</p> : null}
        {showRankingSkeleton ? <SubjectCardSkeletonGrid count={6} /> : null}
        {visibleItems.map((item) => (
          <SubjectCard
            key={`${item.subject.medium}-${item.subject.doubanId}`}
            medium={item.subject.medium}
            subject={item.subject}
            extra={<p className="subject-card__meta">第 {item.rank} 名{item.blurb ? ` / ${item.blurb}` : ""}</p>}
          />
        ))}
        {!showRankingSkeleton && !rankingQuery.isFetching && items.length === 0 ? <p className="empty-state">这个榜单暂时没有解析到内容。</p> : null}
      </div>

      {hasMore ? <div ref={autoLoadMoreRef} className="auto-load-sentinel" aria-hidden="true" /> : null}
      {hasMore && showRankingRefreshHint ? <p className="auto-load-status"><LoadingInline label="继续加载中" tone="soft" /></p> : null}
    </div>
  );
}
