import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { mediumLabels, mediums } from "../../../packages/shared/src";
import { getAuthMe, proxiedImageUrl } from "./api";
import { AppContextProvider, useAppContext } from "./app-context";
import { SegmentedControl } from "./components/segmented-control";
import { buildLoginPath, getRelativeLocation } from "./login-routing";
import { LoginPage } from "./pages/login-page";
import { MyPage } from "./pages/my-page";
import { RankingsPage } from "./pages/rankings-page";
import { SearchPage } from "./pages/search-page";
import { SettingsPage } from "./pages/settings-page";
import { SubjectDetailPage } from "./pages/subject-detail-page";
import { TimelinePage } from "./pages/timeline-page";

type NavIconName = "rankings" | "timeline" | "search" | "me" | "settings";

function NavIcon({ name }: { name: NavIconName }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (name === "rankings") {
    return <svg {...common}><path d="M4 19V9" /><path d="M12 19V5" /><path d="M20 19v-8" /><path d="M3 19h18" /></svg>;
  }
  if (name === "timeline") {
    return <svg {...common}><path d="M5 6h.01" /><path d="M5 12h.01" /><path d="M5 18h.01" /><path d="M9 6h10" /><path d="M9 12h10" /><path d="M9 18h10" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.36.35.7.6 1H20a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-.51 1Z" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.8-4 4.5-6 8-6s6.2 2 8 6" /></svg>;
}

function NavItem({ to, icon, label, variant = "bottom" }: { to: string; icon: NavIconName; label: string; variant?: "bottom" | "sidebar" }) {
  return (
    <NavLink to={to} className={variant === "sidebar" ? "sidebar-nav__item" : undefined}>
      <NavIcon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

function AppNavigation() {
  const { medium, setMedium, showTimelineNav, showRankingsNav } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();
  const sessionQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });
  const showMediumPicker =
    !location.pathname.startsWith("/login") &&
    !location.pathname.startsWith("/settings") &&
    !location.pathname.startsWith("/timeline") &&
    !location.pathname.startsWith("/subject/");
  const showBottomNav = !location.pathname.startsWith("/subject/") && !location.pathname.startsWith("/login");

  useEffect(() => {
    if (!showTimelineNav && location.pathname.startsWith("/timeline")) {
      navigate("/me", { replace: true });
    }
    if (!showRankingsNav && location.pathname.startsWith("/rankings")) {
      navigate("/me", { replace: true });
    }
  }, [location.pathname, navigate, showRankingsNav, showTimelineNav]);

  const auth = sessionQuery.data;
  const session = auth?.sessionStatus;
  const user = auth?.user;
  const hasDoubanSession = auth?.authenticated && session?.status === "valid";
  const avatarUrl = hasDoubanSession ? proxiedImageUrl(user?.avatarUrl ?? session?.avatarUrl) : null;
  const accountLabel = hasDoubanSession ? (user?.displayName ?? session?.displayName ?? "豆瓣用户") : "未登录";
  const accountMeta = hasDoubanSession ? `${user?.ipLocation ?? session?.ipLocation ?? "未知地区"} / 已登录 / 同步可用` : "导入自己的豆瓣 Cookie 后使用";
  const accountTarget = hasDoubanSession
    ? "/settings"
    : location.pathname.startsWith("/login")
      ? "/login"
      : buildLoginPath(getRelativeLocation(location));
  const mediumPicker = showMediumPicker ? (
    <SegmentedControl
      value={medium}
      options={mediums.map((item) => ({
        value: item,
        label: mediumLabels[item]
      }))}
      onChange={setMedium}
    />
  ) : null;

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar" aria-label="主导航">
        <div className="desktop-sidebar__brand">
          <p className="eyebrow">douban-lite</p>
          <strong>私人书影音</strong>
          <span>只保留真正有用的收藏、搜索和同步。</span>
        </div>
        <nav className="sidebar-nav">
          {showRankingsNav ? <NavItem to="/rankings" icon="rankings" label="榜单" variant="sidebar" /> : null}
          {showTimelineNav ? <NavItem to="/timeline" icon="timeline" label="动态" variant="sidebar" /> : null}
          <NavItem to="/search" icon="search" label="搜索" variant="sidebar" />
          <NavItem to="/me" icon="me" label="我的" variant="sidebar" />
          <NavItem to="/settings" icon="settings" label="设置" variant="sidebar" />
        </nav>
        <button className="desktop-sidebar__account" type="button" onClick={() => navigate(accountTarget)}>
          <span className="desktop-sidebar__avatar">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : accountLabel.slice(0, 1)}
          </span>
          <span>
            <strong>{accountLabel}</strong>
            <small>{accountMeta}</small>
          </span>
        </button>
      </aside>
      {showMediumPicker ? <header className="app-shell__header">{mediumPicker}</header> : null}
      <main className="app-shell__main">
        {showMediumPicker ? <div className="desktop-medium-picker">{mediumPicker}</div> : null}
        <Routes>
          <Route path="/" element={<Navigate to="/me" replace />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/me" element={<MyPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
        </Routes>
      </main>
      {showBottomNav ? (
        <nav className="bottom-nav">
          {showRankingsNav ? <NavItem to="/rankings" icon="rankings" label="榜单" /> : null}
          {showTimelineNav ? <NavItem to="/timeline" icon="timeline" label="动态" /> : null}
          <NavItem to="/search" icon="search" label="搜索" />
          <NavItem to="/me" icon="me" label="我的" />
        </nav>
      ) : null}
    </div>
  );
}

export function App() {
  return (
    <AppContextProvider>
      <AppNavigation />
    </AppContextProvider>
  );
}
