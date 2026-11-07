// A photo's own details from its JPEG EXIF block (379): when it was taken, the camera, its size and where. Read on
// the device when the photo is added (the stored copy is re-encoded and has none), and kept only on that device.

export interface PhotoInfo {
  /** When it was taken, as the camera wrote it (local time, no zone): "2026:11:03 14:05:12". */
  taken?: string;
  /** The camera, e.g. "Pixel 6a" (the make is added when the model doesn't say it). */
  camera?: string;
  /** The original's size in pixels, before the app shrank it. */
  width?: number; height?: number;
  /** Where, in degrees (south and west negative). */
  lat?: number; lng?: number;
}

const TAG = { make: 0x010f, model: 0x0110, dateTime: 0x0132, exifIfd: 0x8769, gpsIfd: 0x8825, original: 0x9003, pxW: 0xa002, pxH: 0xa003 };

/** The EXIF details of a JPEG file's bytes; an empty object when it has none (or isn't a JPEG). */
export function readExif(buf: ArrayBuffer): PhotoInfo {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let at = 2;
  while (at + 4 <= v.byteLength) {
    const marker = v.getUint16(at);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // the image data starts: no EXIF before it
    const len = v.getUint16(at + 2);
    if (marker === 0xffe1 && at + 10 <= v.byteLength && v.getUint32(at + 4) === 0x45786966) { // "Exif"
      try { return readTiff(v, at + 10, Math.min(v.byteLength, at + 2 + len)); } catch { return {}; }
    }
    at += 2 + len;
  }
  return {};
}

function readTiff(v: DataView, base: number, end: number): PhotoInfo {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  const inside = (o: number, n: number) => base + o >= base && base + o + n <= end;
  /** One IFD's entries: tag → [type, count, value offset (or the value's own place)]. */
  const ifd = (o: number) => {
    const out = new Map<number, { type: number; count: number; at: number }>();
    if (!inside(o, 2)) return out;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (!inside(e, 12)) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] ?? 1;
      out.set(u16(e), { type, count, at: size * count > 4 ? u32(e + 8) : e + 8 });
    }
    return out;
  };
  type Entry = { type: number; count: number; at: number } | undefined;
  const text = (x: Entry) => {
    if (!x || x.type !== 2 || !inside(x.at, x.count)) return undefined;
    let s = "";
    for (let i = 0; i < x.count; i++) { const c = v.getUint8(base + x.at + i); if (!c) break; s += String.fromCharCode(c); }
    return s.trim() || undefined;
  };
  const num = (x: Entry) => (!x ? undefined : x.type === 3 ? u16(x.at) : x.type === 4 ? u32(x.at) : undefined);
  const rationals = (x: Entry) => {
    if (!x || x.type !== 5 || !inside(x.at, 8 * x.count)) return undefined;
    return Array.from({ length: x.count }, (_, i) => { const d = u32(x.at + i * 8 + 4); return d ? u32(x.at + i * 8) / d : 0; });
  };
  if (u16(2) !== 42) return {};
  const zero = ifd(u32(4));
  const exifAt = num(zero.get(TAG.exifIfd));
  const exif = exifAt !== undefined ? ifd(exifAt) : new Map();
  const gpsAt = num(zero.get(TAG.gpsIfd));
  const gps = gpsAt !== undefined ? ifd(gpsAt) : new Map();
  const info: PhotoInfo = {};
  const taken = text(exif.get(TAG.original)) ?? text(zero.get(TAG.dateTime));
  if (taken && /^\d{4}:\d\d:\d\d \d\d:\d\d/.test(taken)) info.taken = taken;
  const make = text(zero.get(TAG.make)), model = text(zero.get(TAG.model));
  if (model) info.camera = make && !model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0]) ? `${make} ${model}` : model;
  const w = num(exif.get(TAG.pxW)), h = num(exif.get(TAG.pxH));
  if (w && h) { info.width = w; info.height = h; }
  const deg = (r: number[] | undefined) => (r && r.length >= 3 ? r[0] + r[1] / 60 + r[2] / 3600 : undefined);
  const lat = deg(rationals(gps.get(2))), lng = deg(rationals(gps.get(4)));
  if (lat !== undefined && lng !== undefined && (lat || lng)) {
    info.lat = text(gps.get(1)) === "S" ? -lat : lat;
    info.lng = text(gps.get(3)) === "W" ? -lng : lng;
  }
  return info;
}

/** "2026:11:03 14:05:12" as a local Date. */
export function takenDate(taken: string): Date | null {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)(?::(\d\d))?/.exec(taken);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) : null;
}

/** The details line(s) shown for a photo: when (taken, else added), the camera, the size, where. */
export function photoLines(info: PhotoInfo | null, added: Date, size: { width: number; height: number }, fmt: (d: Date) => string): string[] {
  const taken = info?.taken ? takenDate(info.taken) : null;
  const lines = [taken ? `Taken ${fmt(taken)}` : `Added ${fmt(added)}`];
  if (taken) lines.push(`Added ${fmt(added)}`);
  if (info?.camera) lines.push(info.camera);
  const w = info?.width ?? size.width, h = info?.height ?? size.height;
  lines.push(`${w} × ${h}${w * h >= 1e6 ? ` · ${(w * h / 1e6).toFixed(1)} MP` : ""}`);
  if (info?.lat !== undefined && info?.lng !== undefined) lines.push(`${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}`);
  return lines;
}
