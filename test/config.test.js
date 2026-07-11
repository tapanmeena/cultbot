import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSecrets, validateAuth } from '../src/config.js';

test('requires cookies and API key from CURL_COMMAND', () => {
  const missingKey = loadSecrets({
    CURL_COMMAND: `curl 'https://www.cult.fit/api' -b 'session=abc'`,
  });
  assert.deepEqual(validateAuth(missingKey).errors, [
    'Missing apiKey. Copy a complete curl command from Cult.fit.',
  ]);

  const complete = loadSecrets({
    CURL_COMMAND: `curl 'https://www.cult.fit/api' -H 'apikey: key' -b 'session=abc'`,
  });
  assert.deepEqual(validateAuth(complete).errors, []);
});
