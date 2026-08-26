import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const livingDocuments = ['docs/ROADMAP.md', 'docs/EXECUTION_PLAN.md', 'docs/KNOWN_LIMITATIONS.md'];

test('living public documents never pin an exact SHA as mutable current main', () => {
  for (const path of livingDocuments) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /current (?:product )?(?:`main`|main|baseline)[\s\S]{0,120}\b[0-9a-f]{40}\b/iu,
      `${path} must label embedded SHAs as dated reviewed baselines`,
    );
    assert.match(source, /GitHub[^\n]+authoritative/iu);
    assert.match(source, /dated\s+reviewed (?:source )?baseline/iu);
  }
});
