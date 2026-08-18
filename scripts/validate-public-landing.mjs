import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'deploy', 'public-landing');
const requiredFiles = ['index.html', 'styles.css', '404.html', '_headers', 'README.md'];
const publicFiles = ['index.html', 'styles.css', '404.html', '_headers'];

const prohibited = [
  /api-staging\.ventureos\.site/i,
  /staging\.ventureos\.site/i,
  /localhost/i,
  /193\./,
  /VPS_/,
  /CLOUDFLARE_/,
  /DATABASE_URL/,
  /AUTH_SECRET/,
  /github\.com\/completed369\/hermesagent/i,
  /\/dashboard\b/i,
  /\/api\//i,
  /ghp_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk_(live|test)_[A-Za-z0-9]{20,}/i,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];

function fail(message) {
  console.error(`PUBLIC_LANDING_VALIDATION=FAIL ${message}`);
  process.exitCode = 1;
}

function readRequired(file) {
  const path = join(root, file);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      fail(`${file} is not a file`);
      return '';
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail(`missing required file ${file}: ${error.message}`);
    return '';
  }
}

const contents = new Map(requiredFiles.map((file) => [file, readRequired(file)]));

const index = contents.get('index.html') ?? '';
for (const requiredText of ['VentureOS', 'Development in progress']) {
  if (!index.includes(requiredText)) {
    fail(`index.html missing required text: ${requiredText}`);
  }
}

if (!index.includes('<link rel="canonical" href="https://ventureos.site/">')) {
  fail('index.html missing canonical https://ventureos.site/');
}

for (const file of publicFiles) {
  const text = contents.get(file) ?? '';
  for (const pattern of prohibited) {
    if (pattern.test(text)) {
      fail(`${file} contains prohibited pattern ${pattern}`);
    }
  }
}

for (const file of ['index.html', '404.html']) {
  const text = contents.get(file) ?? '';
  const externalRefs = [...text.matchAll(/\b(?:href|src)="(https?:\/\/[^"]+)"/gi)].map(
    (match) => match[1],
  );
  for (const ref of externalRefs) {
    if (ref !== 'https://ventureos.site/') {
      fail(`${file} references external asset or URL: ${ref}`);
    }
  }
}

const css = contents.get('styles.css') ?? '';
for (const match of css.matchAll(/url\((['"]?)(https?:\/\/[^)'"\s]+)\1\)/gi)) {
  fail(`styles.css references external asset: ${match[2]}`);
}

const headers = contents.get('_headers') ?? '';
for (const requiredHeader of [
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Frame-Options: DENY',
  "script-src 'none'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
]) {
  if (!headers.includes(requiredHeader)) {
    fail(`_headers missing ${requiredHeader}`);
  }
}

if (!process.exitCode) {
  console.log('PUBLIC_LANDING_VALIDATION=PASS');
}
