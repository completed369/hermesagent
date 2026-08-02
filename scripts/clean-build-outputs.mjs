import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function cleanBuildOutputs(root = repositoryRoot) {
  for (const collection of ['apps', 'packages']) {
    const collectionPath = join(root, collection);
    if (!existsSync(collectionPath)) continue;
    for (const project of readdirSync(collectionPath, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const projectPath = join(collectionPath, project.name);
      for (const output of ['dist', '.next']) {
        rmSync(join(projectPath, output), { recursive: true, force: true });
      }
      for (const child of readdirSync(projectPath, { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith('.tsbuildinfo')) {
          rmSync(join(projectPath, child.name), { force: true });
        }
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cleanBuildOutputs();
  console.log('Build outputs and incremental state removed.');
}
