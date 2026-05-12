import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoLoadMore } from "./use-auto-load-more";

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    MockIntersectionObserver.instances.push(this);
  }
}

function Harness({ onLoadMore, hasMore = true, isLoading = false }: { onLoadMore: () => void; hasMore?: boolean; isLoading?: boolean }) {
  const ref = useAutoLoadMore({
    hasMore,
    isLoading,
    onLoadMore
  });
  return <div ref={ref}>sentinel</div>;
}

describe("useAutoLoadMore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads more when the sentinel enters view", () => {
    const onLoadMore = vi.fn();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver as unknown as typeof IntersectionObserver);

    const { container } = render(<Harness onLoadMore={onLoadMore} />);
    const sentinel = container.firstChild as HTMLDivElement;
    const observer = MockIntersectionObserver.instances[0];

    expect(observer.observe).toHaveBeenCalledWith(sentinel);

    observer.callback([{ isIntersecting: true, target: sentinel } as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver);

    expect(observer.unobserve).toHaveBeenCalledWith(sentinel);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
