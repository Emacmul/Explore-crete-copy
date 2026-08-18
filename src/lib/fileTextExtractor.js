/**
 * Extracts plain text from .txt, .docx, and .odt files entirely in the browser.
 * .docx and .odt are ZIP archives containing XML; we parse them using
 * built-in DecompressionStream and DOMParser — no external dependencies.
 */

const TEXT_EXTENSIONS = ['.txt', '.text', '.md'];
const DOCX_EXTENSIONS = ['.docx'];
const ODT_EXTENSIONS = ['.odt'];
const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...DOCX_EXTENSIONS, ...ODT_EXTENSIONS];

export function getFileInfo(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  return { ext, isText: TEXT_EXTENSIONS.includes(ext), isDocx: DOCX_EXTENSIONS.includes(ext), isOdt: ODT_EXTENSIONS.includes(ext) };
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

/**
 * Extract a single entry from a ZIP archive (stored or deflated).
 *
 * Reads the ZIP's Central Directory (a table of contents sitting at the END of the
 * file) rather than scanning the per-entry Local File Headers scattered throughout it.
 * This matters: some ZIP writers — including some versions of LibreOffice's .odt export
 * — don't reliably fill in the compressed-size field in a Local File Header (it can be
 * left as 0, with the real size written later in a trailing "data descriptor" instead).
 * Reading that unreliable field, as this used to, silently truncates the extracted text
 * to whatever that wrong number said — the earlier version of this bug: a real,
 * correctly-formatted beginning that just stops partway through, with nothing further
 * for a scrollbar to reach. The Central Directory's size field is always authoritative,
 * regardless of how the entry was originally written, which is what every real ZIP
 * reader actually relies on for this reason.
 */
async function extractZipEntry(arrayBuffer, targetName) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  // Find "End of Central Directory" (signature 0x06054b50), searching backward from the
  // end — it's always the last thing in a valid ZIP, but may be preceded by a short
  // comment field, so it isn't at a fixed offset.
  let eocdOffset = -1;
  const searchFloor = Math.max(0, bytes.length - 65557); // max comment length + EOCD record size
  for (let i = bytes.length - 22; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Could not find the end of the archive — this file may be corrupted or not a real .docx/.odt file.');

  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);

  // Walk Central Directory entries (signature 0x02014b50) looking for the target file.
  let offset = centralDirOffset;
  const centralDirEnd = centralDirOffset + centralDirSize;
  while (offset < centralDirEnd) {
    if (view.getUint32(offset, true) !== 0x02014b50) break; // malformed — stop rather than scan forever

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true); // authoritative, unlike the local header's copy
    const filenameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const filename = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + filenameLength));

    if (filename === targetName) {
      // Jump to the Local File Header just to find where the actual compressed bytes
      // start (its own filename/extra-field lengths determine that) — its size field is
      // deliberately ignored in favor of the reliable one just read above.
      const localFilenameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraFieldLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraFieldLength;
      const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder().decode(compressedData);
      }
      if (compressionMethod === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compressedData]).stream().pipeThrough(ds);
        return await new Response(stream).text();
      }
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
    }

    offset += 46 + filenameLength + extraFieldLength + commentLength;
  }

  return null;
}

function extractTextFromDocxXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const paragraphs = doc.getElementsByTagName('w:p');
  const lines = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const textNodes = paragraphs[i].getElementsByTagName('w:t');
    let paraText = '';
    for (let j = 0; j < textNodes.length; j++) {
      paraText += textNodes[j].textContent;
    }
    if (paraText.trim()) lines.push(paraText);
  }
  return lines.join('\n');
}

function extractTextFromOdtXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const paragraphs = [...doc.getElementsByTagName('text:p'), ...doc.getElementsByTagName('text:h')];
  const lines = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i].textContent;
    if (text.trim()) lines.push(text);
  }
  return lines.join('\n');
}

export async function extractTextFromFile(file) {
  const { ext, isText, isDocx, isOdt } = getFileInfo(file.name);

  if (!SUPPORTED_EXTENSIONS.includes(ext) && !file.type.startsWith('text/')) {
    throw new Error(`Unsupported format "${ext}". Use .txt, .docx, or .odt files.`);
  }

  // Plain text — read directly
  if (isText || (file.type.startsWith('text/') && !isDocx && !isOdt)) {
    return await readAsText(file);
  }

  // .docx — extract word/document.xml from the ZIP
  if (isDocx) {
    const buffer = await file.arrayBuffer();
    const xml = await extractZipEntry(buffer, 'word/document.xml');
    if (!xml) throw new Error('Could not find document content inside the .docx file.');
    return extractTextFromDocxXml(xml);
  }

  // .odt — extract content.xml from the ZIP
  if (isOdt) {
    const buffer = await file.arrayBuffer();
    const xml = await extractZipEntry(buffer, 'content.xml');
    if (!xml) throw new Error('Could not find document content inside the .odt file.');
    return extractTextFromOdtXml(xml);
  }

  throw new Error(`Unsupported file format: ${ext}`);
}