import { Link } from "react-router-dom";
import type { LibraryEntry, Medium, SubjectRecord } from "../../../../packages/shared/src";
import { statusLabels } from "../../../../packages/shared/src";
import { proxiedImageUrl } from "../api";

function renderStars(score: number | null) {
  if (score == null) {
    return "未评分";
  }
  return `${"★".repeat(score)}${"☆".repeat(Math.max(0, 5 - score))}`;
}

interface SubjectCardProps {
  medium: Medium;
  subject: SubjectRecord;
  item?: Pick<LibraryEntry, "status" | "rating" | "syncState" | "errorMessage"> | null;
  extra?: React.ReactNode;
}

function renderSyncState(syncState: LibraryEntry["syncState"]) {
  switch (syncState) {
    case "synced":
      return "已同步";
    case "pending_push":
      return "待写回";
    case "needs_attention":
      return "需处理";
  }
}

export function SubjectCard({ medium, subject, item, extra }: SubjectCardProps) {
  const externalUrl = typeof subject.metadata.externalUrl === "string" ? subject.metadata.externalUrl : null;
  const externalOnly = subject.metadata.externalOnly === "true";
  const coverUrl = proxiedImageUrl(subject.coverUrl);
  const className = "subject-card";
  const content = (
    <>
      <div className="subject-card__cover">
        {coverUrl ? <img src={coverUrl} alt={subject.title} loading="lazy" /> : <span>无封面</span>}
      </div>
      <div className="subject-card__body">
        <div className="subject-card__header">
          <h3>{subject.title}</h3>
          {subject.year ? <span>{subject.year}</span> : null}
        </div>
        {subject.subtitle ? <p className="subject-card__subtitle">{subject.subtitle}</p> : null}
        <p className="subject-card__meta">
          {subject.averageRating ? `豆瓣 ${subject.averageRating.toFixed(1)}` : externalOnly ? "豆瓣外链" : "暂无豆瓣评分"}
          {subject.creators.length > 0 ? ` · ${subject.creators.join(" / ")}` : ""}
        </p>
        {externalOnly ? <span className="tag tag--external">外部</span> : null}
        {item ? (
          <div className="subject-card__tags">
            <span className={`tag tag--${item.syncState}`}>{renderSyncState(item.syncState)}</span>
            <span className="tag">{renderStars(item.rating)}</span>
            <span className="tag">{statusLabels[medium][item.status]}</span>
          </div>
        ) : null}
        {item?.errorMessage ? <p className="subject-card__error">{item.errorMessage}</p> : null}
        {extra}
      </div>
    </>
  );

  if (externalOnly && externalUrl) {
    return (
      <a href={externalUrl} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link to={`/subject/${medium}/${subject.doubanId}`} className={className}>
      {content}
    </Link>
  );
}
