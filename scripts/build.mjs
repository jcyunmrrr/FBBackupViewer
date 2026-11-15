import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
if (!dist.startsWith(root + sep)) throw new Error('Build output is outside the project');
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'src'), { recursive: true });
await mkdir(resolve(dist, 'vendor'), { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(dist, 'index.html'));
await cp(resolve(root, 'src'), resolve(dist, 'src'), { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
await copyFile(resolve(root, 'node_modules/fflate/esm/browser.js'), resolve(dist, 'vendor/fflate.js'));
await copyFile(resolve(root, 'node_modules/fflate/LICENSE'), resolve(dist, 'vendor/fflate.LICENSE'));
console.log('Static site ready in dist/');
