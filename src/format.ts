export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) {
    return "0:00";
  }
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDb(db: number) {
  if (db <= -60) {
    return "-∞ dB";
  }
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

export function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}
