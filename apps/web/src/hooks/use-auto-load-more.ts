import { useEffect, useRef } from "react";

interface UseAutoLoadMoreOptions {
  enabled?: boolean;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}

export function useAutoLoadMore({ enabled = true, hasMore, isLoading, onLoadMore, rootMargin = "0px 0px 320px 0px" }: UseAutoLoadMoreOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!enabled || !hasMore || isLoading || typeof IntersectionObserver === "undefined") {
      return;
    }
    const node = sentinelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }
        observer.unobserve(entries[0].target);
        loadMoreRef.current();
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, hasMore, isLoading, rootMargin]);

  return sentinelRef;
}
