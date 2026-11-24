import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keywordsFromQueries } from '../src/services/alerts/searchSeed.js';

describe('search-seed: keywordsFromQueries', () => {
  it('distils distinct keyword terms from recent queries, freshest first', () => {
    assert.deepEqual(
      keywordsFromQueries(['CCTV camera for office', 'cctv surveillance system']),
      ['cctv', 'camera', 'office', 'surveillance', 'system']
    );
  });

  it('drops stopwords and short tokens, and de-duplicates case-insensitively', () => {
    assert.deepEqual(keywordsFromQueries(['the new tender for solar', 'SOLAR panel']), ['solar', 'panel']);
  });

  it('caps the number of terms', () => {
    const many = Array.from({ length: 40 }, (_, i) => `keyword${i}`).join(' ');
    assert.equal(keywordsFromQueries([many], 15).length, 15);
  });

  it('returns nothing for empty / blank input', () => {
    assert.deepEqual(keywordsFromQueries([]), []);
    assert.deepEqual(keywordsFromQueries(['', '   ', null]), []);
  });
});
