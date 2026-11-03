import { useEffect, useState, useSyncExternalStore } from "react";

import { AudioEngine } from "./audioEngine";
import { AddPadModal } from "./components/AddPadModal";
import type { AddPadRequest } from "./components/AddPadModal";
import { Modal } from "./components/Modal";
import { PadDetailModal } from "./components/PadDetailModal";
import { overlaps, PadGrid } from "./components/PadGrid";
import { SettingsModal } from "./components/SettingsModal";
import { formatDb, formatTime, stripExtension } from "./format";
import {
  deleteUnusedFiles,
  getFile,
  loadPads,
  loadSettings,
  putFile,
  savePads,
  saveSettings,
} from "./storage";
import { CATEGORY_DEFAULTS, DEFAULT_PAD_SIZE, GRID_COLUMNS } from "./types";
import type { AppSettings, Pad } from "./types";

const engine = new AudioEngine(getFile);

const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.1;

export function App() {
  const [pads, setPads] = useState<Pad[]>(loadPads);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [detailPadId, setDetailPadId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pad | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const hasActivity = Object.keys(snapshot.voices).length > 0 || snapshot.loading.length > 0;
  const now = useEngineClock(hasActivity);

  const detailPad = pads.find((pad) => pad.id === detailPadId) ?? null;
  const isModalOpen = isAddOpen || isSettingsOpen || detailPad !== null || deleteTarget !== null;

  // ---- 永続化 ----

  useEffect(() => savePads(pads), [pads]);
  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    // 起動時: 参照されていないファイルを掃除し、SE を先読みしておく
    const initial = loadPads();
    void deleteUnusedFiles(new Set(initial.map((pad) => pad.fileId))).catch(() => undefined);
    for (const pad of initial) {
      if (pad.category === "se") {
        void engine.decode(pad.fileId).catch(() => undefined);
      }
    }
  }, []);

  // ---- エンジンへの設定反映 ----

  useEffect(() => {
    engine.fadeOutSec = settings.fadeOutSec;
  }, [settings.fadeOutSec]);

  useEffect(() => {
    engine.setMasterVolume(settings.masterVolumeDb);
  }, [settings.masterVolumeDb]);

  useEffect(() => {
    engine.setOutputDevice(settings.outputDeviceId).catch((err: unknown) => {
      setError(`出力デバイスを切り替えられませんでした: ${messageOf(err)}`);
    });
  }, [settings.outputDeviceId]);

  // ---- キーボード ----

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isModalOpen) {
        engine.stopAll();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  // ---- 操作 ----

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function fire(pad: Pad) {
    setError(null);
    engine.trigger(pad).catch((err: unknown) => {
      setError(`「${pad.label || pad.fileName}」を再生できませんでした: ${messageOf(err)}`);
    });
  }

  async function storeNewFile(file: File) {
    const fileId = crypto.randomUUID();
    let buffer: AudioBuffer;
    try {
      buffer = await engine.decodeNewFile(fileId, file);
    } catch {
      throw new Error(`「${file.name}」は再生できない形式です`);
    }
    await putFile(fileId, file);
    return { fileId, fileName: file.name, durationSec: buffer.duration };
  }

  async function handleAdd(request: AddPadRequest) {
    const added: Pad[] = [];
    for (const file of request.files) {
      const stored = await storeNewFile(file);
      const slot = findFreeSlot([...pads, ...added], DEFAULT_PAD_SIZE.w, DEFAULT_PAD_SIZE.h);
      added.push({
        id: crypto.randomUUID(),
        label:
          request.files.length === 1 && request.label.trim()
            ? request.label.trim()
            : stripExtension(file.name),
        ...stored,
        category: request.category,
        loop: request.loop,
        volumeDb: 0,
        leadInSec: CATEGORY_DEFAULTS[request.category].leadInSec,
        ...slot,
        ...DEFAULT_PAD_SIZE,
      });
    }
    setPads((current) => [...current, ...added]);
  }

  function handleSaveDetail(next: Pad) {
    const others = pads.filter((pad) => pad.id !== next.id);
    // サイズ変更で他のボタンに重なる場合は空いている場所へ移す
    const placed = others.some((pad) => overlaps(next, pad)) || next.x + next.w > GRID_COLUMNS
      ? { ...next, ...findFreeSlot(others, next.w, next.h) }
      : next;
    const nextPads = pads.map((pad) => (pad.id === next.id ? placed : pad));
    setPads(nextPads);
    setDetailPadId(null);
    void deleteUnusedFiles(new Set(nextPads.map((pad) => pad.fileId))).catch(() => undefined);
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) {
      return;
    }
    engine.stopPad(deleteTarget.id);
    const nextPads = pads.filter((pad) => pad.id !== deleteTarget.id);
    setPads(nextPads);
    setDeleteTarget(null);
    setDetailPadId(null);
    engine.forget(deleteTarget.fileId);
    void deleteUnusedFiles(new Set(nextPads.map((pad) => pad.fileId))).catch(() => undefined);
  }

  // ---- 表示 ----

  const currentBgm = Object.values(snapshot.voices).find(
    (voice) => voice.category === "bgm" && !voice.fading,
  );
  const currentBgmPad = currentBgm ? pads.find((pad) => pad.id === currentBgm.padId) : undefined;
  const seCount = Object.values(snapshot.voices).filter(
    (voice) => voice.category === "se" && !voice.fading,
  ).length;

  return (
    <main className="shell">
      <div className={`edit-frame${isEditing ? " edit-frame--on" : ""}`} aria-hidden="true" />

      <header className="app-bar">
        <div className="app-bar__left">
          <div>
            <p className="eyebrow">Pondashi</p>
            <h1>ポン出し</h1>
          </div>
          <div className={`now-playing${currentBgm ? " now-playing--on" : ""}`}>
            <span className="now-playing__tag">BGM</span>
            <span className="now-playing__title">
              {currentBgmPad ? currentBgmPad.label || currentBgmPad.fileName : "停止中"}
            </span>
            {currentBgm ? (
              <span className="now-playing__time">
                {now < currentBgm.startAt
                  ? `待機 ${(currentBgm.startAt - now).toFixed(1)}`
                  : currentBgm.loop
                    ? `LOOP ${formatTime((now - currentBgm.startAt) % currentBgm.duration)}`
                    : `-${formatTime(currentBgm.duration - (now - currentBgm.startAt))}`}
              </span>
            ) : null}
          </div>
          {seCount > 0 ? <span className="se-count">SE ×{seCount}</span> : null}
        </div>

        <div className="app-bar__right">
          <label className="master-volume" title="マスター音量">
            <span>MASTER</span>
            <input
              type="range"
              min={-40}
              max={6}
              step={0.5}
              value={settings.masterVolumeDb}
              onChange={(event) => updateSettings({ masterVolumeDb: Number(event.target.value) })}
              onDoubleClick={() => updateSettings({ masterVolumeDb: 0 })}
            />
            <output>{formatDb(settings.masterVolumeDb)}</output>
          </label>
          <button type="button" className="bar-button" onClick={() => engine.stopCategory("bgm")}>
            BGM停止
          </button>
          <button type="button" className="bar-button bar-button--danger" onClick={() => engine.stopAll()}>
            全停止
          </button>
          <div className="scale-control" aria-label="表示倍率">
            <button
              type="button"
              onClick={() => updateSettings({ gridScale: roundScale(settings.gridScale - SCALE_STEP) })}
              disabled={settings.gridScale <= SCALE_MIN}
            >
              -
            </button>
            <span>{Math.round(settings.gridScale * 100)}%</span>
            <button
              type="button"
              onClick={() => updateSettings({ gridScale: roundScale(settings.gridScale + SCALE_STEP) })}
              disabled={settings.gridScale >= SCALE_MAX}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className={`bar-button${isEditing ? " bar-button--active" : ""}`}
            onClick={() => setIsEditing((current) => !current)}
          >
            {isEditing ? "編集終了" : "編集モード"}
          </button>
          <button type="button" className="bar-button" onClick={() => setIsSettingsOpen(true)}>
            設定
          </button>
        </div>
      </header>

      {error ? (
        <p className="error-banner" onClick={() => setError(null)}>
          {error}
        </p>
      ) : null}

      <section className="pad-panel">
        <PadGrid
          pads={pads}
          voices={snapshot.voices}
          loading={snapshot.loading}
          now={now}
          isEditing={isEditing}
          scale={settings.gridScale}
          onPadsChange={setPads}
          onFire={fire}
          onOpenDetail={(pad) => setDetailPadId(pad.id)}
          onDeleteRequest={setDeleteTarget}
        />
      </section>

      <button
        type="button"
        className="fab-button"
        onClick={() => setIsAddOpen(true)}
        aria-label="ボタンを追加"
      >
        +
      </button>

      {isAddOpen ? <AddPadModal onClose={() => setIsAddOpen(false)} onSubmit={handleAdd} /> : null}

      {detailPad && !deleteTarget ? (
        <PadDetailModal
          key={detailPad.id}
          pad={detailPad}
          isPlaying={Boolean(snapshot.voices[detailPad.id] && !snapshot.voices[detailPad.id].fading)}
          onCancel={() => setDetailPadId(null)}
          onSave={handleSaveDetail}
          onDelete={() => setDeleteTarget(detailPad)}
          onPreview={fire}
          onLiveVolume={(padId, db) => engine.setPadVolume(padId, db)}
          onReplaceFile={storeNewFile}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onTestTone={() => engine.playTestTone()}
          onClose={() => setIsSettingsOpen(false)}
        />
      ) : null}

      {deleteTarget ? (
        <Modal eyebrow="Delete" title="ボタンを削除" size="small">
          <p className="confirm-message">「{deleteTarget.label || deleteTarget.fileName}」を削除します。</p>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </button>
            <button type="button" className="danger-button" onClick={handleDeleteConfirm}>
              削除
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

/** 再生中だけ requestAnimationFrame で AudioContext の時刻を追う */
function useEngineClock(active: boolean) {
  const [now, setNow] = useState(() => engine.now());

  useEffect(() => {
    if (!active) {
      setNow(engine.now());
      return;
    }
    let frame = 0;
    const tick = () => {
      setNow(engine.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return now;
}

function findFreeSlot(pads: Pad[], w: number, h: number) {
  const width = Math.min(w, GRID_COLUMNS);
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x + width <= GRID_COLUMNS; x++) {
      const rect = { x, y, w: width, h };
      if (!pads.some((pad) => overlaps(rect, pad))) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}

function roundScale(value: number) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 10) / 10));
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
