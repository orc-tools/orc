import { defineCatalog, defineSchema } from '@json-render/core';
import { z } from 'zod';

const text = z.string().max(16000);
const label = z.string().min(1).max(200);
const schema = defineSchema(s => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(s.object({
      type: s.ref('catalog.components'),
      props: s.propsOf('catalog.components'),
      children: s.array(s.string()),
    })),
  }),
  catalog: s.object({ components: s.map({ props: s.zod(), description: s.string() }) }),
}));
const components = {
  Stack: { props: z.object({}).strict(), description: 'Vertical group of answer components' },
  Text: { props: z.object({ text, heading: z.boolean().optional() }).strict(), description: 'Plain text or heading' },
  Table: {
    props: z.object({ title: label, columns: z.array(label).min(1).max(12),
      rows: z.array(z.array(text).max(12)).max(200) }).strict(),
    description: 'Comparison or evidence table with local text filtering',
  },
  Source: {
    props: z.object({ label, url: z.string().max(2048).refine(value => {
      try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
      catch { return false; }
    }, 'Use an absolute HTTP(S) source URL') }).strict(),
    description: 'Link to a source supporting the answer',
  },
  Evidence: { props: z.object({ title: label, text }).strict(), description: 'Expandable evidence, with optional child components' },
};
export const answerCatalog = defineCatalog(schema, { components });
const element = z.object({ type: z.enum(Object.keys(components)), props: z.record(z.string(), z.unknown()),
  children: z.array(z.string().min(1).max(100)).max(100) }).strict();
const specSchema = z.object({ root: z.string().min(1).max(100),
  elements: z.record(z.string().min(1).max(100), element) }).strict();

export function validateAnswerSpec(input) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 262144) throw new Error('Answer view exceeds 256 KiB');
  const spec = specSchema.parse(input);
  const ids = Object.keys(spec.elements);
  if (!ids.length || ids.length > 100) throw new Error('Answer view requires 1 to 100 elements');
  const catalogResult = answerCatalog.validate(spec);
  if (!catalogResult.success) throw new Error('Answer view does not match the catalog');
  for (const item of Object.values(spec.elements)) {
    item.props = components[item.type].props.parse(item.props);
    if (!['Stack', 'Evidence'].includes(item.type) && item.children.length) throw new Error('Leaf component has children');
    if (item.type === 'Table' && item.props.rows.some(row => row.length !== item.props.columns.length)) throw new Error('Table row width differs from columns');
  }
  const seen = new Set();
  function visit(id, depth) {
    if (depth > 12 || seen.has(id) || !Object.hasOwn(spec.elements, id)) throw new Error('Answer view must be a bounded tree');
    seen.add(id);
    for (const child of spec.elements[id].children) visit(child, depth + 1);
  }
  visit(spec.root, 0);
  if (seen.size !== ids.length) throw new Error('Answer view has unreachable elements');
  return spec;
}

function node(tag, content) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  return element;
}

export function renderAnswerSpec(input) {
  const spec = validateAnswerSpec(input);
  function render(id) {
    const { type, props, children } = spec.elements[id];
    let element;
    if (type === 'Stack') element = node('div');
    if (type === 'Text') element = node(props.heading ? 'h2' : 'p', props.text);
    if (type === 'Source') {
      element = node('a', props.label);
      element.href = props.url;
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
    }
    if (type === 'Evidence') {
      element = node('details');
      element.append(node('summary', props.title), node('p', props.text));
    }
    if (type === 'Table') {
      element = node('section');
      element.append(node('h3', props.title));
      const field = node('label', 'Filter rows');
      const input = node('input');
      input.type = 'search';
      input.placeholder = 'Search this table';
      field.append(input);
      const scroll = node('div');
      scroll.className = 'answer-table-scroll';
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', props.title);
      const table = node('table');
      table.append(node('caption', props.title));
      const header = node('tr');
      props.columns.forEach(column => { const th = node('th', column); th.scope = 'col'; header.append(th); });
      const head = node('thead');
      head.append(header);
      const body = node('tbody');
      table.append(head, body);
      scroll.append(table);
      const status = node('p');
      status.setAttribute('role', 'status');
      const update = () => {
        const rows = props.rows.filter(row => row.join(' ').toLocaleLowerCase().includes(input.value.toLocaleLowerCase()));
        body.replaceChildren(...rows.map(row => { const tr = node('tr'); row.forEach(cell => tr.append(node('td', cell))); return tr; }));
        status.textContent = rows.length ? `${rows.length} of ${props.rows.length} rows` : 'No matching rows';
      };
      input.addEventListener('input', update);
      update();
      element.append(field, scroll, status);
    }
    element.classList.add('answer-component', `answer-${type.toLowerCase()}`);
    children.forEach(child => element.append(render(child)));
    return element;
  }
  const root = node('article');
  root.className = 'structured-answer';
  root.setAttribute('aria-label', 'Interactive answer');
  root.append(render(spec.root));
  return root;
}
