import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type { ShelfStatus } from "../../../../packages/shared/src";
import { mediumLabels, shelfStatuses, statusLabels } from "../../../../packages/shared/src";
import { getAuthMe, getLibrary, getOverview, proxiedImageUrl } from "../api";
import { useAppContext } from "../app-context";
import { LoadingButtonLabel, LoadingInline, PanelLoading, SubjectCardSkeletonGrid } from "../components/loading-state";
import { buildLoginPath, getRelativeLocation } from "../login-routing";
import { SegmentedControl } from "../components/segmented-control";
import { SubjectCard } from "../components/subject-card";

export function MyPage() {
  const navigate = useNavigate();
  const location = useLocation();
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

  const libraryQuery = useInfiniteQuery({
    queryKey: ["library", medium, status],
    queryFn: ({ pageParam }) => getLibrary(medium, status, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined),
    enabled: Boolean(hasSession),
    retry: false
  });

  const displayName = user?.displayName ?? session?.displayName ?? "已登录用户";
  const peopleId = user?.peopleId ?? session?.peopleId ?? "未获取到";
  const ipLocation = user?.ipLocation ?? session?.ipLocation ?? "未获取到";
  const avatarUrl = hasSession ? proxiedImageUrl(user?.avatarUrl ?? session?.avatarUrl) : null;
  const totals = overviewQuery.data?.totals ?? [];
  const total = totals.filter((item) => item.medium === medium).reduce((sum, item) => sum + item.count, 0);
  const libraryItems = libraryQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const showLibrarySkeleton = hasSession && libraryQuery.isFetching && libraryItems.length === 0;
  const showLibraryRefreshHint =
    hasSession && libraryQuery.isFetching && libraryItems.length > 0 && !libraryQuery.isFetchingNextPage;
  const loginPath = buildLoginPath(getRelativeLocation(location));

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
          <button className="profile-hero__settings" type="button" onClick={() => navigate(hasSession ? "/settings" : loginPath)}>
            {hasSession ? "偏好设置" : "请先登录"}
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
                  <strong>{total}</strong>
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
                {showLibraryRefreshHint ? (
                  <p className="loading-row">
                    <LoadingInline label="正在刷新本地镜像" tone="soft" />
                  </p>
                ) : null}
                {libraryQuery.error ? <p className="form-error">{libraryQuery.error.message}</p> : null}
                {showLibrarySkeleton ? <SubjectCardSkeletonGrid count={6} /> : null}
                {libraryItems.map((item) => (
                  <SubjectCard key={`${item.medium}-${item.doubanId}`} medium={item.medium} subject={item.subject} item={item} />
                ))}
                {!showLibrarySkeleton && libraryItems.length === 0 ? <p className="empty-state">当前分类下还没有同步到内容。</p> : null}
              </div>

              {libraryQuery.hasNextPage ? (
                <div className="detail-section__footer">
                  <button
                    type="button"
                    className="detail-more-button"
                    onClick={() => void libraryQuery.fetchNextPage()}
                    disabled={libraryQuery.isFetchingNextPage}
                  >
                    {libraryQuery.isFetchingNextPage ? <LoadingButtonLabel label="正在加载" /> : "查看更多"}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <section className="panel login-required-panel">
              <strong>请先登录豆瓣</strong>
              <p className="supporting">导入 Cookie 后才能查看你的个人评分和标记</p>
              <button className="primary-button" type="button" onClick={() => navigate(loginPath)}>
                去登录
              </button>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
