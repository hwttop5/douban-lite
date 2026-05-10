import { startTransition, useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchSubjects } from "../api";
import { useAppContext } from "../app-context";
import { SubjectCard } from "../components/subject-card";

export function SearchPage() {
  const { medium } = useAppContext();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());

  const searchQuery = useQuery({
    queryKey: ["search", medium, deferredQuery],
    queryFn: () => searchSubjects(medium, deferredQuery),
    enabled: deferredQuery.length > 0,
    retry: 1
  });

  return (
    <div className="page search-page">
      <section className="search-panel">
        <div className="page-header">
          <p className="eyebrow">搜索</p>
          <h1>搜索条目</h1>
          <p className="supporting">按当前媒介搜索豆瓣条目，结果会直接进入详情页。</p>
        </div>
        <label className="field">
          <span>关键词</span>
          <input
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              startTransition(() => {
                setQuery(nextValue);
              });
            }}
            placeholder="比如：复仇者联盟 / 红楼梦 / Sea Change"
          />
        </label>
      </section>
      <div className="card-grid search-results-grid">
        {searchQuery.isFetching ? <p className="empty-state">正在从豆瓣搜索...</p> : null}
        {searchQuery.error ? <p className="form-error">{searchQuery.error.message}</p> : null}
        {searchQuery.data?.items.map((item) => (
          <SubjectCard key={`${item.medium}-${item.doubanId}`} medium={item.medium} subject={item} />
        ))}
        {deferredQuery.length === 0 ? (
          <section className="empty-state empty-state-panel" role="status">
            <strong>还没有搜索结果</strong>
            <span>输入关键词后开始搜索。</span>
          </section>
        ) : null}
        {deferredQuery.length > 0 && !searchQuery.isFetching && searchQuery.data?.items.length === 0 ? (
          <section className="empty-state empty-state-panel" role="status">
            <strong>没有找到结果</strong>
            <span>换个更短的关键词，或切换电影、图书、音乐、游戏。</span>
          </section>
        ) : null}
      </div>
    </div>
  );
}
