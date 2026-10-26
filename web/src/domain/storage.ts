// How full the sync server is, for Settings (212). The Worker reports its database's size, pictures
// included (their files live in the same database). Cloudflare's limit per database on the Workers Free
// plan: its FAQ says 1 GB, its limits table 10 GB (and 5 GB per account), so 1 GB until that's settled.
// At the limit, saving fails (SQLITE_FULL) and reading keeps working.

export const STORAGE_LIMIT = 1024 ** 3;
/** From this share of the limit on, Settings warns. */
export const STORAGE_WARN = 0.8;

/** "820 KB", "42 MB", "4.2 MB", "1 GB", "1.2 GB". */
export function sizeText(bytes: number): string {
  const [n, unit] = bytes >= 1024 ** 3 ? [bytes / 1024 ** 3, "GB"] : bytes >= 1024 ** 2 ? [bytes / 1024 ** 2, "MB"] : [bytes / 1024, "KB"];
  const shown = n >= 10 || unit === "KB" ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  return `${shown} ${unit}`;
}

/** "42 MB of 1 GB", the share used (0–1) and whether to warn. */
export function storageUse(bytes: number, limit = STORAGE_LIMIT): { text: string; share: number; warn: boolean } {
  const share = Math.min(1, Math.max(0, bytes / limit));
  return { text: `${sizeText(bytes)} of ${sizeText(limit)}`, share, warn: share >= STORAGE_WARN };
}
