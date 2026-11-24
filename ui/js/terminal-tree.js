// The maximised terminal's sidebar: the workspaces of Orc's herdr session as
// project root → run → child run. herdr knows a flat list of workspaces and
// the scope Orc opened each for; the nesting comes from Orc's own runs.

const TREE_PROJECT_PREFIX = 'project:';
const TREE_RUN_PREFIX = 'run:';

function treeProjectName(scope) {
  return scope.slice(TREE_PROJECT_PREFIX.length).replace(/\/+$/, '').split('/').pop() || scope;
}

// `workspaces` is the daemon's list ({ id, label, focused, agentStatus,
// tabCount, scope, project }), `allRuns` the sidebar's runs, and `pageScope`
// the scope of the page the terminal opened from. A project the page or a
// run names is listed even with no workspace yet, and so is a run between a
// child and its project: selecting one opens its workspace.
export function terminalTree(workspaces, allRuns, pageScope) {
  const byScope = new Map(workspaces.filter(item => item.scope).map(item => [item.scope, item]));
  const runsById = new Map(allRuns.map(run => [run.id, run]));
  const nodes = new Map();
  const roots = [];
  let other = null;

  const project = scope => {
    if (!nodes.has(scope)) {
      const node = { key: scope, kind: 'project', path: scope.slice(TREE_PROJECT_PREFIX.length),
        label: treeProjectName(scope), workspace: byScope.get(scope) || null, children: [] };
      nodes.set(scope, node);
      roots.push(node);
    }
    return nodes.get(scope);
  };
  const otherGroup = () => {
    other ||= { key: 'other', kind: 'group', label: 'Other', workspace: null, children: [] };
    return other;
  };
  const runNode = runId => {
    const key = TREE_RUN_PREFIX + runId;
    const workspace = byScope.get(key) || null;
    return { key, kind: 'run', runId, label: runsById.get(runId)?.meta?.title || workspace?.label || runId,
      workspace, children: [] };
  };
  // The run's ancestors, nearest first, stopping at one the sidebar does not
  // know or has already walked.
  const ancestors = runId => {
    const chain = [];
    const seen = new Set([runId]);
    let parentId = runsById.get(runId)?.meta?.parentRunId;
    while (parentId && runsById.has(parentId) && !seen.has(parentId)) {
      chain.push(parentId);
      seen.add(parentId);
      parentId = runsById.get(parentId).meta?.parentRunId;
    }
    return chain;
  };

  if (pageScope?.startsWith(TREE_PROJECT_PREFIX)) project(pageScope);
  for (const item of workspaces) {
    if (item.scope?.startsWith(TREE_PROJECT_PREFIX)) project(item.scope);
  }
  for (const item of workspaces) {
    if (!item.scope) {
      otherGroup().children.push({ key: `workspace:${item.id}`, kind: 'workspace', label: item.label || item.id,
        workspace: item, children: [] });
      continue;
    }
    if (!item.scope.startsWith(TREE_RUN_PREFIX)) continue;
    const runId = item.scope.slice(TREE_RUN_PREFIX.length);
    let parent = item.project ? project(item.project) : otherGroup();
    for (const id of [...ancestors(runId).reverse(), runId]) {
      const key = TREE_RUN_PREFIX + id;
      if (!nodes.has(key)) {
        nodes.set(key, runNode(id));
        parent.children.push(nodes.get(key));
      }
      parent = nodes.get(key);
    }
  }
  roots.sort((a, b) => (b.key === pageScope) - (a.key === pageScope) || a.label.localeCompare(b.label));
  return other ? [...roots, other] : roots;
}

// The tree in reading order, each node with its depth.
export function terminalTreeRows(tree, depth = 0) {
  return tree.flatMap(node => [{ node, depth }, ...terminalTreeRows(node.children, depth + 1)]);
}
