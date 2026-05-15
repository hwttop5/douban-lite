import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { boardCatalog } from "../../../../packages/shared/src";
import { getRanking } from "../api";
import { useAppContext } from "../app-context";
import { LoadingInline, SubjectCardSkeletonGrid } from "../components/loading-state";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";
import { useAutoLoadMore } from "../hooks/use-auto-load-more";

const RANKING_PAGE_SIZE = 25;

function rankingBoardTabLabel(medium: keyof typeof boardCatalog, boardKey: string, fallback: string) {
  if (medium === "music") {
    if (boardKey === "weekly-artists") {
      return "本周流行歌手";
    }
    if (boardKey === "rising-artists") {
      return "上升最快歌手";
    }
  }
  return fallback;
}

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
        <p className="eyebrow">{"\u699c\u5355"}</p>
        <h1>{rankingQuery.data?.board.name ?? activeBoard.name}</h1>
        <p className="supporting">{"\u6d4f\u89c8\u5f53\u524d\u5a92\u4ecb\u7684\u70ed\u95e8\u699c\u5355\u3002"}</p>
        {rankingQuery.data?.stale ? <p className="notice">{"\u5237\u65b0\u5931\u8d25\uff0c\u5f53\u524d\u663e\u793a\u6700\u8fd1\u4e00\u6b21\u7f13\u5b58\u3002"}</p> : null}
      </section>

      {boards.length > 1 ? (
        <SegmentedControl
          value={activeBoardKey}
          options={boards.map((board) => ({
            value: board.key,
            label: rankingBoardTabLabel(medium, board.key, board.name)
          }))}
          onChange={setBoardKey}
        />
      ) : null}

      <div className="card-grid">
        {showRankingRefreshHint ? (
          <p className="loading-row loading-row--full">
            <LoadingInline label={"\u6b63\u5728\u5237\u65b0\u699c\u5355"} tone="soft" />
          </p>
        ) : null}
        {rankingQuery.error ? <p className="form-error">{rankingQuery.error.message}</p> : null}
        {showRankingSkeleton ? <SubjectCardSkeletonGrid count={6} /> : null}
        {visibleItems.map((item) => (
          <SubjectCard
            key={`${item.subject.medium}-${item.subject.doubanId}`}
            medium={item.subject.medium}
            subject={item.subject}
            extra={<p className="subject-card__meta">{`\u7b2c ${item.rank} \u540d`}</p>}
          />
        ))}
        {!showRankingSkeleton && !rankingQuery.isFetching && items.length === 0 ? <p className="empty-state">{"\u5f53\u524d\u699c\u5355\u8fd8\u6ca1\u6709\u6293\u5230\u6761\u76ee\u3002"}</p> : null}
      </div>

      {hasMore ? <div ref={autoLoadMoreRef} className="auto-load-sentinel" aria-hidden="true" /> : null}
      {hasMore && showRankingRefreshHint ? (
        <p className="auto-load-status">
          <LoadingInline label={"\u6b63\u5728\u52a0\u8f7d\u66f4\u591a"} tone="soft" />
        </p>
      ) : null}
    </div>
  );
}
