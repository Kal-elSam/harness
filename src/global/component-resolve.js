/**
 * Deterministic component dependency resolution (deps first, no duplicates).
 */

export function resolveDependencyOrder(seedIds, componentsById) {
  const seeds = uniqueIds(seedIds);
  const selected = new Set();
  const visiting = new Set();
  const ordered = [];

  for (const seedId of seeds) {
    visit(seedId);
  }

  return ordered;

  function visit(id) {
    if (selected.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Component dependency cycle detected while resolving "${id}".`);
    }

    const component = componentsById.get(id);
    if (!component) {
      throw new Error(`Unknown component "${id}".`);
    }

    visiting.add(id);
    for (const dependency of component.dependencies ?? []) {
      visit(dependency);
    }
    visiting.delete(id);
    selected.add(id);
    ordered.push(component);
  }
}

export function indexComponentsById(components) {
  return new Map(components.map((component) => [component.id, component]));
}

function uniqueIds(ids) {
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
