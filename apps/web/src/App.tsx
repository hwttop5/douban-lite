import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { mediumLabels, mediums } from "../../../packages/shared/src";
import { AppContextProvider, useAppContext } from "./app-context";
import { SegmentedControl } from "./components/segmented-control";
import { MyPage } from "./pages/my-page";
import { RankingsPage } from "./pages/rankings-page";
import { SearchPage } from "./pages/search-page";
import { SettingsPage } from "./pages/settings-page";
import { SubjectDetailPage } from "./pages/subject-detail-page";
import { TimelinePage } from "./pages/timeline-page";

function NavIcon({ name }: { name: "rankings" | "timeline" | "search" | "me" }) {
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
  return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.8-4 4.5-6 8-6s6.2 2 8 6" /></svg>;
}

function BottomNavItem({ to, icon, label }: { to: string; icon: "rankings" | "timeline" | "search" | "me"; label: string }) {
  return (
    <NavLink to={to}>
      <NavIcon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

function AppNavigation() {
  const { medium, setMedium, showTimelineNav, showRankingsNav } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();
  const showMediumPicker =
    !location.pathname.startsWith("/settings") &&
    !location.pathname.startsWith("/timeline") &&
    !location.pathname.startsWith("/subject/");

  useEffect(() => {
    if (!showTimelineNav && location.pathname.startsWith("/timeline")) {
      navigate("/me", { replace: true });
    }
    if (!showRankingsNav && location.pathname.startsWith("/rankings")) {
      navigate("/me", { replace: true });
    }
  }, [location.pathname, navigate, showRankingsNav, showTimelineNav]);

  return (
    <div className="app-shell">
      {showMediumPicker ? (
        <header className="app-shell__header">
          <SegmentedControl
            value={medium}
            options={mediums.map((item) => ({
              value: item,
              label: mediumLabels[item]
            }))}
            onChange={setMedium}
          />
        </header>
      ) : null}
      <main className="app-shell__main">
        <Routes>
          <Route path="/" element={<Navigate to="/me" replace />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/me" element={<MyPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        {showRankingsNav ? <BottomNavItem to="/rankings" icon="rankings" label="榜单" /> : null}
        {showTimelineNav ? <BottomNavItem to="/timeline" icon="timeline" label="动态" /> : null}
        <BottomNavItem to="/search" icon="search" label="搜索" />
        <BottomNavItem to="/me" icon="me" label="我的" />
      </nav>
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
