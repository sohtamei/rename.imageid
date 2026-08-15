(function () {
  "use strict";

  const MAKER_NOTE_TAG = 0x927c;
  const TARGET_TAG = 0x2043;
  const EXIF_IFD_POINTER_TAG = 0x8769;
  const EXIF_ID_PATTERN = /^[A-Za-z0-9.\-_'@!?#$%&*+/=^`{|}~"():;<>[\]\\ ]{1,128}$/;
  const TIFF_TYPE_SIZES = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8
  };
  const I18N = {
    ja: {
      documentTitle: "imageIDファイルコピー名作成",
      appTitle: "image ID付きファイルコピー作成",
      languageLabel: "言語",
      languageJa: "日本語",
      languageEn: "English",
      selectFiles: "画像ファイルを選択",
      dropHelp: "複数選択、またはここへドラッグ",
      separatorLabel: "区切り文字",
      skipMissingLabel: "IDがないファイルはZIPに入れない",
      clearButton: "クリア",
      metricTotal: "選択",
      metricReady: "ID検出",
      metricError: "エラー",
      thOriginal: "元ファイル",
      thCopy: "コピー名",
      thStatus: "状態",
      emptyMessage: "画像ファイルを選択すると解析結果が表示されます。",
      createZip: "ZIPを作成・保存",
      note: "JPG、RAW、HEIFファイルは再圧縮しません。Windows/macOS/iOSで保存できないファイル名文字は「_」に置き換えます。",
      notSelected: "未選択",
      readyCount: "{ready}/{total} 件準備完了",
      parsing: "解析中",
      readyStatus: "ID検出",
      unsupportedFile: "対応していないファイル形式です",
      targetMissing: "対象EXIFタグが見つかりません",
      parseFailed: "解析できませんでした"
    },
    en: {
      documentTitle: "imageID file copy renamer",
      appTitle: "Create file copies with image IDs",
      languageLabel: "Language",
      languageJa: "日本語",
      languageEn: "English",
      selectFiles: "Select image files",
      dropHelp: "Select multiple files, or drag them here",
      separatorLabel: "Separator",
      skipMissingLabel: "Do not include files without an ID in the ZIP",
      clearButton: "Clear",
      metricTotal: "Selected",
      metricReady: "IDs found",
      metricError: "Errors",
      thOriginal: "Original file",
      thCopy: "Copy name",
      thStatus: "Status",
      emptyMessage: "Select image files to show the analysis results.",
      createZip: "Create and save ZIP",
      note: "JPG, RAW, and HEIF files are not recompressed. Characters that cannot be used in Windows/macOS/iOS file names are replaced with “_”.",
      notSelected: "No files selected",
      readyCount: "{ready}/{total} ready",
      parsing: "Parsing",
      readyStatus: "ID found",
      unsupportedFile: "Unsupported file format",
      targetMissing: "Target EXIF tag was not found",
      parseFailed: "Could not parse the file"
    }
  };

  const state = {
    language: "ja",
    rows: [],
    zipBlob: null,
    zipUrl: "",
    zipFileName: "renamed-images.zip"
  };

  function readExifId(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 4) {
      throw exifError("unsupportedFile");
    }

    if (view.getUint16(0, false) === 0xffd8) {
      const value = readJpegExifId(view);
      if (value) {
        return value;
      }
      throw exifError("targetMissing");
    }

    if (getTiffEndian(view, 0) !== null) {
      const value = parseExifTiff(view, 0, view.byteLength);
      if (value) {
        return value;
      }
      throw exifError("targetMissing");
    }

    if (isIsoBaseMediaFile(view)) {
      const value = readHeifExifId(view);
      if (value) {
        return value;
      }
      throw exifError("targetMissing");
    }

    throw exifError("unsupportedFile");
  }

  function readJpegExifId(view) {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }

      while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
        offset += 1;
      }

      const marker = view.getUint8(offset);
      offset += 1;

      if (marker === 0xda || marker === 0xd9) {
        break;
      }

      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }

      if (offset + 2 > view.byteLength) {
        break;
      }

      const segmentLength = view.getUint16(offset, false);
      const segmentStart = offset + 2;
      const segmentEnd = offset + segmentLength;
      if (segmentLength < 2 || segmentEnd > view.byteLength) {
        break;
      }

      if (marker === 0xe1 && hasExifHeader(view, segmentStart, segmentEnd)) {
        const value = parseExifTiff(view, segmentStart + 6, segmentEnd);
        if (value) {
          return value;
        }
      }

      offset = segmentEnd;
    }

    return "";
  }

  function exifError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function hasExifHeader(view, start, end) {
    const signature = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    if (end - start < signature.length) {
      return false;
    }
    return signature.every((byte, index) => view.getUint8(start + index) === byte);
  }

  function isIsoBaseMediaFile(view) {
    return view.byteLength >= 12 && readAscii(view, 4, 4) === "ftyp";
  }

  function readAscii(view, offset, length) {
    if (!isRange(view, offset, length, view.byteLength)) {
      return "";
    }
    let value = "";
    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(view.getUint8(offset + index));
    }
    return value;
  }

  function readBox(view, offset, limit) {
    if (!isRange(view, offset, 8, limit)) {
      return null;
    }

    let size = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (!isRange(view, offset + 8, 8, limit)) {
        return null;
      }
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      size = high * 0x100000000 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = limit - offset;
    }

    if (size < headerSize || offset + size > limit) {
      return null;
    }

    return {
      start: offset,
      end: offset + size,
      type,
      contentStart: offset + headerSize
    };
  }

  function listBoxes(view, start, limit) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= limit) {
      const box = readBox(view, offset, limit);
      if (!box) {
        break;
      }
      boxes.push(box);
      offset = box.end;
    }
    return boxes;
  }

  function readHeifExifId(view) {
    const topBoxes = listBoxes(view, 0, view.byteLength);
    const metaBox = topBoxes.find((box) => box.type === "meta");
    if (!metaBox || metaBox.contentStart + 4 > metaBox.end) {
      return "";
    }

    const metaChildren = listBoxes(view, metaBox.contentStart + 4, metaBox.end);
    const itemTypes = readHeifItemTypes(view, metaChildren.find((box) => box.type === "iinf"));
    const exifItemId = [...itemTypes.entries()].find((entry) => entry[1] === "Exif")?.[0];
    if (!exifItemId) {
      return "";
    }

    const locations = readHeifItemLocations(view, metaChildren.find((box) => box.type === "iloc"));
    const location = locations.get(exifItemId);
    if (!location) {
      return "";
    }

    for (const extent of location.extents) {
      const start = location.baseOffset + extent.offset;
      const end = start + extent.length;
      if (!isRange(view, start, extent.length, view.byteLength)) {
        continue;
      }

      const tiffStart = findExifTiffStart(view, start, end);
      if (tiffStart >= 0) {
        const value = parseExifTiff(view, tiffStart, end);
        if (value) {
          return value;
        }
      }
    }

    return "";
  }

  function findExifTiffStart(view, start, end) {
    if (hasExifHeader(view, start, end)) {
      return start + 6;
    }

    if (isRange(view, start, 4, end)) {
      const headerOffset = view.getUint32(start, false);
      const headerStart = start + 4 + headerOffset;
      if (hasExifHeader(view, headerStart, end)) {
        return headerStart + 6;
      }
    }

    for (let offset = start; offset <= Math.min(start + 32, end - 8); offset += 1) {
      if (hasExifHeader(view, offset, end)) {
        return offset + 6;
      }
    }

    return -1;
  }

  function readHeifItemTypes(view, iinfBox) {
    const itemTypes = new Map();
    if (!iinfBox || iinfBox.contentStart + 6 > iinfBox.end) {
      return itemTypes;
    }

    const version = view.getUint8(iinfBox.contentStart);
    let offset = iinfBox.contentStart + 4;
    const entryCount = version === 0 ? view.getUint16(offset, false) : view.getUint32(offset, false);
    offset += version === 0 ? 2 : 4;

    for (let index = 0; index < entryCount && offset + 8 <= iinfBox.end; index += 1) {
      const box = readBox(view, offset, iinfBox.end);
      if (!box || box.type !== "infe") {
        break;
      }

      const infeVersion = view.getUint8(box.contentStart);
      let body = box.contentStart + 4;
      let itemId = 0;
      let itemType = "";
      if (infeVersion >= 2) {
        itemId = infeVersion >= 3 ? view.getUint32(body, false) : view.getUint16(body, false);
        body += infeVersion >= 3 ? 4 : 2;
        body += 2;
        itemType = readAscii(view, body, 4);
      }

      if (itemId && itemType) {
        itemTypes.set(itemId, itemType);
      }
      offset = box.end;
    }

    return itemTypes;
  }

  function readHeifItemLocations(view, ilocBox) {
    const locations = new Map();
    if (!ilocBox || ilocBox.contentStart + 8 > ilocBox.end) {
      return locations;
    }

    const version = view.getUint8(ilocBox.contentStart);
    let offset = ilocBox.contentStart + 4;
    const sizeByte = view.getUint8(offset);
    const offsetSize = sizeByte >> 4;
    const lengthSize = sizeByte & 0x0f;
    const baseByte = view.getUint8(offset + 1);
    const baseOffsetSize = baseByte >> 4;
    const indexSize = version === 1 || version === 2 ? baseByte & 0x0f : 0;
    offset += 2;

    const itemCount = version < 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
    offset += version < 2 ? 2 : 4;

    for (let itemIndex = 0; itemIndex < itemCount && offset < ilocBox.end; itemIndex += 1) {
      const itemId = version < 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
      offset += version < 2 ? 2 : 4;
      if (version === 1 || version === 2) {
        offset += 2;
      }
      offset += 2;
      const baseOffset = readSizedUint(view, offset, baseOffsetSize);
      offset += baseOffsetSize;
      const extentCount = view.getUint16(offset, false);
      offset += 2;

      const extents = [];
      for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
        if (indexSize) {
          offset += indexSize;
        }
        const extentOffset = readSizedUint(view, offset, offsetSize);
        offset += offsetSize;
        const extentLength = readSizedUint(view, offset, lengthSize);
        offset += lengthSize;
        extents.push({ offset: extentOffset, length: extentLength });
      }
      locations.set(itemId, { baseOffset, extents });
    }

    return locations;
  }

  function readSizedUint(view, offset, size) {
    if (size === 0) {
      return 0;
    }
    let value = 0;
    for (let index = 0; index < size; index += 1) {
      value = value * 256 + view.getUint8(offset + index);
    }
    return value;
  }

  function parseExifTiff(view, tiffStart, tiffEnd) {
    if (tiffStart + 8 > tiffEnd) {
      return "";
    }

    const littleEndian = getTiffEndian(view, tiffStart);
    if (littleEndian === null || view.getUint16(tiffStart + 2, littleEndian) !== 42) {
      return "";
    }

    const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
    const firstIfd = tiffStart + firstIfdOffset;
    const ifd0 = parseIfdEntries(view, firstIfd, tiffEnd, littleEndian);
    const exifPointer = ifd0.find((entry) => entry.tag === EXIF_IFD_POINTER_TAG);
    if (!exifPointer) {
      return "";
    }

    const exifIfdOffset = entryOffsetValue(view, exifPointer, littleEndian);
    const exifIfd = parseIfdEntries(view, tiffStart + exifIfdOffset, tiffEnd, littleEndian);
    const directTarget = exifIfd.find((entry) => entry.tag === TARGET_TAG);
    if (directTarget) {
      const decoded = readDecodedEntryString(view, directTarget, [tiffStart], tiffEnd, littleEndian);
      if (decoded) {
        return decoded;
      }
    }

    const makerNote = exifIfd.find((entry) => entry.tag === MAKER_NOTE_TAG);
    if (!makerNote) {
      return "";
    }

    const makerValueOffset = entryOffsetValue(view, makerNote, littleEndian);
    const makerStart = tiffStart + makerValueOffset;
    const makerSize = entryByteCount(makerNote);
    const makerEnd = Math.min(makerStart + makerSize, tiffEnd);
    return findTargetInMakerNote(view, makerStart, makerEnd, tiffStart, littleEndian);
  }

  function getTiffEndian(view, offset) {
    const byteOrder = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1));
    if (byteOrder === "II") {
      return true;
    }
    if (byteOrder === "MM") {
      return false;
    }
    return null;
  }

  function parseIfdEntries(view, ifdOffset, limit, littleEndian) {
    if (!isRange(view, ifdOffset, 2, limit)) {
      return [];
    }

    const count = view.getUint16(ifdOffset, littleEndian);
    if (count > 1024 || !isRange(view, ifdOffset + 2, count * 12, limit)) {
      return [];
    }

    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      entries.push({
        entryOffset,
        tag: view.getUint16(entryOffset, littleEndian),
        type: view.getUint16(entryOffset + 2, littleEndian),
        count: view.getUint32(entryOffset + 4, littleEndian)
      });
    }
    return entries;
  }

  function findTargetInMakerNote(view, makerStart, makerEnd, tiffStart, tiffLittleEndian) {
    if (!isRange(view, makerStart, 2, makerEnd)) {
      return "";
    }

    const candidates = new Set([makerStart, makerStart + 8, makerStart + 10, makerStart + 12]);
    for (let offset = makerStart; offset <= Math.min(makerStart + 64, makerEnd - 14); offset += 1) {
      const count = view.getUint16(offset, tiffLittleEndian);
      if (count > 0 && count < 512 && isRange(view, offset + 2, count * 12, makerEnd)) {
        candidates.add(offset);
      }
    }

    for (const ifdOffset of candidates) {
      for (const littleEndian of [tiffLittleEndian, !tiffLittleEndian]) {
        const entries = parseIfdEntries(view, ifdOffset, makerEnd, littleEndian);
        const target = entries.find((entry) => entry.tag === TARGET_TAG);
        if (!target) {
          continue;
        }
        const decoded = readDecodedEntryString(view, target, [tiffStart, makerStart], makerEnd, littleEndian);
        if (decoded) {
          return decoded;
        }
      }
    }

    return "";
  }

  function entryByteCount(entry) {
    const size = TIFF_TYPE_SIZES[entry.type] || 1;
    return entry.count * size;
  }

  function entryOffsetValue(view, entry, littleEndian) {
    return view.getUint32(entry.entryOffset + 8, littleEndian);
  }

  function readEntryBytes(view, entry, valueBases, limit, littleEndian) {
    const byteCount = entryByteCount(entry);
    if (byteCount <= 0 || byteCount > 1024 * 1024) {
      return new Uint8Array();
    }

    if (byteCount <= 4) {
      return new Uint8Array(view.buffer, view.byteOffset + entry.entryOffset + 8, byteCount);
    }

    const valueOffset = entryOffsetValue(view, entry, littleEndian);
    for (const base of valueBases) {
      const absolute = base + valueOffset;
      if (isRange(view, absolute, byteCount, limit)) {
        return new Uint8Array(view.buffer, view.byteOffset + absolute, byteCount);
      }
    }

    return new Uint8Array();
  }

  function readEntryByteCandidates(view, entry, valueBases, limit, littleEndian) {
    const byteCount = entryByteCount(entry);
    if (byteCount <= 0 || byteCount > 1024 * 1024) {
      return [];
    }

    if (byteCount <= 4) {
      return [new Uint8Array(view.buffer, view.byteOffset + entry.entryOffset + 8, byteCount)];
    }

    const valueOffset = entryOffsetValue(view, entry, littleEndian);
    const candidates = [];
    const seen = new Set();
    for (const base of valueBases) {
      const absolute = base + valueOffset;
      if (seen.has(absolute) || !isRange(view, absolute, byteCount, limit)) {
        continue;
      }
      seen.add(absolute);
      candidates.push(new Uint8Array(view.buffer, view.byteOffset + absolute, byteCount));
    }
    return candidates;
  }

  function readDecodedEntryString(view, entry, valueBases, limit, littleEndian) {
    const decodedValues = readEntryByteCandidates(view, entry, valueBases, limit, littleEndian)
      .map((bytes) => decodeUtf16Le(bytes))
      .filter(Boolean);

    const validValue = decodedValues.find(isValidExifId);
    return validValue || decodedValues[0] || "";
  }

  function isValidExifId(value) {
    return EXIF_ID_PATTERN.test(value) && !value.includes(",");
  }

  function isRange(view, offset, length, limit) {
    const rangeLimit = Math.min(limit, view.byteLength);
    return Number.isFinite(offset) && offset >= 0 && length >= 0 && offset + length <= rangeLimit;
  }

  function decodeUtf16Le(bytes) {
    if (!bytes || bytes.length < 2) {
      return "";
    }

    let end = bytes.length - (bytes.length % 2);
    if (end >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      bytes = bytes.slice(2);
      end = bytes.length - (bytes.length % 2);
    }

    for (let index = 0; index + 1 < end; index += 2) {
      if (bytes[index] === 0x00 && bytes[index + 1] === 0x00) {
        end = index;
        break;
      }
    }

    const trimmed = bytes.slice(0, end);
    try {
      return new TextDecoder("utf-16le").decode(trimmed).trim();
    } catch (error) {
      let result = "";
      for (let index = 0; index + 1 < trimmed.length; index += 2) {
        result += String.fromCharCode(trimmed[index] | (trimmed[index + 1] << 8));
      }
      return result.trim();
    }
  }

  function safeCopyName(originalName, exifId, separator) {
    const dotIndex = originalName.lastIndexOf(".");
    const base = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
    const extension = dotIndex > 0 ? originalName.slice(dotIndex) : ".jpg";
    const safeId = sanitizeFilePart(exifId);
    const safeBase = sanitizeFilePart(base) || "image";
    const safeSeparator = sanitizeFilePart(separator || "_") || "_";
    return `${safeBase}${safeSeparator}${safeId}${extension}`;
  }

  function sanitizeFilePart(value) {
    return String(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[., ]+$/g, "")
      .replace(/^\.+$/g, "_")
      .slice(0, 128);
  }

  function uniqueName(name, usedNames) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }

    const dotIndex = name.lastIndexOf(".");
    const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
    let index = 2;
    let candidate = `${base} (${index})${extension}`;
    while (usedNames.has(candidate)) {
      index += 1;
      candidate = `${base} (${index})${extension}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function createZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
    const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = new Uint8Array(file.buffer);
      const crc = crc32(dataBytes);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + dataBytes.length;
    }

    const centralStart = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralStart, true);

    return new Blob([...localParts, ...centralParts, endHeader], { type: "application/zip" });
  }

  function formatError(error) {
    if (error && error.code) {
      return t(error.code);
    }
    return error && error.message && I18N[state.language][error.message]
      ? t(error.message)
      : t("parseFailed");
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(isSupportedInputFile);
    state.rows = files.map((file) => ({
      file,
      originalName: file.name,
      buffer: null,
      exifId: "",
      copyName: "",
      statusKey: "parsing",
      statusText: "",
      level: "warn"
    }));
    resetDownload();
    render();

    for (const row of state.rows) {
      try {
        row.buffer = await row.file.arrayBuffer();
        row.exifId = readExifId(row.buffer);
        row.copyName = safeCopyName(row.originalName, row.exifId, getSeparator());
        row.statusKey = "readyStatus";
        row.statusText = "";
        row.level = "ready";
      } catch (error) {
        row.statusKey = "";
        row.statusText = formatError(error);
        row.level = "error";
      }
      render();
    }
  }

  function isSupportedInputFile(file) {
    return /\.(jpe?g|arw|hif|heif|heic)$/i.test(file.name)
      || file.type === "image/jpeg"
      || file.type === "image/heif"
      || file.type === "image/heic";
  }

  function getSeparator() {
    const input = document.getElementById("separator-input");
    return input ? input.value : "_";
  }

  function render() {
    const tbody = document.getElementById("file-table");
    const zipButton = document.getElementById("zip-button");
    const total = state.rows.length;
    const ready = state.rows.filter((row) => row.exifId).length;
    const errors = state.rows.filter((row) => row.level === "error").length;

    document.getElementById("metric-total").textContent = String(total);
    document.getElementById("metric-ready").textContent = String(ready);
    document.getElementById("metric-error").textContent = String(errors);
    document.getElementById("status-pill").textContent = total
      ? t("readyCount", { ready, total })
      : t("notSelected");
    zipButton.disabled = ready === 0;

    if (!total) {
      tbody.innerHTML = "";
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      const td = document.createElement("td");
      td.colSpan = 4;
      td.textContent = t("emptyMessage");
      tr.append(td);
      tbody.append(tr);
      return;
    }

    tbody.replaceChildren(...state.rows.map((row) => {
      if (row.exifId) {
        row.copyName = safeCopyName(row.originalName, row.exifId, getSeparator());
      }

      const tr = document.createElement("tr");
      tr.append(
        cell(row.originalName),
        cell(row.exifId || "-"),
        cell(row.copyName || "-"),
        statusCell(row.statusText || t(row.statusKey), row.level)
      );
      return tr;
    }));
  }

  function t(key, replacements) {
    const dictionary = I18N[state.language] || I18N.ja;
    let value = dictionary[key] || I18N.ja[key] || key;
    if (replacements) {
      for (const [name, replacement] of Object.entries(replacements)) {
        value = value.replace(`{${name}}`, String(replacement));
      }
    }
    return value;
  }

  function detectInitialLanguage() {
    if (typeof navigator === "undefined") {
      return "ja";
    }
    const language = (navigator.language || "").toLowerCase();
    return language.startsWith("ja") ? "ja" : "en";
  }

  function applyLanguage(language) {
    state.language = I18N[language] ? language : "ja";
    document.documentElement.lang = state.language;
    document.title = t("documentTitle");

    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });

    const select = document.getElementById("language-select");
    if (select) {
      select.value = state.language;
    }
    render();
  }

  function cell(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function statusCell(text, level) {
    const td = document.createElement("td");
    const span = document.createElement("span");
    span.className = `status ${level}`;
    span.textContent = text;
    td.append(span);
    return td;
  }

  function resetDownload() {
    if (state.zipUrl) {
      URL.revokeObjectURL(state.zipUrl);
    }
    state.zipBlob = null;
    state.zipUrl = "";
  }

  async function buildZip() {
    const skipMissing = document.getElementById("skip-missing-input").checked;
    const usedNames = new Set();
    const files = [];

    for (const row of state.rows) {
      if (!row.buffer) {
        continue;
      }
      if (!row.exifId && skipMissing) {
        continue;
      }

      const exifId = row.exifId || "NO_EXIF_ID";
      const name = uniqueName(safeCopyName(row.originalName, exifId, getSeparator()), usedNames);
      files.push({ name, buffer: row.buffer });
    }

    if (!files.length) {
      return;
    }

    resetDownload();
    state.zipBlob = createZip(files);
    const url = URL.createObjectURL(state.zipBlob);
    state.zipUrl = url;
    state.zipFileName = `renamed-images-${new Date().toISOString().slice(0, 10)}.zip`;
    const link = document.createElement("a");
    link.href = url;
    link.download = state.zipFileName;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function initUi() {
    const input = document.getElementById("file-input");
    const dropZone = document.getElementById("drop-zone");

    document.getElementById("language-select").addEventListener("change", (event) => {
      applyLanguage(event.target.value);
    });
    input.addEventListener("change", () => handleFiles(input.files));
    document.getElementById("separator-input").addEventListener("input", () => {
      resetDownload();
      render();
    });
    document.getElementById("skip-missing-input").addEventListener("change", resetDownload);
    document.getElementById("clear-button").addEventListener("click", () => {
      input.value = "";
      state.rows = [];
      resetDownload();
      render();
    });
    document.getElementById("zip-button").addEventListener("click", buildZip);

    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("is-dragging");
      });
    });
    dropZone.addEventListener("drop", (event) => {
      handleFiles(event.dataTransfer.files);
    });
    applyLanguage(detectInitialLanguage());
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", initUi);
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.ExifRenameCore = {
    createZip,
    decodeUtf16Le,
    readExifId,
    safeCopyName,
    sanitizeFilePart,
    uniqueName
  };
})();
