/**
 * Creates a .docx file in the browser (no external dependencies).
 * The .docx is a ZIP archive containing XML files.
 * Break tags (<break .../>) are stored as escaped text so they survive
 * a round-trip through fileTextExtractor.js.
 */

// CRC32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build a minimal ZIP archive (stored, no compression).
 * @param {Array<{name: string, content: string}>} files
 * @returns {Blob}
 */
function createZip(files) {
  const encoder = new TextEncoder();

  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name);
    const contentBytes = encoder.encode(f.content);
    return { name: f.name, nameBytes, contentBytes, crc: crc32(contentBytes) };
  });

  // Compute local-header sizes and offsets
  let offset = 0;
  for (const e of entries) {
    e.dataOffset = offset;
    offset += 30 + e.nameBytes.length + e.contentBytes.length;
  }
  const centralDirOffset = offset;

  // Central directory size
  let centralDirSize = 0;
  for (const e of entries) {
    centralDirSize += 46 + e.nameBytes.length;
  }

  const totalSize = centralDirOffset + centralDirSize + 22;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let pos = 0;

  // Local file headers + data
  for (const e of entries) {
    view.setUint32(pos, 0x04034b50, true); pos += 4;   // signature
    view.setUint16(pos, 20, true); pos += 2;            // version needed
    view.setUint16(pos, 0, true); pos += 2;             // flags
    view.setUint16(pos, 0, true); pos += 2;             // compression: stored
    view.setUint16(pos, 0, true); pos += 2;             // mod time
    view.setUint16(pos, 0, true); pos += 2;             // mod date
    view.setUint32(pos, e.crc, true); pos += 4;
    view.setUint32(pos, e.contentBytes.length, true); pos += 4; // compressed size
    view.setUint32(pos, e.contentBytes.length, true); pos += 4; // uncompressed size
    view.setUint16(pos, e.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;             // extra field length
    buf.set(e.nameBytes, pos); pos += e.nameBytes.length;
    buf.set(e.contentBytes, pos); pos += e.contentBytes.length;
  }

  // Central directory
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true); pos += 4;   // signature
    view.setUint16(pos, 20, true); pos += 2;            // version made by
    view.setUint16(pos, 20, true); pos += 2;            // version needed
    view.setUint16(pos, 0, true); pos += 2;             // flags
    view.setUint16(pos, 0, true); pos += 2;             // compression
    view.setUint16(pos, 0, true); pos += 2;             // mod time
    view.setUint16(pos, 0, true); pos += 2;             // mod date
    view.setUint32(pos, e.crc, true); pos += 4;
    view.setUint32(pos, e.contentBytes.length, true); pos += 4;
    view.setUint32(pos, e.contentBytes.length, true); pos += 4;
    view.setUint16(pos, e.nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;             // extra field length
    view.setUint16(pos, 0, true); pos += 2;             // comment length
    view.setUint16(pos, 0, true); pos += 2;             // disk number
    view.setUint16(pos, 0, true); pos += 2;             // internal attrs
    view.setUint32(pos, 0, true); pos += 4;             // external attrs
    view.setUint32(pos, e.dataOffset, true); pos += 4;  // local header offset
    buf.set(e.nameBytes, pos); pos += e.nameBytes.length;
  }

  // End of central directory
  view.setUint32(pos, 0x06054b50, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, entries.length, true); pos += 2;
  view.setUint16(pos, entries.length, true); pos += 2;
  view.setUint32(pos, centralDirSize, true); pos += 4;
  view.setUint32(pos, centralDirOffset, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;

  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Export a narration script as a .docx file, preserving <break> tags as text.
 * @param {string} script  The full script text (may contain <break .../> tags)
 * @param {string} filename  Download filename
 */
export function downloadScriptAsDocx(script, filename = 'narration_script.docx') {
  const escaped = escapeXml(script || '');

  // Each line becomes a <w:p> paragraph; xml:space="preserve" keeps whitespace.
  const paragraphs = escaped
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join('');

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body>' + paragraphs + '</w:body>'
    + '</w:document>';

  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';

  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  const blob = createZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: 'word/document.xml', content: documentXml },
  ]);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}