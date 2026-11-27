import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ALLOWED_FILES = new Set(['README.md', 'load.mjs']);
const TOP_KEYS = new Set(['name', 'gallery', 'fit']);
const GALLERY_KEYS = new Set(['states']);
const FIT_KEYS = new Set(['variants', 'measurements', 'rules', 'breaks']);
const STATE_KEYS = new Set(['screen', 'name', 'query', 'custom', 'actions', 'expect', 'expectNote', 'expectDom']);
const VARIANT_KEYS = new Set(['name', 'q', 'checks', 'click', 'viewportOnly', 'maxRows', 'card', 'hits', 'noHit', 'strip', 'edges', 'nowH', 'hide', 'note', 'sky', 'moonAt', 'th', 'listen', 'linesSheet', 'linesProbe', 'wb']);

export async function loadAreas(selected) {
  const entries = readdirSync(here).sort();
  const unexpected = entries.find((file) => !file.endsWith('.mjs') && !ALLOWED_FILES.has(file));
  if (unexpected) throw new Error(`unexpected file in areas: ${unexpected} (only *.mjs and README.md are allowed)`);
  const files = entries.filter((file) => file.endsWith('.mjs') && file !== basename(import.meta.url) && file !== 'load.mjs');
  const areas = [];
  for (const file of files) {
    const area = (await import(pathToFileURL(join(here, file)).href)).default;
    validateAreaShape(area, file);
    areas.push({ ...area, file });
  }
  validate(areas);
  if (selected !== undefined && selected.length === 0) throw new Error('--area requires a non-empty value');
  if (selected && !areas.some((area) => area.name === selected)) throw new Error(`unknown area "${selected}" (known areas: ${areas.map((area) => area.name).join(', ')})`);
  return areas;
}

export async function loadAreasOrExit(selected) {
  try {
    return await loadAreas(selected);
  } catch (error) {
    console.error(`areas: ${error.message}`);
    process.exit(2);
  }
}

export function validateAreaShape(area, file) {
  if (!area || typeof area !== 'object' || Array.isArray(area)) throw new Error(`${file}: default export must be an object`);
  unknownKeys(area, TOP_KEYS, file, 'top level');
  if (typeof area.name !== 'string' || area.name.length === 0) throw new Error(`${file}: name must be a non-empty string`);
  if (area.gallery !== undefined) {
    object(area.gallery, file, 'gallery');
    unknownKeys(area.gallery, GALLERY_KEYS, file, 'gallery');
    if (!Array.isArray(area.gallery.states)) throw new Error(`${file}: gallery.states must be an array`);
    area.gallery.states.forEach((state, index) => {
      object(state, file, `gallery.states[${index}]`);
      unknownKeys(state, STATE_KEYS, file, `gallery.states[${index}]`);
      requiredString(state.screen, file, `gallery.states[${index}].screen`);
      requiredString(state.name, file, `gallery.states[${index}].name`);
      requiredString(state.query, file, `gallery.states[${index}].query`);
      if (state.expect === undefined && state.expectNote === undefined) throw new Error(`${file}: gallery.states[${index}] needs expect or expectNote`);
    });
  }
  if (area.fit !== undefined) {
    object(area.fit, file, 'fit');
    unknownKeys(area.fit, FIT_KEYS, file, 'fit');
    if (area.fit.variants !== undefined && !Array.isArray(area.fit.variants)) throw new Error(`${file}: fit.variants must be an array`);
    for (const [index, variant] of (area.fit.variants ?? []).entries()) {
      object(variant, file, `fit.variants[${index}]`);
      unknownKeys(variant, VARIANT_KEYS, file, `fit.variants[${index}]`);
      requiredString(variant.name, file, `fit.variants[${index}].name`);
      requiredString(variant.q, file, `fit.variants[${index}].q`);
      if (!Array.isArray(variant.checks)) throw new Error(`${file}: fit.variants[${index}].checks must be an array`);
    }
    functionMap(area.fit.measurements, file, 'fit.measurements');
    functionMap(area.fit.rules, file, 'fit.rules');
    if (area.fit.breaks !== undefined) {
      object(area.fit.breaks, file, 'fit.breaks');
      for (const [name, entry] of Object.entries(area.fit.breaks)) {
        object(entry, file, `fit.breaks.${name}`);
        unknownKeys(entry, new Set(['css', 'query', 'expect', 'appliesTo']), file, `fit.breaks.${name}`);
        if (!(entry.expect instanceof RegExp)) throw new Error(`${file}: fit.breaks.${name}.expect must be a RegExp`);
        if (typeof entry.appliesTo !== 'function') throw new Error(`${file}: fit.breaks.${name}.appliesTo must be a function`);
        if (typeof entry.css !== 'string' && typeof entry.query !== 'string' && typeof entry.query !== 'function') throw new Error(`${file}: fit.breaks.${name} needs css or query`);
      }
    }
  }
  const contributions = (area.gallery?.states?.length ?? 0) + (area.fit?.variants?.length ?? 0) + Object.keys(area.fit?.measurements ?? {}).length + Object.keys(area.fit?.rules ?? {}).length + Object.keys(area.fit?.breaks ?? {}).length;
  if (contributions === 0) throw new Error(`${file}: area must contribute at least one recognised entry`);
}

export function validateFitReferences(areas, variants) {
  for (const area of areas) {
    for (const [name, entry] of Object.entries(area.fit?.breaks ?? {})) {
      if (!variants.some(entry.appliesTo)) throw new Error(`${area.file}: fit.breaks.${name}.appliesTo matches no fit variant`);
    }
  }
}

export function validateRegistrations(areas, builtIns = {}) {
  const seen = new Map();
  const unique = (kind, key, origin) => {
    const id = `${kind}:${key}`;
    const previous = seen.get(id);
    if (previous) throw new Error(`duplicate ${kind} "${key.replace('\0', ' / ')}" in ${previous} and ${origin}`);
    seen.set(id, origin);
  };
  for (const [kind, keys] of Object.entries(builtIns)) for (const key of keys) unique(kind, key, 'built-in');
  for (const area of areas) {
    for (const state of area.gallery?.states ?? []) unique('state name', `${state.screen}\0${state.name}`, area.file);
    for (const variant of area.fit?.variants ?? []) unique('variant name', variant.name, area.file);
    for (const key of Object.keys(area.fit?.measurements ?? {})) unique('measurement key', key, area.file);
    for (const key of Object.keys(area.fit?.rules ?? {})) unique('rule key', key, area.file);
    for (const key of Object.keys(area.fit?.breaks ?? {})) unique('break name', key, area.file);
  }
}

function object(value, file, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: ${path} must be an object`);
}

function requiredString(value, file, path) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${file}: ${path} must be a non-empty string`);
}

function functionMap(value, file, path) {
  if (value === undefined) return;
  object(value, file, path);
  for (const [key, fn] of Object.entries(value)) if (typeof fn !== 'function') throw new Error(`${file}: ${path}.${key} must be a function`);
}

function unknownKeys(value, allowed, file, path) {
  const key = Object.keys(value).find((candidate) => !allowed.has(candidate));
  if (key) throw new Error(`${file}: unknown ${path} key "${key}" (allowed: ${[...allowed].join(', ')})`);
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
    unique('area name', area.name, area.file);
    for (const state of area.gallery?.states ?? []) unique('state name', state.name, area.file);
    for (const key of Object.keys(area.fit?.measurements ?? {})) unique('measurement key', key, area.file);
    for (const key of Object.keys(area.fit?.rules ?? {})) unique('rule key', key, area.file);
    for (const key of Object.keys(area.fit?.breaks ?? {})) unique('break name', key, area.file);
  }
}
