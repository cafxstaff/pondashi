import { useCallback, useEffect, useState } from "react";

import { supportsOutputSelection } from "../audioEngine";
import type { AppSettings } from "../types";
import { Modal } from "./Modal";

type SettingsModalProps = {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onTestTone: () => void;
  onClose: () => void;
};

export function SettingsModal({ settings, onChange, onTestTone, onClose }: SettingsModalProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((device) => device.kind === "audiooutput"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  async function unlockDeviceNames() {
    // Chrome はマイク許可がないとデバイス名・ID を返さないため、一度だけ許可を取る
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMessage(null);
      await refreshDevices();
    } catch {
      setMessage("マイクの許可が得られなかったため、デバイス名を取得できませんでした");
    }
  }

  const hasNames = devices.some((device) => device.label);
  const knownIds = new Set(devices.map((device) => device.deviceId));

  return (
    <Modal eyebrow="Settings" title="設定" onClose={onClose}>
      <div className="form">
        <div className="field">
          <span>出力デバイス</span>
          {supportsOutputSelection ? (
            <>
              <select
                value={settings.outputDeviceId}
                onChange={(event) => onChange({ outputDeviceId: event.target.value })}
              >
                <option value="">システム既定</option>
                {devices
                  .filter((device) => device.deviceId && device.deviceId !== "default")
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `出力デバイス ${index + 1}`}
                    </option>
                  ))}
                {settings.outputDeviceId && !knownIds.has(settings.outputDeviceId) ? (
                  <option value={settings.outputDeviceId}>（保存済みのデバイス・未検出）</option>
                ) : null}
              </select>
              <div className="inline-actions">
                {!hasNames ? (
                  <button type="button" className="ghost-button" onClick={() => void unlockDeviceNames()}>
                    デバイス一覧を取得（マイク許可）
                  </button>
                ) : null}
                <button type="button" className="ghost-button" onClick={() => void refreshDevices()}>
                  再読み込み
                </button>
                <button type="button" className="ghost-button" onClick={onTestTone}>
                  テスト音
                </button>
              </div>
            </>
          ) : (
            <p className="form-error">
              このブラウザは出力デバイスの選択に対応していません。Chrome / Edge で開いてください。
            </p>
          )}
          {message ? <small>{message}</small> : null}
        </div>

        <label className="field">
          <span>BGM フェードアウト時間 (秒)</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={settings.fadeOutSec}
            onChange={(event) =>
              onChange({ fadeOutSec: Math.max(0, Number(event.target.value) || 0) })
            }
          />
          <small>BGM の切り替え・BGM 停止時に使います</small>
        </label>

        <div className="hint">
          <strong>操作</strong>
          <ul>
            <li>ボタンを 2 回押すと再生。再生中のボタンを 2 回押すと停止（BGM はフェードアウト）</li>
            <li>Esc キーで全停止</li>
            <li>編集モード: ドラッグで移動、右下の角でサイズ変更、クリックで詳細設定</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
