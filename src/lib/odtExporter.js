/**
 * Creates a .odt (OpenDocument Text) file in the browser (no external dependencies),
 * mirroring src/lib/docxExporter.js's approach for .docx: hand-build the ZIP archive's
 * XML parts and reuse the same store-only ZIP writer (createZip).
 *
 * Why .odt specifically (not .docx): per Enda, his own master narration scripts — the
 * files he currently maintains by hand and hands to Narrators as their source text,
 * which they import via Narrator Scripts & TTS -> Translate Script -> Import File —
 * are .odt files (see src/lib/fileTextExtractor.js's dedicated ODT-extraction path,
 * added for exactly this reason). This exporter lets the app generate that same master
 * .odt directly from a waypoint's own edited narration_script, so Enda no longer has to
 * separately maintain a matching .odt file by hand alongside what's typed into the app.
 *
 * Break tags (<break .../>) are stored as escaped, literal text — same approach as
 * docxExporter.js — so they survive a round-trip back in through
 * fileTextExtractor.js's .odt import. Per Enda's explicit requirement, every break tag
 * is forced onto its own paragraph line in the exported file, regardless of whether it
 * shared a line with surrounding narration text in the app's own textarea.
 */
import { createZip } from './docxExporter';

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Splits a script into an ordered list of export lines, guaranteeing every
// <break .../> tag ends up as its own standalone line — never sharing a line with
// narration text, even if it was typed that way in the source textarea. Matches the
// same broad break-tag pattern narrationUtils.js's parseSSMLBreaks uses
// (/<break\b[^>]*\/?>/gi) rather than ttsParser.js's narrower one, so this catches
// every break tag regardless of which time/strength attribute form was used to write
// it, not just the exact forms ttsParser's UI happens to generate.
function splitScriptIntoExportLines(script) {
  if (!script || !script.trim()) return [];
  const breakRegex = /<break\b[^>]*\/?>/gi;
  const lines = [];
  const pushTextLines = (chunk) => {
    chunk.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    });
  };
  let lastIndex = 0;
  let match;
  while ((match = breakRegex.exec(script)) !== null) {
    pushTextLines(script.slice(lastIndex, match.index));
    lines.push(match[0].trim());
    lastIndex = breakRegex.lastIndex;
  }
  pushTextLines(script.slice(lastIndex));
  return lines;
}

/**
 * Build a narration script as a .odt Blob, preserving <break> tags as escaped text,
 * each forced onto its own paragraph line.
 * @param {string} script  The full script text (may contain <break .../> tags)
 * @returns {Blob}
 */
export function buildScriptOdtBlob(script) {
  const lines = splitScriptIntoExportLines(script);
  const paragraphs = (lines.length ? lines : [''])
    .map((line) => `<text:p text:style-name="Standard">${escapeXml(line)}</text:p>`)
    .join('');

  const contentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<office:document-content'
    + ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
    + ' office:version="1.2">'
    + '<office:body><office:text>' + paragraphs + '</office:text></office:body>'
    + '</office:document-content>';

  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<office:document-styles'
    + ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
    + ' office:version="1.2">'
    + '<office:styles>'
    + '<style:style style:name="Standard" style:family="paragraph"/>'
    + '</office:styles>'
    + '</office:document-styles>';

  const metaXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<office:document-meta'
    + ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' office:version="1.2"><office:meta/></office:document-meta>';

  const manifestXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
    + '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    + '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
    + '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'
    + '</manifest:manifest>';

  // The "mimetype" entry must be the very first entry in the archive, and must be
  // stored rather than compressed, per the ODF spec — createZip() already stores every
  // entry uncompressed (no deflate support at all), and this array's order is exactly
  // the ZIP's write order, so listing it first here is sufficient to satisfy both
  // requirements.
  return createZip([
    { name: 'mimetype', content: 'application/vnd.oasis.opendocument.text' },
    { name: 'META-INF/manifest.xml', content: manifestXml },
    { name: 'content.xml', content: contentXml },
    { name: 'styles.xml', content: stylesXml },
    { name: 'meta.xml', content: metaXml },
  ], 'application/vnd.oasis.opendocument.text');
}

/**
 * Export a narration script as a .odt file, preserving <break> tags as text, each
 * forced onto its own line.
 * @param {string} script  The full script text (may contain <break .../> tags)
 * @param {string} filename  Download filename
 */
export function downloadScriptAsOdt(script, filename = 'narration_script.odt') {
  const blob = buildScriptOdtBlob(script);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
