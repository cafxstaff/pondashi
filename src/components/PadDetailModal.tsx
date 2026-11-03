import { useState } from "react";
import type { FormEvent } from "react";

import { CATEGORY_DEFAULTS, effectiveGainDb, GRID_COLUMNS } from "../types";
import type { Category, Pad } from "../types";
import { formatDb, formatTime } from "../format";
import { CategoryToggle, Modal } from "./Modal";

export type ReplacedFile = Pick<
  Pad,
  "fileId" | "fileName" | "durationSec" | "replayGainDb" | "useReplayGain"
>;

type PadDetailModalProps = {
  pad: Pad;
  isPlaying: boolean;
  onCancel: () => void;
  onSave: (pad: Pad) => void;
  onDelete: () => void;
  onPreview: (draft: Pad) => void;
  onLiveVolume: (padId: string, db: number) => void;
  onReplaceFile: (file: File) => Promise<ReplacedFile>;
};

export function PadDetailModal({
  pad,
  isPlaying,
  onCancel,
  onSave,
  onDelete,
  onPreview,
  onLiveVolume,
  onReplaceFile,
}: PadDetailModalProps) {
  const [draft, setDraft] = useState<Pad>(pad);
  const [isReplacing, setIsReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(patch: Partial<Pad>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleCategoryChange(category: Category) {
    const previousDefault = CATEGORY_DEFAULTS[draft.category];
    const nextDefault = CATEGORY_DEFAULTS[category];
    // 既定値のままなら新しいカテゴリの既定値に追従させる
    update({
      category,
      leadInSec: draft.leadInSec === previousDefault.leadInSec ? nextDefault.leadInSec : draft.leadInSec,
      loop: draft.loop === previousDefault.loop ? nextDefault.loop : draft.loop,
    });
  }

  function handleGainChange(patch: Partial<Pick<Pad, "volumeDb" | "useReplayGain">>) {
    update(patch);
    onLiveVolume(draft.id, effectiveGainDb({ ...draft, ...patch }));
  }

  function handleVolume(db: number) {
    handleGainChange({ volumeDb: db });
  }

  async function handleReplace(list: FileList | null) {
    const file = list?.[0];
    if (!file) {
      return;
    }
    setIsReplacing(true);
    setError(null);
    try {
      const replaced = await onReplaceFile(file);
      update(replaced);
      onLiveVolume(draft.id, effectiveGainDb({ ...draft, ...replaced }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReplacing(false);
    }
  }

  function handleCancel() {
    onLiveVolume(pad.id, effectiveGainDb(pad));
    onCancel();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...draft,
      leadInSec: clampNumber(draft.leadInSec, 0, 60),
      w: clampNumber(Math.round(draft.w), 1, GRID_COLUMNS),
      h: clampNumber(Math.round(draft.h), 1, 12),
    });
  }

  return (
    <Modal eyebrow="Button" title="ボタンの詳細設定" onClose={handleCancel}>
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>表示名</span>
          <input
            value={draft.label}
            onChange={(event) => update({ label: event.target.value })}
            placeholder={draft.fileName}
            autoFocus
          />
        </label>

        <div className="field">
          <span>ファイル</span>
          <div className="file-row">
            <div className="file-row__name">
              <strong title={draft.fileName}>{draft.fileName}</strong>
              <small>{formatTime(draft.durationSec)}</small>
            </div>
            <label className="ghost-button file-button">
              {isReplacing ? "読み込み中..." : "差し替え"}
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac"
                onChange={(event) => void handleReplace(event.target.files)}
                disabled={isReplacing}
                hidden
              />
            </label>
          </div>
        </div>

        <div className="field">
          <span>カテゴリ</span>
          <CategoryToggle value={draft.category} onChange={handleCategoryChange} />
          <small>
            {draft.category === "bgm"
              ? "再生すると前の BGM をフェードアウトし、空白の後に頭から再生します"
              : "BGM を止めずに重ねて再生します"}
          </small>
        </div>

        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.loop}
            onChange={(event) => update({ loop: event.target.checked })}
          />
          <span>ループ再生</span>
        </label>

        <div className="field">
          <span>
            音量 <output className="value-tag">{formatDb(draft.volumeDb)}</output>
          </span>
          <div className="slider-row">
            <input
              type="range"
              min={-40}
              max={12}
              step={0.5}
              value={draft.volumeDb}
              onChange={(event) => handleVolume(Number(event.target.value))}
            />
            <button type="button" className="ghost-button" onClick={() => handleVolume(0)}>
              0 dB
            </button>
          </div>
        </div>

        <div className="field">
          <span>ReplayGain (トラック)</span>
          {draft.replayGainDb != null ? (
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.useReplayGain !== false}
                onChange={(event) => handleGainChange({ useReplayGain: event.target.checked })}
              />
              <span>
                適用する <output className="value-tag">{formatDb(draft.replayGainDb)}</output>
              </span>
            </label>
          ) : (
            <small>
              {draft.replayGainDb === undefined ? "解析中..." : "このファイルには ReplayGain タグがありません"}
            </small>
          )}
          <small>実効ゲイン: {formatDb(effectiveGainDb(draft))}</small>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>頭の空白 (秒)</span>
            <input
              type="number"
              min={0}
              max={60}
              step={0.1}
              value={draft.leadInSec}
              onChange={(event) => update({ leadInSec: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>幅 (マス)</span>
            <input
              type="number"
              min={1}
              max={GRID_COLUMNS}
              value={draft.w}
              onChange={(event) => update({ w: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>高さ (マス)</span>
            <input
              type="number"
              min={1}
              max={12}
              value={draft.h}
              onChange={(event) => update({ h: Number(event.target.value) })}
            />
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions modal-actions--split">
          <button type="button" className="danger-button" onClick={onDelete}>
            削除
          </button>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => onPreview(draft)}>
              {isPlaying ? "試聴停止" : "試聴"}
            </button>
            <button type="button" className="ghost-button" onClick={handleCancel}>
              キャンセル
            </button>
            <button type="submit" className="primary-button" disabled={isReplacing}>
              保存
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
