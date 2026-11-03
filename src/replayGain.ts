/**
 * 音声ファイルのメタタグから ReplayGain のトラックゲイン (dB) を読み取る。
 *
 * 形式ごとにタグ構造は違うが、どれもキー名の直後に "-6.54 dB" のような文字列で
 * 値が入っているため、キー名をバイト列から探して後続の値を拾う方式にしている。
 *   - MP3:  ID3v2 TXXX (Latin-1 / UTF-16) / APEv2
 *   - FLAC / Ogg Vorbis: Vorbis comment (REPLAYGAIN_TRACK_GAIN=...)
 *   - M4A:  iTunes freeform atom (----:com.apple.iTunes:replaygain_track_gain)
 *   - Opus: R128_TRACK_GAIN (Q7.8, -23 LUFS 基準) → ReplayGain 相当 (-18 LUFS) に換算
 */

const HEAD_BYTES = 4 * 1024 * 1024;
const TAIL_BYTES = 1024 * 1024;
const MAX_ID3_BYTES = 64 * 1024 * 1024;
const VALUE_WINDOW = 96;

const RG_KEY = ascii("REPLAYGAIN_TRACK_GAIN");
const R128_KEY = ascii("R128_TRACK_GAIN");

export async function readReplayGain(blob: Blob): Promise<number | null> {
  const fromChunks = await scanRiffLikeChunks(blob);
  if (fromChunks !== undefined) {
    return fromChunks;
  }

  const headLength = Math.min(blob.size, Math.max(HEAD_BYTES, await id3TagLength(blob)));
  const head = new Uint8Array(await blob.slice(0, headLength).arrayBuffer());
  const fromHead = scan(head);
  if (fromHead !== null) {
    return fromHead;
  }
  if (blob.size > headLength) {
    // M4A の moov が末尾にある場合や、MP3 末尾の APEv2 タグ
    const tailStart = Math.max(headLength, blob.size - TAIL_BYTES);
    return scan(new Uint8Array(await blob.slice(tailStart).arrayBuffer()));
  }
  return null;
}

const TAG_CHUNK_IDS = new Set(["id3 ", "ID3 ", "LIST"]);
const MAX_CHUNKS = 512;

/**
 * WAV (RIFF/RF64) / AIFF (FORM) のチャンクをたどり、id3 / LIST チャンクの中身を走査する。
 * WAV のタグは音声データの後ろに置かれることが多く、先頭・末尾の走査では届かないため。
 * 戻り値: WAV/AIFF でなければ undefined、WAV/AIFF ならタグの値または null。
 */
async function scanRiffLikeChunks(blob: Blob): Promise<number | null | undefined> {
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (header.length < 12) {
    return undefined;
  }
  const magic = text(header, 0, 4);
  const form = text(header, 8, 4);
  const isRiff = (magic === "RIFF" || magic === "RF64") && form === "WAVE";
  const isAiff = magic === "FORM" && (form === "AIFF" || form === "AIFC");
  if (!isRiff && !isAiff) {
    return undefined;
  }

  let offset = 12;
  for (let count = 0; count < MAX_CHUNKS && offset + 8 <= blob.size; count++) {
    const chunkHeader = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const id = text(chunkHeader, 0, 4);
    const view = new DataView(chunkHeader.buffer);
    let size = isRiff ? view.getUint32(4, true) : view.getUint32(4, false);
    if (size === 0xffffffff) {
      // RF64 の data チャンクはサイズが ds64 側にある。ここでは残り全部として打ち切る
      size = blob.size - offset - 8;
    }

    if (TAG_CHUNK_IDS.has(id)) {
      const body = new Uint8Array(
        await blob.slice(offset + 8, Math.min(blob.size, offset + 8 + size)).arrayBuffer(),
      );
      const value = scan(body);
      if (value !== null) {
        return value;
      }
    }
    offset += 8 + size + (size & 1);
  }
  return null;
}

function text(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** 先頭に ID3v2 タグがあれば、その全長 (カバー画像が大きくても TXXX を取りこぼさないため) */
async function id3TagLength(blob: Blob) {
  const header = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) {
    return 0;
  }
  const size = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
  return Math.min(size + 10, MAX_ID3_BYTES);
}

function scan(bytes: Uint8Array): number | null {
  for (const step of [1, 2] as const) {
    // step 2 は UTF-16LE/BE (ID3v2 TXXX のエンコーディング 1/2)
    for (const offset of findAll(bytes, RG_KEY, step)) {
      const value = parseDbValue(bytes, offset + RG_KEY.length * step);
      if (value !== null) {
        return value;
      }
    }
  }
  for (const offset of findAll(bytes, R128_KEY, 1)) {
    const value = parseR128Value(bytes, offset + R128_KEY.length);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** キーを大文字小文字無視で探す。step=2 なら 1 文字ごとに 0x00 を挟んだ並び (UTF-16) */
function* findAll(bytes: Uint8Array, key: Uint8Array, step: 1 | 2) {
  const span = key.length * step;
  const first = key[0];
  for (let i = 0; i + span <= bytes.length; i++) {
    if (upper(bytes[i]) !== first) {
      continue;
    }
    let ok = true;
    for (let k = 1; k < key.length; k++) {
      if (upper(bytes[i + k * step]) !== key[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      yield i;
    }
  }
}

function windowText(bytes: Uint8Array, start: number) {
  let text = "";
  const end = Math.min(bytes.length, start + VALUE_WINDOW * 2);
  for (let i = start; i < end && text.length < VALUE_WINDOW; i++) {
    if (bytes[i] !== 0) {
      text += String.fromCharCode(bytes[i]);
    }
  }
  return text;
}

function parseDbValue(bytes: Uint8Array, start: number) {
  // 区切り (= や \0) や M4A の data atom ヘッダを読み飛ばして最初の "数値 dB" を拾う
  const match = /([+-]?\d{1,3}(?:[.,]\d+)?)\s*dB/i.exec(windowText(bytes, start));
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && Math.abs(value) <= 60 ? value : null;
}

function parseR128Value(bytes: Uint8Array, start: number) {
  const match = /^=\s*([+-]?\d{1,6})/.exec(windowText(bytes, start));
  if (!match) {
    return null;
  }
  // R128 は -23 LUFS 基準、ReplayGain は -18 LUFS 相当なので +5 dB
  const value = Number(match[1]) / 256 + 5;
  return Number.isFinite(value) && Math.abs(value) <= 60 ? Math.round(value * 100) / 100 : null;
}

function upper(byte: number) {
  return byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte;
}

function ascii(text: string) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
