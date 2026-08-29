/**
 * Extracts plain text from .txt files entirely in the browser.
 *
 * Import is restricted to plain-text (.txt) files only. ElevenLabs changed their SSML tag
 * system, so <break> tags are now added by hand while editing the script — a .txt file is
 * the cleanest source for that workflow, and .docx/.odt import has been removed.
 */

const TEXT_EXTENSIONS = ['.txt', '.text'];

export function getFileInfo(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  return { ext, isText: TEXT_EXTENSIONS.includes(ext) };
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

export async function extractTextFromFile(file) {
  const { ext, isText } = getFileInfo(file.name);

  if (!isText && !file.type.startsWith('text/')) {
    throw new Error(`Unsupported format "${ext || file.type}". Only .txt files are supported.`);
  }

  return await readAsText(file);
}