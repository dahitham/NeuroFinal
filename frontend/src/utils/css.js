const cache = new Map();

/**
 * Converts an inline CSS string ("display:flex;gap:12px") into a React style object.
 * The pages keep the design's inline style strings VERBATIM, so every colour, size and spacing value
 * stays exactly as in the design files.
 */
export function s(css) {
  if (cache.has(css)) return cache.get(css);
  const out = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  cache.set(css, out);
  return out;
}
