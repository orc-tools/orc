import { esc } from './dom-text.js';

export const mcpEsc = value => esc(String(value ?? ''));

function mcpJsonData(text, allowScalar = false) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || (!allowScalar && !/^[[{]/.test(trimmed))) return undefined;
  try {
    return JSON.parse(trimmed, (key, value) => {
      if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
        throw new RangeError('Keep the original number as text');
      }
      return value;
    });
  } catch { return undefined; }
}

export function mcpSame(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && mcpSame(a[key], b[key]));
}

const MCP_BASE64 = /^[A-Za-z0-9+/=\s]*$/;
function mcpDataUrl(data, mimeType, family) {
  if (typeof data !== 'string' || !MCP_BASE64.test(data) || typeof mimeType !== 'string') return null;
  if (!new RegExp(`^${family}/[A-Za-z0-9.+-]+$`).test(mimeType)) return null;
  return `data:${mimeType};base64,${data.replace(/\s/g, '')}`;
}

const mcpBytes = base64 => Math.floor(String(base64 || '').replace(/[\s=]/g, '').length * 3 / 4);
const mcpCode = value => `<pre class="mcp-code">${mcpEsc(JSON.stringify(value, null, 2) ?? String(value))}</pre>`;
const mcpLabel = text => `<span class="mcp-block-label">${mcpEsc(text)}</span>`;

const mcpRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const mcpScalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const mcpScalarHtml = value => typeof value === 'string' && value.length ? mcpEsc(value) : `<code>${mcpEsc(JSON.stringify(value))}</code>`;

function mcpTableHtml(rows, name) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50 || !mcpRecord(rows[0])) return '';
  const columns = Object.keys(rows[0]);
  if (!columns.length || columns.length > 8) return '';
  const fits = row => mcpRecord(row) && Object.keys(row).length === columns.length
    && columns.every(key => Object.hasOwn(row, key) && mcpScalar(row[key]));
  if (!rows.every(fits)) return '';
  return `<div class="mcp-data-scroll"><table class="mcp-data-table">
    <caption${name ? '' : ' class="sr-only"'}>${mcpEsc(name || 'Result rows')}</caption>
    <thead><tr>${columns.map(key => `<th scope="col">${mcpEsc(key)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${columns.map(key => `<td>${mcpScalarHtml(row[key])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function mcpValueHtml(value) {
  if (!Array.isArray(value)) return mcpScalarHtml(value);
  return value.length
    ? `<ul class="mcp-data-values">${value.map(item => `<li>${mcpScalarHtml(item)}</li>`).join('')}</ul>`
    : '<code>[]</code>';
}

function mcpDataHtml(value) {
  if (Array.isArray(value)) return mcpTableHtml(value, '') || mcpCode(value);
  if (!mcpRecord(value)) return mcpCode(value);
  const fields = Object.entries(value);
  if (fields.length === 1) {
    const [name, rows] = fields[0];
    const table = mcpTableHtml(rows, name);
    if (table) return table;
  }
  const fits = item => mcpScalar(item) || (Array.isArray(item) && item.length <= 12 && item.every(mcpScalar));
  if (!fields.length || fields.length > 20 || !fields.every(([, item]) => fits(item))) return mcpCode(value);
  return `<dl class="mcp-data-fields">${fields.map(([key, item]) =>
    `<div><dt>${mcpEsc(key)}</dt><dd>${mcpValueHtml(item)}</dd></div>`).join('')}</dl>`;
}

function mcpTextHtml(text, json) {
  return json ? mcpDataHtml(json) : `<pre class="mcp-text">${mcpEsc(text)}</pre>`;
}

export function mcpResourceHtml(resource, label = 'Resource') {
  const item = resource && typeof resource === 'object' ? resource : {};
  const uri = typeof item.uri === 'string' ? item.uri : '';
  const mime = typeof item.mimeType === 'string' ? item.mimeType : '';
  const head = `${mcpLabel([label, mime].filter(Boolean).join(' · '))}${uri ? `<code class="mcp-uri">${mcpEsc(uri)}</code>` : ''}`;
  if (typeof item.text === 'string') return `<div class="mcp-block" data-type="resource">${head}${mcpTextHtml(item.text, mcpJsonData(item.text))}</div>`;
  if (typeof item.blob === 'string') {
    const image = mcpDataUrl(item.blob, mime, 'image');
    return `<div class="mcp-block" data-type="resource">${head}${image
      ? `<img src="${mcpEsc(image)}" alt="${mcpEsc(`Image ${uri || 'resource'}`)}">`
      : `<p class="mcp-note">Binary content, ${mcpBytes(item.blob)} bytes.</p>`}</div>`;
  }
  return `<div class="mcp-block" data-type="resource">${head}${mcpCode(resource)}</div>`;
}

export function mcpBlockHtml(block, { canRead = false, structuredContent } = {}) {
  if (!block || typeof block !== 'object') return `<div class="mcp-block" data-type="other">${mcpCode(block)}</div>`;
  if (block.type === 'text') {
    const json = mcpJsonData(block.text, structuredContent !== undefined);
    // MCP asks servers to echo structuredContent as serialized text for older clients.
    if (structuredContent !== undefined && mcpSame(json, structuredContent)) return '';
    const data = mcpRecord(json) || Array.isArray(json);
    return `<div class="mcp-block" data-type="${data ? 'json' : 'text'}">${mcpLabel(data ? 'Text · JSON' : 'Text')}${mcpTextHtml(block.text, data && json)}</div>`;
  }
  if (block.type === 'image' || block.type === 'audio') {
    const url = mcpDataUrl(block.data, block.mimeType, block.type);
    const name = block.type === 'image' ? 'Image' : 'Audio';
    if (!url) return `<div class="mcp-block" data-type="${block.type}">${mcpLabel(name)}<p class="mcp-note">The server sent ${name.toLowerCase()} Orc cannot show (${mcpEsc(String(block.mimeType || 'no type'))}).</p></div>`;
    const media = block.type === 'image'
      ? `<img src="${mcpEsc(url)}" alt="${mcpEsc(`${name} the server returned (${block.mimeType})`)}">`
      : `<audio controls src="${mcpEsc(url)}"></audio>`;
    return `<div class="mcp-block" data-type="${block.type}">${mcpLabel(`${name} · ${block.mimeType} · ${mcpBytes(block.data)} bytes`)}${media}</div>`;
  }
  if (block.type === 'resource_link') {
    const uri = typeof block.uri === 'string' ? block.uri : '';
    const name = block.title || block.name || '';
    return `<div class="mcp-block" data-type="link">${mcpLabel(['Resource link', block.mimeType].filter(Boolean).join(' · '))}
      <div class="mcp-link">${name ? `<strong>${mcpEsc(String(name))}</strong>` : ''}<code class="mcp-uri">${mcpEsc(uri)}</code>${
        canRead && uri ? `<orc-button variant="ghost" size="compact" data-mcp-read="${mcpEsc(uri)}">Read</orc-button>` : ''}</div>
      ${block.description ? `<p class="mcp-note">${mcpEsc(String(block.description))}</p>` : ''}</div>`;
  }
  if (block.type === 'resource') return mcpResourceHtml(block.resource, 'Embedded resource');
  return `<div class="mcp-block" data-type="other">${mcpLabel(String(block.type || 'Unknown content'))}${mcpCode(block)}</div>`;
}

export function mcpMessagesHtml(notifications) {
  const rows = (Array.isArray(notifications) ? notifications : []).map(note => {
    const params = note?.params && typeof note.params === 'object' ? note.params : {};
    if (note?.method === 'notifications/progress') {
      const amount = [params.progress, params.total].filter(value => value !== undefined).join(' of ');
      return `<li data-kind="progress"><span class="mcp-message-kind">Progress</span> ${mcpEsc(amount)}${params.message ? ` · ${mcpEsc(String(params.message))}` : ''}</li>`;
    }
    if (note?.method === 'notifications/message') {
      const text = typeof params.data === 'string' ? params.data : JSON.stringify(params.data);
      return `<li data-kind="log"><span class="mcp-message-kind">${mcpEsc(String(params.level || 'log'))}</span> ${params.logger ? `${mcpEsc(String(params.logger))}: ` : ''}${mcpEsc(String(text ?? ''))}</li>`;
    }
    return `<li data-kind="other"><span class="mcp-message-kind">${mcpEsc(String(note?.method || 'message'))}</span> ${mcpEsc(JSON.stringify(params))}</li>`;
  });
  return rows.length ? `<orc-accordion class="mcp-messages"><span slot="summary">Server messages <span class="mcp-count">${rows.length}</span></span><ul>${rows.join('')}</ul></orc-accordion>` : '';
}

export function mcpErrorText(error) {
  if (!error || typeof error !== 'object') return 'The server answered with an error.';
  return [Number.isFinite(error.code) ? `Error ${error.code}` : 'Error', error.message].filter(Boolean).join(': ');
}

export function mcpOutputHtml(entry, { canRead = false } = {}) {
  if (!entry) return '';
  const took = Number.isFinite(entry.ms) ? `<span class="mcp-took">${mcpEsc(entry.ms < 1000 ? `${Math.round(entry.ms)} ms` : `${(entry.ms / 1000).toFixed(1)} s`)}</span>` : '';
  if (entry.message) {
    return `<orc-callout variant="red" class="mcp-failure"><strong>The request did not reach the server.</strong> ${mcpEsc(entry.message)}</orc-callout>`;
  }
  if (!entry.ok) {
    const error = entry.error || {};
    return `<div class="mcp-result" data-state="error">
      <div class="mcp-result-head"><h3>Result</h3><orc-chip variant="red">Protocol error</orc-chip>${took}</div>
      <p class="mcp-error">${mcpEsc(mcpErrorText(error))}</p>
      ${error.data !== undefined ? `${mcpLabel('Error data')}${mcpCode(error.data)}` : ''}
      ${mcpMessagesHtml(entry.notifications)}
    </div>`;
  }
  const result = entry.result && typeof entry.result === 'object' ? entry.result : {};
  const failed = entry.kind === 'tools' && result.isError === true;
  const chip = failed ? '<orc-chip variant="red">Tool error</orc-chip>' : '<orc-chip variant="green">Returned</orc-chip>';
  let body = '';
  if (entry.kind === 'tools') {
    const content = Array.isArray(result.content) ? result.content : [];
    body = content.map(block => mcpBlockHtml(block, { canRead, structuredContent: result.structuredContent })).join('');
    if (result.structuredContent !== undefined) {
      body += `<div class="mcp-block" data-type="structured">${body ? mcpLabel('Structured content') : ''}${mcpDataHtml(result.structuredContent)}</div>`;
    }
    if (!body) body = '<p class="mcp-note">The tool returned no content.</p>';
  } else if (entry.kind === 'resources') {
    const contents = Array.isArray(result.contents) ? result.contents : [];
    body = contents.map(item => mcpResourceHtml(item)).join('') || '<p class="mcp-note">The resource has no contents.</p>';
  } else {
    const messages = Array.isArray(result.messages) ? result.messages : [];
    body = (result.description ? `<p class="mcp-description">${mcpEsc(String(result.description))}</p>` : '')
      + (messages.map(message => {
        const blocks = Array.isArray(message?.content) ? message.content : [message?.content];
        return `<div class="mcp-prompt-message"><span class="mcp-role">${mcpEsc(String(message?.role || 'message'))}</span>${blocks.map(block => mcpBlockHtml(block)).join('')}</div>`;
      }).join('') || '<p class="mcp-note">The prompt has no messages.</p>');
  }
  return `<div class="mcp-result" data-state="${failed ? 'tool-error' : 'ok'}">
    <div class="mcp-result-head"><h3>Result</h3>${chip}${took}<orc-copy-button variant="ghost" size="compact" class="mcp-copy">Copy JSON</orc-copy-button></div>
    ${body}
    ${mcpMessagesHtml(entry.notifications)}
    <orc-accordion class="mcp-raw" label="Raw result">${mcpCode(entry.result)}</orc-accordion>
  </div>`;
}
