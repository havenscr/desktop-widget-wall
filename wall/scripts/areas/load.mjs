import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadAreas(selected) {
  const files = readdirSync(here)
    .filter((file) => file.endsWith('.mjs') && file !== basename(import.meta.url) && file !== 'load.mjs')
    .sort();
  const areas = [];
  for (const file of files) {
    const area = (await import(pathToFileURL(join(here, file)).href)).default;
    if (!area?.name) throw new Error(`area file ${file} has no name`);
    if (!selected || area.name === selected) areas.push({ ...area, file });
  }
  if (selected && areas.length === 0) throw new Error(`unknown area "${selected}" (available: ${files.map((file) => file.replace(/\.mjs$/, '')).join(', ')})`);
  validate(areas);
  return areas;
}

function validate(areas) {
  const seen = new Map();
  const unique = (kind, key, file) => {
    const id = `${kind}:${key}`;
    const previous = seen.get(id);
    if (previous) throw new Error(`duplicate ${kind} "${key}" in ${previous} and ${file}`);
    seen.set(id, file);
  };
  for (const area of areas) {
    for (const state of area.gallery?.states ?? []) unique('state name', state.name, area.file);
    for (const key of Object.keys(area.fit?.measurements ?? {})) unique('measurement key', key, area.file);
    for (const key of Object.keys(area.fit?.rules ?? {})) unique('rule key', key, area.file);
    for (const key of Object.keys(area.fit?.breaks ?? {})) unique('break name', key, area.file);
  }
}
