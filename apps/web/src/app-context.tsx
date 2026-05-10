import { createContext, useContext, useEffect, useState } from "react";
import type { Medium } from "../../../packages/shared/src";

const mediumKey = "douban-lite:medium";
const timelineNavKey = "douban-lite:show-timeline-nav";
const rankingsNavKey = "douban-lite:show-rankings-nav";

interface AppContextValue {
  medium: Medium;
  setMedium: (medium: Medium) => void;
  showTimelineNav: boolean;
  setShowTimelineNav: (visible: boolean) => void;
  showRankingsNav: boolean;
  setShowRankingsNav: (visible: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function readBooleanPreference(key: string, defaultValue: boolean) {
  const stored = window.localStorage.getItem(key);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return defaultValue;
}

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [medium, setMediumState] = useState<Medium>(() => {
    const stored = window.localStorage.getItem(mediumKey);
    if (stored === "movie" || stored === "music" || stored === "book" || stored === "game") {
      return stored;
    }
    return "movie";
  });
  const [showTimelineNav, setShowTimelineNav] = useState(() => readBooleanPreference(timelineNavKey, true));
  const [showRankingsNav, setShowRankingsNav] = useState(() => readBooleanPreference(rankingsNavKey, true));

  useEffect(() => {
    window.localStorage.setItem(mediumKey, medium);
  }, [medium]);

  useEffect(() => {
    window.localStorage.setItem(timelineNavKey, String(showTimelineNav));
  }, [showTimelineNav]);

  useEffect(() => {
    window.localStorage.setItem(rankingsNavKey, String(showRankingsNav));
  }, [showRankingsNav]);

  return (
    <AppContext.Provider
      value={{
        medium,
        setMedium: setMediumState,
        showTimelineNav,
        setShowTimelineNav,
        showRankingsNav,
        setShowRankingsNav
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return value;
}
