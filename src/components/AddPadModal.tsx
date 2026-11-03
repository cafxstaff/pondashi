import { useState } from "react";
import type { FormEvent } from "react";

import { CATEGORY_DEFAULTS } from "../types";
import type { Category } from "../types";
import { stripExtension } from "../format";
import { CategoryToggle, Modal } from "./Modal";

export type AddPadRequest = {
  files: File[];
  category: Category;
  label: string;
  loop: boolean;
};

type AddPadModalProps = {
  onClose: () => void;
  onSubmit: (request: AddPadRequest) => Promise<void>;
};

export function AddPadModal({ onClose, onSubmit }: AddPadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<Category>("se");
  const [label, setLabel] = useState("");
  const [loop, setLoop] = useState(CATEGORY_DEFAULTS.se.loop);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCategoryChange(next: Category) {
    setCategory(next);
    setLoop(CATEGORY_DEFAULTS[next].loop);
  }

  function handleFiles(list: FileList | null) {
    const next = list ? Array.from(list) : [];
    setFiles(next);
    setLabel(next.length === 1 ? stripExtension(next[0].name) : "");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0) {
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await onSubmit({ files, category, label, loop });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal eyebrow="Add" title="ボタンを追加" onClose={isBusy ? undefined : onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>音声ファイル</span>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac"
            multiple
            onChange={(event) => handleFiles(event.target.files)}
            disabled={isBusy}
            autoFocus
          />
          {files.length > 1 ? (
            <small>{files.length} ファイルをまとめて追加します（表示名はファイル名）</small>
          ) : null}
        </label>

        <div className="field">
          <span>カテゴリ</span>
          <CategoryToggle value={category} onChange={handleCategoryChange} disabled={isBusy} />
        </div>

        {files.length <= 1 ? (
          <label className="field">
            <span>表示名</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="ファイル名を使用"
              disabled={isBusy}
            />
          </label>
        ) : null}

        <label className="check-field">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
            disabled={isBusy}
          />
          <span>ループ再生</span>
        </label>

        <p className="hint">
          頭の空白は {CATEGORY_DEFAULTS[category].leadInSec} 秒で作成します（あとで詳細設定から変更できます）
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={isBusy}>
            キャンセル
          </button>
          <button type="submit" className="primary-button" disabled={isBusy || files.length === 0}>
            {isBusy ? "読み込み中..." : "追加"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
