import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ShelfStatus } from "../../../../packages/shared/src";
import { mediumLabels, shelfStatuses, statusLabels } from "../../../../packages/shared/src";
import { getLibrary, getOverview, proxiedImageUrl } from "../api";
import { useAppContext } from "../app-context";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";

export function MyPage() {
  const navigate = useNavigate();
  const { medium } = useAppContext();
  const [status, setStatus] = useState<ShelfStatus>("wish");

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview
  });
  const session = overviewQuery.data?.sessionStatus;
  const hasSession = session?.status === "valid";
  const libraryQuery = useQuery({
    queryKey: ["library", medium, status],
    queryFn: () => getLibrary(medium, status),
    enabled: hasSession
  });

  const displayName = session?.displayName ?? "已登录";
  const peopleId = session?.peopleId ?? "未获取";
  const ipLocation = session?.ipLocation ?? "未获取";
  const avatarUrl = hasSession ? proxiedImageUrl(session.avatarUrl) : null;
  const total = overviewQuery.data?.totals
    .filter((item) => item.medium === medium)
    .reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="page my-page">
      <section className="profile-hero">
        <div className="profile-hero__backdrop" />
        <div className="profile-hero__avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span />}
        </div>
        <button className="profile-hero__settings" type="button" onClick={() => navigate("/settings")}>
          {hasSession ? "偏好设置" : "请登录"}
        </button>
        {hasSession ? (
          <div className="profile-hero__info">
            <h1>{displayName}</h1>
            <p>ID: {peopleId} / IP: {ipLocation}</p>
          </div>
        ) : null}
      </section>

      <section className="hero-card hero-card--compact">
        <div>
          <h1>我的{mediumLabels[medium]}</h1>
          <p className="supporting">聚合你的标记和评分。</p>
        </div>
        <div className="hero-card__stats">
          <strong>{hasSession ? (total ?? 0) : 0}</strong>
          <span>条内容</span>
        </div>
      </section>

      {hasSession ? (
        <>
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
        </>
      ) : (
        <section className="panel login-required-panel">
          <strong>请先登录豆瓣</strong>
          <p className="supporting">导入 Cookie 后才能查看你的个人收藏、评分和标记。</p>
        </section>
      )}
    </div>
  );
}
