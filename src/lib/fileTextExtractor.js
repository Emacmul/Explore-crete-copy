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
 */
async function extractZipEntry(arrayBuffer, targetName) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  let offset = 0;

  while (offset < bytes.length - 4) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);
    const filename = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + filenameLength));
    const dataOffset = offset + 30 + filenameLength + extraFieldLength;

    if (filename === targetName) {
      const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);

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

    offset = dataOffset + compressedSize;
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