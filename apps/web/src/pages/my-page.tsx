import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ShelfStatus } from "../../../../packages/shared/src";
import { mediumLabels, shelfStatuses, statusLabels } from "../../../../packages/shared/src";
import { getAuthMe, getLibrary, getOverview, proxiedImageUrl } from "../api";
import { useAppContext } from "../app-context";
import { LoadingInline, PanelLoading, SubjectCardSkeletonGrid } from "../components/loading-state";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";

export function MyPage() {
  const navigate = useNavigate();
  const { medium } = useAppContext();
  const [status, setStatus] = useState<ShelfStatus>("wish");

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });
  const session = authQuery.data?.sessionStatus;
  const user = authQuery.data?.user;
  const hasSession = authQuery.data?.authenticated && session?.status === "valid";
  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: getOverview,
    enabled: Boolean(hasSession),
    retry: false
  });
  const libraryQuery = useQuery({
    queryKey: ["library", medium, status],
    queryFn: () => getLibrary(medium, status),
    enabled: Boolean(hasSession)
  });

  const displayName = user?.displayName ?? session?.displayName ?? "已登录";
  const peopleId = user?.peopleId ?? session?.peopleId ?? "未获取";
  const ipLocation = user?.ipLocation ?? session?.ipLocation ?? "未获取";
  const avatarUrl = hasSession ? proxiedImageUrl(user?.avatarUrl ?? session?.avatarUrl) : null;
  const totals = overviewQuery.data?.totals ?? [];
  const total = totals
    .filter((item) => item.medium === medium)
    .reduce((sum, item) => sum + item.count, 0);
  const showLibrarySkeleton = hasSession && libraryQuery.isFetching && !libraryQuery.data;
  const showLibraryRefreshHint = hasSession && libraryQuery.isFetching && Boolean(libraryQuery.data);

  if ((authQuery.isPending && !authQuery.data) || (hasSession && overviewQuery.isPending && !overviewQuery.data)) {
    return (
      <div className="page my-page">
        <section className="profile-layout">
          <PanelLoading title="正在整理资料" detail="登录状态、统计和个人书影音会一起准备好。" />
          <section className="panel panel--loading">
            <div className="card-grid">
              <SubjectCardSkeletonGrid count={4} />
            </div>
          </section>
        </section>
      </div>
    );
  }

  return (
    <div className="page my-page">
      <section className="profile-layout">
        <div className={hasSession ? "profile-hero profile-hero--logged-in" : "profile-hero profile-hero--logged-out"}>
          <div className="profile-hero__backdrop" />
          <button className="profile-hero__settings" type="button" onClick={() => navigate("/settings")}>
            {hasSession ? "偏好设置" : "请登录"}
          </button>
          {hasSession ? (
            <>
              <div className="profile-hero__identity">
                <div className="profile-hero__avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : <span />}</div>
                <div className="profile-hero__info">
                  <h1>{displayName}</h1>
                </div>
              </div>
              <p className="profile-hero__id">ID: {peopleId}</p>
              <p className="profile-hero__session">已登录 / {ipLocation}</p>
            </>
          ) : (
            <>
              <div className="profile-hero__avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : <span>?</span>}</div>
              <div className="profile-hero__info">
                <p className="eyebrow">未登录</p>
                <h1>连接豆瓣</h1>
                <p>导入 Cookie 后同步评分和标记。</p>
              </div>
            </>
          )}
        </div>

        <div className="profile-content">
          {hasSession ? (
            <>
              <section className="hero-card hero-card--compact">
                <div>
                  <p className="eyebrow">douban-lite</p>
                  <h1>我的{mediumLabels[medium]}</h1>
                  <p className="supporting">集中查看收藏、评分和同步状态。</p>
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
                {showLibraryRefreshHint ? <p className="loading-row"><LoadingInline label="正在刷新本地镜像" tone="soft" /></p> : null}
                {libraryQuery.error ? <p className="form-error">{libraryQuery.error.message}</p> : null}
                {showLibrarySkeleton ? <SubjectCardSkeletonGrid count={6} /> : null}
                {libraryQuery.data?.items.map((item) => (
                  <SubjectCard key={`${item.medium}-${item.doubanId}`} medium={item.medium} subject={item.subject} item={item} />
                ))}
                {!showLibrarySkeleton && libraryQuery.data?.items.length === 0 ? <p className="empty-state">当前分类下还没有同步到内容。</p> : null}
              </div>
            </>
          ) : (
            <section className="panel login-required-panel">
              <strong>请先登录豆瓣</strong>
              <p className="supporting">导入 Cookie 后才能查看你的个人评分和标记</p>
              <button className="primary-button" type="button" onClick={() => navigate("/settings")}>去设置</button>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
