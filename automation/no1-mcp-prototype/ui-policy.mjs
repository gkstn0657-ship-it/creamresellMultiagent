import fs from 'node:fs';

export function assertNo1UiAllowed(argv = process.argv, policy = JSON.parse(fs.readFileSync(new URL('./ui-policy.json', import.meta.url), 'utf8'))) {
  // Read on every call so an already-running MCP process observes the user's preference.
  if (policy.backgroundOnly !== false || argv.includes('--background-only')) throw Error('NO1_BACKGROUND_ONLY_UI_DISABLED');
}
