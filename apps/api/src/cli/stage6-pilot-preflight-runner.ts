import fs from 'node:fs';
import path from 'node:path';
import { prepareReviewedStage6PilotPreflight } from './stage6-pilot-preflight';

const FIXED_PILOT_INPUT = path.resolve(
  __dirname,
  '../../../../docs/stage6/pet-sitting-pilot-input.json',
);

function main(): void {
  const rawInput: unknown = JSON.parse(fs.readFileSync(FIXED_PILOT_INPUT, 'utf8'));
  const packet = prepareReviewedStage6PilotPreflight(rawInput);
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

main();
