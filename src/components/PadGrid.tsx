import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

import type { VoiceInfo } from "../audioEngine";
import { CATEGORY_LABEL, GRID_COLUMNS, GRID_ROW_HEIGHT } from "../types";
import type { Pad } from "../types";
import { formatDb, formatTime } from "../format";

const DOUBLE_TAP_MS = 400;
const CLICK_SLOP_PX = 5;

type PadGridProps = {
  pads: Pad[];
  voices: Record<string, VoiceInfo>;
  loading: string[];
  now: number;
  isEditing: boolean;
  scale: number;
  onPadsChange: (pads: Pad[]) => void;
  onFire: (pad: Pad) => void;
  onOpenDetail: (pad: Pad) => void;
  onDeleteRequest: (pad: Pad) => void;
};

type DragState = {
  padId: string;
  mode: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  start: { x: number; y: number; w: number; h: number };
  moved: boolean;
};

export function PadGrid({
  pads,
  voices,
  loading,
  now,
  isEditing,
  scale,
  onPadsChange,
  onFire,
  onOpenDetail,
  onDeleteRequest,
}: PadGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastTapRef = useRef<{ padId: string; time: number } | null>(null);
  const armTimerRef = useRef<number | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (armTimerRef.current) {
        window.clearTimeout(armTimerRef.current);
      }
    },
    [],
  );

  function canPlace(padId: string, rect: { x: number; y: number; w: number; h: number }) {
    return pads.every((pad) => pad.id === padId || !overlaps(rect, pad));
  }

  // ---- 編集モード: 移動・リサイズ ----

  function handleEditPointerDown(
    event: PointerEvent<HTMLElement>,
    pad: Pad,
    mode: DragState["mode"],
  ) {
    if (!isEditing || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      padId: pad.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: { x: pad.x, y: pad.y, w: pad.w, h: pad.h },
      moved: false,
    };
  }

  function handleEditPointerMove(event: PointerEvent<HTMLElement>, pad: Pad) {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!isEditing || !drag || !grid || drag.padId !== pad.id || drag.pointerId !== event.pointerId) {
      return;
    }

    const dxPx = event.clientX - drag.startClientX;
    const dyPx = event.clientY - drag.startClientY;
    if (!drag.moved && Math.abs(dxPx) + Math.abs(dyPx) < CLICK_SLOP_PX) {
      return;
    }
    drag.moved = true;

    const cellWidth = (grid.clientWidth * scale) / GRID_COLUMNS;
    const rowHeight = GRID_ROW_HEIGHT * scale;
    const dx = Math.round(dxPx / cellWidth);
    const dy = Math.round(dyPx / rowHeight);

    const next =
      drag.mode === "move"
        ? {
            x: clamp(drag.start.x + dx, 0, GRID_COLUMNS - pad.w),
            y: Math.max(0, drag.start.y + dy),
            w: pad.w,
            h: pad.h,
          }
        : {
            x: pad.x,
            y: pad.y,
            w: clamp(drag.start.w + dx, 1, GRID_COLUMNS - pad.x),
            h: clamp(drag.start.h + dy, 1, 12),
          };

    const changed = next.x !== pad.x || next.y !== pad.y || next.w !== pad.w || next.h !== pad.h;
    if (changed && canPlace(pad.id, next)) {
      onPadsChange(pads.map((item) => (item.id === pad.id ? { ...item, ...next } : item)));
    }
  }

  function handleEditPointerUp(event: PointerEvent<HTMLElement>, pad: Pad) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (drag.mode === "move" && !drag.moved && event.type === "pointerup") {
      onOpenDetail(pad);
    }
  }

  // ---- 本番モード: 2回押しで実行 ----

  function handlePlayPointerUp(event: PointerEvent<HTMLElement>, pad: Pad) {
    if (event.button !== 0) {
      return;
    }
    const time = window.performance.now();
    const last = lastTapRef.current;

    if (armTimerRef.current) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }

    if (last?.padId === pad.id && time - last.time <= DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      setArmedId(null);
      onFire(pad);
      return;
    }

    lastTapRef.current = { padId: pad.id, time };
    setArmedId(pad.id);
    armTimerRef.current = window.setTimeout(() => {
      setArmedId(null);
      armTimerRef.current = null;
    }, DOUBLE_TAP_MS);
  }

  const maxRow = pads.reduce((max, pad) => Math.max(max, pad.y + pad.h), 0);

  return (
    <div
      ref={gridRef}
      className={`pad-layout${isEditing ? " pad-layout--editing" : ""}`}
      style={
        {
          "--pad-scale": scale,
          "--pad-rows": Math.max(maxRow + (isEditing ? 4 : 0), 6),
        } as CSSProperties
      }
    >
      {pads.map((pad) => {
        const voice = voices[pad.id];
        const isLoading = loading.includes(pad.id);
        const status = statusOf(voice, now, isLoading);
        const { progress, timeLabel } = describeTime(pad, voice, now, status);

        const classNames = [
          "pad",
          `pad--${pad.category}`,
          status !== "idle" ? `pad--${status}` : "",
          armedId === pad.id ? "pad--armed" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <article
            key={pad.id}
            className={classNames}
            style={{
              gridColumn: `${pad.x + 1} / span ${pad.w}`,
              gridRow: `${pad.y + 1} / span ${pad.h}`,
            }}
            onPointerDown={(event) => handleEditPointerDown(event, pad, "move")}
            onPointerMove={(event) => handleEditPointerMove(event, pad)}
            onPointerUp={(event) =>
              isEditing ? handleEditPointerUp(event, pad) : handlePlayPointerUp(event, pad)
            }
            onPointerCancel={(event) => handleEditPointerUp(event, pad)}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="pad__meta">
              <span className="pad__category">{CATEGORY_LABEL[pad.category]}</span>
              {pad.loop ? <span className="pad__badge">LOOP</span> : null}
              {pad.replayGainDb != null && pad.useReplayGain !== false ? (
                <span className="pad__badge" title={`ReplayGain ${formatDb(pad.replayGainDb)}`}>
                  RG
                </span>
              ) : null}
              {pad.volumeDb !== 0 ? (
                <span className="pad__badge">{formatDb(pad.volumeDb)}</span>
              ) : null}
              <span className="pad__time">{timeLabel}</span>
            </div>
            <div className="pad__label">{pad.label || pad.fileName}</div>
            <div className="pad__file" title={pad.fileName}>
              {pad.fileName}
            </div>
            <div className="pad__progress">
              <span style={{ width: `${progress * 100}%` }} />
            </div>

            {isEditing ? (
              <>
                <button
                  type="button"
                  className="pad__delete"
                  aria-label={`${pad.label}を削除`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRequest(pad);
                  }}
                >
                  ×
                </button>
                <span
                  className="pad__resize"
                  aria-hidden="true"
                  onPointerDown={(event) => handleEditPointerDown(event, pad, "resize")}
                  onPointerMove={(event) => handleEditPointerMove(event, pad)}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    handleEditPointerUp(event, pad);
                  }}
                />
              </>
            ) : null}
          </article>
        );
      })}

      {pads.length === 0 ? (
        <p className="pad-layout__empty">右下の ＋ から音声ファイルを追加してください</p>
      ) : null}
    </div>
  );
}

type PadStatus = "idle" | "loading" | "waiting" | "playing" | "fading";

function statusOf(voice: VoiceInfo | undefined, now: number, isLoading: boolean): PadStatus {
  if (voice) {
    if (voice.fading) {
      return "fading";
    }
    return now < voice.startAt ? "waiting" : "playing";
  }
  return isLoading ? "loading" : "idle";
}

function describeTime(pad: Pad, voice: VoiceInfo | undefined, now: number, status: PadStatus) {
  if (!voice || status === "loading") {
    return {
      progress: 0,
      timeLabel: status === "loading" ? "読込中" : formatTime(pad.durationSec),
    };
  }
  if (status === "waiting") {
    return { progress: 0, timeLabel: `待機 ${(voice.startAt - now).toFixed(1)}` };
  }

  const elapsed = Math.max(0, now - voice.startAt);
  const position = voice.loop ? elapsed % voice.duration : Math.min(elapsed, voice.duration);
  const progress = voice.duration > 0 ? position / voice.duration : 0;

  if (status === "fading") {
    return { progress, timeLabel: "FADE" };
  }
  return {
    progress,
    timeLabel: voice.loop ? formatTime(position) : `-${formatTime(voice.duration - position)}`,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
