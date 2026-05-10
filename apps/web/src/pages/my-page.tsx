import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShelfStatus } from "../../../../packages/shared/src";
import { mediumLabels, shelfStatuses, statusLabels } from "../../../../packages/shared/src";
import { getLibrary, getOverview } from "../api";
import { useAppContext } from "../app-context";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";

export function MyPage() {
  const { medium } = useAppContext();
  const [status, setStatus] = useState<ShelfStatus>("wish");

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview
  });
  const libraryQuery = useQuery({
    queryKey: ["library", medium, status],
    queryFn: () => getLibrary(medium, status)
  });

  const total = overviewQuery.data?.totals
    .filter((item) => item.medium === medium)
    .reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">{mediumLabels[medium]}</p>
          <h1>我的 {mediumLabels[medium]}</h1>
          <p className="supporting">聚合你的标记和评分，只保留最小闭环。</p>
        </div>
        <div className="hero-card__stats">
          <strong>{total ?? 0}</strong>
          <span>条内容</span>
        </div>
      </section>

      <SegmentedControl
        value={status}
        options={shelfStatuses.map((item) => ({
          value: item,
          label: statusLabels[medium][item]
        }))}
        onChange={setStatus}
      />

      <div className="card-grid">
        {libraryQuery.isFetching ? <p className="empty-state">正在读取本地镜像...</p> : null}
        {libraryQuery.error ? <p className="form-error">{libraryQuery.error.message}</p> : null}
        {libraryQuery.data?.items.map((item) => (
          <SubjectCard key={`${item.medium}-${item.doubanId}`} medium={item.medium} subject={item.subject} item={item} />
        ))}
        {libraryQuery.data?.items.length === 0 ? <p className="empty-state">当前分类下还没有同步到内容。</p> : null}
      </div>
    </div>
  );
}
