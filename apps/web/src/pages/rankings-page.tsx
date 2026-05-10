import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { boardCatalog } from "../../../../packages/shared/src";
import { getRanking } from "../api";
import { useAppContext } from "../app-context";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";

export function RankingsPage() {
  const { medium } = useAppContext();
  const boards = boardCatalog[medium];
  const [boardKey, setBoardKey] = useState(boards[0].key);
  const activeBoardKey = boards.some((board) => board.key === boardKey) ? boardKey : boards[0].key;
  const activeBoard = boards.find((board) => board.key === activeBoardKey) ?? boards[0];

  useEffect(() => {
    if (activeBoardKey !== boardKey) {
      setBoardKey(boards[0].key);
    }
  }, [activeBoardKey, boardKey, boards]);

  const rankingQuery = useQuery({
    queryKey: ["ranking", medium, activeBoardKey],
    queryFn: () => getRanking(medium, activeBoardKey),
    retry: 1
  });

  return (
    <div className="page rankings-page">
      <section className="page-header">
        <p className="eyebrow">榜单</p>
        <h1>{rankingQuery.data?.board.name ?? activeBoard.name}</h1>
        <p className="supporting">浏览当前媒介的热门榜单，按排名快速进入条目详情。</p>
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
        {rankingQuery.isFetching ? <p className="empty-state">正在更新榜单...</p> : null}
        {rankingQuery.error ? <p className="form-error">{rankingQuery.error.message}</p> : null}
        {rankingQuery.data?.items.map((item) => (
          <SubjectCard
            key={`${item.subject.medium}-${item.subject.doubanId}`}
            medium={item.subject.medium}
            subject={item.subject}
            extra={<p className="subject-card__meta">第 {item.rank} 名{item.blurb ? ` · ${item.blurb}` : ""}</p>}
          />
        ))}
        {!rankingQuery.isFetching && rankingQuery.data?.items.length === 0 ? <p className="empty-state">这个榜单暂时没有解析到内容。</p> : null}
      </div>
    </div>
  );
}
