// Shared helpers for the repo-level tests. Plain Node, no dependencies: these tests run without installing
// anything, so they can guard the whole repository (backend, web, mobile, CI) on a fresh checkout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const abs = (rel) => path.join(ROOT, rel);
export const exists = (rel) => fs.existsSync(abs(rel));
export const read = (rel) => fs.readFileSync(abs(rel), 'utf8');
export const readJson = (rel) => JSON.parse(read(rel));

/** Directories that hold dependencies, build output or generated native projects, never source. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.expo', 'android', 'ios', 'uploads', 'web-build', 'coverage']);

/** Every file under `dir` (relative to the repo root, forward slashes), skipping the directories above. */
export function walk(dir = '.', out = []) {
  for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.posix.join(dir, entry.name), out);
    } else {
      out.push(path.posix.normalize(path.posix.join(dir, entry.name)));
    }
  }
  return out;
}

/** All distinct first capture groups of `regex` (which must have the g flag) in `text`. */
export function matches(text, regex) {
  return [...new Set([...text.matchAll(regex)].map((m) => m[1]))];
}
