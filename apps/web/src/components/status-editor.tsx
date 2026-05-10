import type { Medium, ShelfStatus } from "../../../../packages/shared/src";
import { statusLabels } from "../../../../packages/shared/src";

interface StatusEditorProps {
  medium: Medium;
  status: ShelfStatus;
  rating: number | null;
  disabled?: boolean;
  onChange: (input: { status: ShelfStatus; rating: number | null }) => void;
}

export function StatusEditor({ medium, status, rating, disabled, onChange }: StatusEditorProps) {
  return (
    <div className="status-editor status-editor--mobile-detail">
      <div className="status-editor__row" aria-label="收藏状态">
        {(Object.entries(statusLabels[medium]) as Array<[ShelfStatus, string]>).map(([value, label]) => (
          <button
            type="button"
            key={value}
            disabled={disabled}
            className={value === status ? "status-pill is-active" : "status-pill"}
            onClick={() => onChange({ status: value, rating })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rating-row" aria-label="评分">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            type="button"
            key={value}
            disabled={disabled}
            className={value <= (rating ?? 0) ? "rating-star is-active" : "rating-star"}
            onClick={() => onChange({ status, rating: value })}
            aria-label={`${value} 星`}
          >
            ★
          </button>
        ))}
        <button type="button" disabled={disabled} className="rating-clear" onClick={() => onChange({ status, rating: null })}>
          清空
        </button>
      </div>
    </div>
  );
}
