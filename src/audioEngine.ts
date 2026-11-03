import { effectiveGainDb } from "./types";
import type { Category, Pad } from "./types";

/** SE を止めるときのごく短いフェード (プチノイズ防止) */
const SE_STOP_FADE_SEC = 0.04;
/** 全停止時のフェード */
const PANIC_FADE_SEC = 0.08;

export type VoiceInfo = {
  padId: string;
  category: Category;
  /** AudioContext 時刻で再生が始まる時刻 (頭の空白を含む) */
  startAt: number;
  duration: number;
  loop: boolean;
  fading: boolean;
};

export type EngineSnapshot = {
  /** padId ごとの再生状態 (停止中のボタンは含まない) */
  voices: Record<string, VoiceInfo>;
  /** デコード中の padId */
  loading: string[];
};

type Voice = VoiceInfo & {
  source: AudioBufferSourceNode;
  fadeGain: GainNode;
  volumeGain: GainNode;
  fadeEndAt: number;
};

type SinkCapableContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export function dbToGain(db: number) {
  return db <= -60 ? 0 : Math.pow(10, db / 20);
}

export const supportsOutputSelection =
  typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

export class AudioEngine {
  private ctx: SinkCapableContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voices = new Set<Voice>();
  private loading = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot = { voices: {}, loading: [] };
  /** BGM のリクエスト世代。新しい BGM が押されたら古いデコード待ちを破棄する */
  private bgmToken = 0;
  private sinkId = "";
  private masterDb = 0;
  fadeOutSec = 2;

  constructor(private readonly loadBlob: (fileId: string) => Promise<Blob | undefined>) {}

  // ---- 外部ストア (useSyncExternalStore 用) ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  now() {
    return this.ctx?.currentTime ?? 0;
  }

  private emit() {
    const voices: Record<string, VoiceInfo> = {};
    for (const voice of this.voices) {
      const current = voices[voice.padId];
      // 同じボタンでフェード中と再生中が重なったら再生中を優先して表示
      if (!current || (current.fading && !voice.fading)) {
        voices[voice.padId] = {
          padId: voice.padId,
          category: voice.category,
          startAt: voice.startAt,
          duration: voice.duration,
          loop: voice.loop,
          fading: voice.fading,
        };
      }
    }
    this.snapshot = { voices, loading: [...this.loading] };
    this.listeners.forEach((listener) => listener());
  }

  // ---- コンテキスト / 出力 ----

  private getContext(): SinkCapableContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" }) as SinkCapableContext;
      const master = ctx.createGain();
      master.gain.value = dbToGain(this.masterDb);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      if (this.sinkId) {
        void this.applySink().catch(() => undefined);
      }
    }
    return this.ctx;
  }

  private async applySink() {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    if (!ctx.setSinkId) {
      throw new Error("このブラウザは出力デバイスの選択に対応していません (Chrome / Edge 推奨)");
    }
    await ctx.setSinkId(this.sinkId);
  }

  async setOutputDevice(deviceId: string) {
    this.sinkId = deviceId;
    // コンテキスト未作成なら作成時に適用される
    if (this.ctx) {
      await this.applySink();
    } else if (deviceId && !supportsOutputSelection) {
      throw new Error("このブラウザは出力デバイスの選択に対応していません (Chrome / Edge 推奨)");
    }
  }

  setMasterVolume(db: number) {
    this.masterDb = db;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.03);
    }
  }

  /** db は ReplayGain 込みの実効ゲイン */
  setPadVolume(padId: string, db: number) {
    if (!this.ctx) {
      return;
    }
    for (const voice of this.voices) {
      if (voice.padId === padId) {
        voice.volumeGain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.03);
      }
    }
  }

  playTestTone() {
    const ctx = this.getContext();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + 0.02;
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
    gain.gain.setValueAtTime(0.25, t + 0.4);
    gain.gain.linearRampToValueAtTime(0, t + 0.42);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  // ---- デコード ----

  decode(fileId: string): Promise<AudioBuffer> {
    let promise = this.buffers.get(fileId);
    if (!promise) {
      promise = (async () => {
        const blob = await this.loadBlob(fileId);
        if (!blob) {
          throw new Error("音声ファイルが見つかりません。ファイルを差し替えてください");
        }
        return this.getContext().decodeAudioData(await blob.arrayBuffer());
      })();
      this.buffers.set(fileId, promise);
      promise.catch(() => this.buffers.delete(fileId));
    }
    return promise;
  }

  /** 追加時のバリデーション兼ねてデコードし、キャッシュにも載せる */
  async decodeNewFile(fileId: string, blob: Blob) {
    const buffer = await this.getContext().decodeAudioData(await blob.arrayBuffer());
    this.buffers.set(fileId, Promise.resolve(buffer));
    return buffer;
  }

  forget(fileId: string) {
    this.buffers.delete(fileId);
  }

  // ---- 再生制御 ----

  private activeVoice(padId: string) {
    for (const voice of this.voices) {
      if (voice.padId === padId && !voice.fading) {
        return voice;
      }
    }
    return null;
  }

  /** ボタン実行: 停止中なら再生、再生中(待機中含む)なら停止 */
  async trigger(pad: Pad) {
    if (this.loading.has(pad.id)) {
      return;
    }
    const active = this.activeVoice(pad.id);
    if (active) {
      this.fade(active, pad.category === "bgm" ? this.fadeOutSec : SE_STOP_FADE_SEC);
      this.emit();
      return;
    }
    await this.play(pad);
  }

  async play(pad: Pad) {
    const ctx = this.getContext();
    if (ctx.state !== "running") {
      void ctx.resume();
    }

    let readyAt = ctx.currentTime;
    let token = 0;

    if (pad.category === "bgm") {
      // 前の BGM をフェードアウトし、消え終わる時刻を待ち合わせ点にする
      token = ++this.bgmToken;
      for (const voice of [...this.voices]) {
        if (voice.category !== "bgm") {
          continue;
        }
        if (!voice.fading) {
          this.fade(voice, this.fadeOutSec);
        }
        if (this.voices.has(voice)) {
          readyAt = Math.max(readyAt, voice.fadeEndAt);
        }
      }
    }

    this.loading.add(pad.id);
    this.emit();

    let buffer: AudioBuffer;
    try {
      buffer = await this.decode(pad.fileId);
    } catch (error) {
      this.loading.delete(pad.id);
      this.emit();
      throw error;
    }
    this.loading.delete(pad.id);

    if (pad.category === "bgm" && token !== this.bgmToken) {
      // デコード中に別の BGM が押された / 停止された
      this.emit();
      return;
    }

    const startAt = Math.max(readyAt, ctx.currentTime + 0.02) + Math.max(0, pad.leadInSec);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = pad.loop;
    const fadeGain = ctx.createGain();
    const volumeGain = ctx.createGain();
    volumeGain.gain.value = dbToGain(effectiveGainDb(pad));
    source.connect(fadeGain).connect(volumeGain).connect(this.master!);

    const voice: Voice = {
      padId: pad.id,
      category: pad.category,
      startAt,
      duration: buffer.duration,
      loop: pad.loop,
      fading: false,
      fadeEndAt: Infinity,
      source,
      fadeGain,
      volumeGain,
    };

    source.onended = () => {
      if (this.voices.delete(voice)) {
        this.emit();
      }
      source.disconnect();
      volumeGain.disconnect();
    };

    source.start(startAt);
    this.voices.add(voice);
    this.emit();
  }

  private fade(voice: Voice, fadeSec: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    if (now < voice.startAt) {
      // まだ鳴り始めていない (頭の空白中) → 即キャンセル
      try {
        voice.source.stop();
      } catch {
        // already stopped
      }
      this.voices.delete(voice);
      return;
    }

    voice.fading = true;
    voice.fadeEndAt = now + fadeSec;
    const gain = voice.fadeGain.gain;
    const current = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    gain.linearRampToValueAtTime(0, now + fadeSec);
    try {
      voice.source.stop(now + fadeSec + 0.02);
    } catch {
      // already stopped
    }
  }

  /** 指定ボタンの音を止める (再生していなければ何もしない) */
  stopPad(padId: string) {
    const voice = this.activeVoice(padId);
    if (voice) {
      this.fade(voice, voice.category === "bgm" ? this.fadeOutSec : SE_STOP_FADE_SEC);
      this.emit();
    }
  }

  stopCategory(category: Category) {
    if (!this.ctx) {
      return;
    }
    if (category === "bgm") {
      this.bgmToken++;
    }
    for (const voice of [...this.voices]) {
      if (voice.category === category && !voice.fading) {
        this.fade(voice, category === "bgm" ? this.fadeOutSec : SE_STOP_FADE_SEC);
      }
    }
    this.emit();
  }

  stopAll() {
    if (!this.ctx) {
      return;
    }
    this.bgmToken++;
    for (const voice of [...this.voices]) {
      if (!voice.fading || voice.fadeEndAt - this.ctx.currentTime > PANIC_FADE_SEC) {
        this.fade(voice, PANIC_FADE_SEC);
      }
    }
    this.emit();
  }
}
