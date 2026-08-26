import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RAW_CAPTURE_EXTENSION = '(?:txt|out|trace)[a-z0-9]*';
const LOG_TOKEN = new RegExp(
  `(?:^|[-_.])log[a-z0-9]*(?:[-_.][a-z0-9]+)*\\.${RAW_CAPTURE_EXTENSION}$`,
  'i',
);
const LOG_EXTENSION = /\.log[a-z0-9]*(?:\.[a-z0-9]+)*$/i;
const TRANSCRIPT_CAPTURE = new RegExp(
  `(?:^|[-_.])transcript[a-z0-9]*(?:[-_.][a-z0-9]+)*\\.(?:log|${RAW_CAPTURE_EXTENSION})$`,
  'i',
);

export function classifyRawArtifactPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return 'invalid tracked path';
  }

  const normalized = filePath.replaceAll('\\', '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);

  if (TRANSCRIPT_CAPTURE.test(basename)) {
    return 'raw transcript capture';
  }
  if (LOG_EXTENSION.test(basename) || LOG_TOKEN.test(basename)) {
    return 'raw execution log capture';
  }

  return null;
}

export function findRawTrackedArtifacts(paths) {
  return paths.flatMap((filePath) => {
    const reason = classifyRawArtifactPath(filePath);
    return reason === null ? [] : [{ filePath, reason }];
  });
}

export function readTrackedPaths(cwd = process.cwd()) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return output.split('\0').filter(Boolean);
}

export function checkRepositoryArtifactHygiene(cwd = process.cwd()) {
  const findings = findRawTrackedArtifacts(readTrackedPaths(cwd));
  if (findings.length > 0) {
    const details = findings.map(({ filePath, reason }) => `- ${filePath}: ${reason}`).join('\n');
    throw new Error(
      `Tracked raw execution artifacts are forbidden. Preserve reviewed facts in curated documentation instead.\n${details}`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    throw new Error('Usage: node scripts/repository-artifact-hygiene.mjs --check');
  }
  checkRepositoryArtifactHygiene();
  console.log('Repository artifact hygiene: PASS');
}
