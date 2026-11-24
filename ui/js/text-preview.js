export const DIFF_PREVIEW_BYTES = 8 * 1024 * 1024;

export function needsTextPreview(text) {
  if (text.length > 256 * 1024) return true;
  let lines = 0, files = 0, lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (i === lineStart && text.startsWith('diff --git ', i) && ++files > 100) return true;
    if (i - lineStart > 2000) return true;
    if (text[i] === '\n') {
      if (++lines > 2000) return true;
      lineStart = i + 1;
    }
  }
  return false;
}

export function textPreviewOffsets(text) {
  const offsets = [0];
  let lines = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lines++;
    if (lines < 200 && i - start < 32767) continue;
    // Keep UTF-16 surrogate pairs together when a long line crosses a page.
    if (text.charCodeAt(i) >= 0xd800 && text.charCodeAt(i) <= 0xdbff) i++;
    start = i + 1;
    if (start < text.length) offsets.push(start);
    lines = 0;
  }
  offsets.push(text.length);
  return offsets;
}

export function renderTextPreview(container, text, { message, label, downloadUrl, downloadName = 'diff.patch' } = {}) {
  const offsets = textPreviewOffsets(text);
  const pages = offsets.length - 1;
  container.innerHTML = '<div class="text-preview"><p class="text-preview-message" role="status"></p>' +
    '<div class="text-preview-controls"><button type="button" data-preview-prev>Previous</button>' +
    '<label>Page <input type="number" min="1" step="1" aria-label="Preview page"></label>' +
    '<span data-preview-total></span><button type="button" data-preview-next>Next</button></div>' +
    '<pre tabindex="0"></pre></div>';
  const notice = container.querySelector('.text-preview-message');
  notice.textContent = message;
  if (downloadUrl) {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadName;
    link.textContent = 'Download full diff';
    notice.append(' ', link);
  }
  const previous = container.querySelector('[data-preview-prev]');
  const next = container.querySelector('[data-preview-next]');
  const input = container.querySelector('input');
  const code = container.querySelector('pre');
  code.setAttribute('aria-label', label);
  input.max = String(pages);
  container.querySelector('[data-preview-total]').textContent = 'of ' + pages;
  let page = 0;
  const paint = target => {
    page = Math.max(0, Math.min(pages - 1, Number.isFinite(target) ? Math.trunc(target) : 0));
    input.value = String(page + 1);
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
    code.textContent = text.slice(offsets[page], offsets[page + 1]);
    container.scrollTop = 0;
  };
  previous.addEventListener('click', () => paint(page - 1));
  next.addEventListener('click', () => paint(page + 1));
  input.addEventListener('change', () => paint(input.valueAsNumber - 1));
  paint(0);
}
