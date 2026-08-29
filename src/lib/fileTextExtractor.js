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

// Word and LibreOffice both routinely produce document XML containing a bare "&" —
// completely ordinary in real writing ("Fish & Chips", "Rest & Recharge") but invalid
// on its own in XML, which requires it to be written as "&amp;". A single one of these,
// anywhere in the whole document, makes the strict browser XML parser stop dead at that
// exact point and silently discard everything after it — the actual cause of a script
// that "imports fine, then just stops partway through with nothing further to scroll to."
// Escapes only genuinely bare ampersands; entities already written correctly (&amp;,
// &lt;, &#39;, etc.) are left completely alone, so nothing gets double-escaped.
function sanitizeXmlEntities(xmlString) {
  return xmlString.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
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

// Word represents a Tab keypress (routinely used to nudge word spacing, or just habit
// from someone who normally aligns things in a table) as its own empty <w:tab/> element,
// completely separate from any <w:t> text — visually it's just a gap, identical to a
// space, so nobody reviewing the document in Word would ever notice anything's different
// about it. The previous extraction only ever read <w:t> content (via
// getElementsByTagName('w:t'), flattened across the whole paragraph) and silently
// ignored everything else — so every one of these tab-gaps between words vanished
// completely on import, with nothing left behind at all. This is the actual cause of
// "quite a few spaces between words get skipped" even though the master file "does not
// have those errors in it" — the file is genuinely fine; the extractor was dropping
// real content it never looked for. Walking the paragraph's actual child structure
// (recursing into runs, hyperlinks, etc.) instead of flattening straight to <w:t> is
// what lets a <w:tab/> or <w:br/> sitting between two <w:t> elements get counted at all.
function extractDocxParagraphText(paragraphEl) {
  let text = '';
  const visit = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      const tag = child.nodeName;
      if (tag === 'w:t') {
        text += child.textContent;
      } else if (tag === 'w:tab') {
        text += ' ';
      } else if (tag === 'w:br' || tag === 'w:cr') {
        text += '\n';
      } else if (child.childNodes && child.childNodes.length) {
        // w:delText (track-changes deletions) is deliberately NOT matched above, so it
        // falls through here — its child is a plain text node with no children of its
        // own, so recursing into it contributes nothing, correctly excluding deleted text
        // exactly as the original getElementsByTagName('w:t')-only approach did.
        visit(child);
      }
    }
  };
  visit(paragraphEl);
  return text;
}

function extractTextFromDocxXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizeXmlEntities(xml), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('This .docx file contains something the browser\'s XML reader couldn\'t parse. Try re-saving it from Word as a plain .txt file instead.');
  }
  const paragraphs = doc.getElementsByTagName('w:p');
  const lines = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const paraText = extractDocxParagraphText(paragraphs[i]);
    if (paraText.trim()) lines.push(paraText);
  }
  return lines.join('\n');
}

// ODF has the same tab/line-break gap as DOCX (<text:tab/>, <text:line-break/> are their
// own empty elements, invisible to a plain .textContent read) — but it also has a second,
// ODF-specific gap that's an even more likely cause of "quite a few spaces... skipped":
// two or more CONSECUTIVE spaces can't be reliably represented as literal characters in
// ODF's XML at all, so the format has a dedicated <text:s text:c="N"/> element just to
// say "N spaces go here" (common after periods with double-spacing, or any deliberate
// extra gap). The previous extraction used the whole paragraph's plain .textContent,
// which — like the DOCX version — only ever sees real text nodes and completely misses
// every one of these, dropping the gap entirely rather than shrinking it to one space.
function extractOdtParagraphText(paragraphEl) {
  let text = '';
  const visit = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      const tag = child.nodeName;
      if (tag === '#text') {
        text += child.textContent;
      } else if (tag === 'text:tab') {
        text += ' ';
      } else if (tag === 'text:line-break') {
        text += '\n';
      } else if (tag === 'text:s') {
        const count = parseInt(child.getAttribute('text:c') || '1', 10);
        text += ' '.repeat(Number.isFinite(count) && count > 0 ? count : 1);
      } else if (child.childNodes && child.childNodes.length) {
        visit(child);
      }
    }
  };
  visit(paragraphEl);
  return text;
}

// THE REAL BUG (follow-up 29, per Enda's uploaded .odt): this used to build `paragraphs`
// as [...all text:p elements..., ...all text:h elements...] — every text:h (an ODF
// "Heading 1"-style paragraph) got tacked on AFTER every ordinary text:p, regardless of
// where it actually sits in the real document. Enda's own master .odt files put the page
// title — e.g. "BOR1a-PS Lidl (Tsesmes) Car Park" — in a heading at the very TOP of the
// document, exactly where it belongs (so he can tell which file is which without opening
// it). getElementsByTagName('text:p')/('text:h') don't care about that — they each just
// return their own tag's matches in document order, and concatenating the two lists then
// threw that order away, silently moving the title from the top of the real document to
// the BOTTOM of the imported text. That's what looked like an extra unwanted line being
// "added" at the end of every script (see the follow-up 28 entry below, which treated the
// symptom rather than this root cause — it's kept in place as a harmless backstop, but
// this is the actual fix).
//
// Walking the tree once, in real document order, and treating text:h specially fixes it
// two ways at once: paragraphs never get reshuffled relative to each other regardless of
// heading/body mix, and headings — which are titles/labels, not narration meant to be
// spoken — are excluded from the extracted script entirely rather than just relocated.
// The title stays exactly where Enda put it in his own .odt file; it just never becomes
// a line of narration in this app, in any position.
function collectOdtParagraphsInOrder(rootEl) {
  const paragraphs = [];
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeName === 'text:p') {
        paragraphs.push({ el: child, isHeading: false });
      } else if (child.nodeName === 'text:h') {
        paragraphs.push({ el: child, isHeading: true });
      } else if (child.childNodes && child.childNodes.length) {
        walk(child);
      }
    }
  };
  walk(rootEl);
  return paragraphs;
}

function extractTextFromOdtXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizeXmlEntities(xml), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('This .odt file contains something the browser\'s XML reader couldn\'t parse. Try re-saving it as a plain .txt file instead.');
  }
  const paragraphs = collectOdtParagraphsInOrder(doc.documentElement);
  const lines = [];
  for (const { el, isHeading } of paragraphs) {
    if (isHeading) continue; // a page title/label, never narration — see comment above
    const text = extractOdtParagraphText(el);
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