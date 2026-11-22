import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  expandMutate,
  filesForShard,
  mergeReports,
  parseShard,
  renderHtml,
  scoreReport,
  shardOf,
} from './mutation-shards.mjs';

/** Run with: npm run test:scripts */

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'mutation-shards-'));
  for (const file of files) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  return root;
}

const mutant = status => ({ id: status, status });

describe('expandMutate', () => {
  it('applies exclusions in order and returns sorted forward-slashed paths', () => {
    const root = tree([
      'src/b.ts',
      'src/a.ts',
      'src/a.spec.ts',
      'src/deep/c.ts',
      'src/deep/c.model.ts',
    ]);

    assert.deepEqual(
      expandMutate(
        ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.model.ts'],
        root,
      ),
      ['src/a.ts', 'src/b.ts', 'src/deep/c.ts'],
    );
  });
});

describe('sharding', () => {
  const files = Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`);

  it('puts every file in exactly one shard', () => {
    const shards = [1, 2, 3, 4].map(shard => filesForShard(files, shard, 4));

    assert.deepEqual(shards.flat().sort(), [...files].sort());
  });

  it('keeps a file in its shard when other files come and go', () => {
    const kept = files.slice(50);
    const changed = [...kept, 'src/new-1.ts', 'src/new-2.ts'];

    for (const shard of [1, 2, 3, 4]) {
      const before = filesForShard(files, shard, 4).filter(f =>
        kept.includes(f),
      );
      const after = filesForShard(changed, shard, 4).filter(f =>
        kept.includes(f),
      );
      assert.deepEqual(after, before);
    }
  });

  it('spreads files roughly evenly', () => {
    for (const shard of [1, 2, 3, 4]) {
      const size = filesForShard(files, shard, 4).length;
      assert.ok(size > 30 && size < 70, `shard ${shard} has ${size}`);
    }
  });
});

describe('parseShard', () => {
  it('accepts a shard within the total', () => {
    assert.deepEqual(parseShard('2', '4'), { shard: 2, total: 4 });
  });

  for (const [shard, total] of [
    ['0', '4'],
    ['5', '4'],
    ['1.5', '4'],
    ['1', '0'],
    ['x', 'y'],
  ]) {
    it(`rejects shard ${shard} of ${total}`, () => {
      assert.throws(() => parseShard(shard, total));
    });
  }
});

describe('mergeReports', () => {
  const report = (files, testFiles) => ({
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    files,
    ...(testFiles ? { testFiles } : {}),
  });

  it('combines every shard file and test file', () => {
    const merged = mergeReports([
      report({ 'a.ts': { mutants: [] } }, { 'a.spec.ts': { tests: [] } }),
      report({ 'b.ts': { mutants: [] } }, { 'b.spec.ts': { tests: [] } }),
    ]);

    assert.deepEqual(Object.keys(merged.files), ['a.ts', 'b.ts']);
    assert.deepEqual(Object.keys(merged.testFiles), ['a.spec.ts', 'b.spec.ts']);
    assert.equal(merged.schemaVersion, '2');
  });

  it('leaves testFiles out when no shard has any', () => {
    assert.equal('testFiles' in mergeReports([report({})]), false);
  });

  it('refuses a file reported by two shards', () => {
    assert.throws(
      () => mergeReports([report({ 'a.ts': {} }), report({ 'a.ts': {} })]),
      /a\.ts appears in more than one/,
    );
  });

  it('refuses to merge nothing', () => {
    assert.throws(() => mergeReports([]), /No shard reports/);
  });
});

describe('scoreReport', () => {
  it('scores detected over detected plus undetected, ignoring errors', () => {
    const { counts, files, score } = scoreReport({
      files: {
        'a.ts': {
          mutants: ['Killed', 'Killed', 'Timeout', 'Survived'].map(mutant),
        },
        'b.ts': {
          mutants: [
            'NoCoverage',
            'CompileError',
            'RuntimeError',
            'Ignored',
          ].map(mutant),
        },
      },
    });

    assert.equal(score, 60);
    assert.equal(files, 2);
    assert.deepEqual(counts, {
      Killed: 2,
      Timeout: 1,
      Survived: 1,
      NoCoverage: 1,
      CompileError: 1,
      RuntimeError: 1,
      Ignored: 1,
    });
  });

  it('has no score when nothing can be scored', () => {
    assert.equal(
      scoreReport({ files: { 'a.ts': { mutants: [mutant('Ignored')] } } })
        .score,
      null,
    );
  });
});

describe('renderHtml', () => {
  it('cannot be broken out of by a script tag in the report or the elements bundle', () => {
    const html = renderHtml(
      { files: { 'a.ts': { source: '</script><b>x</b>' } } },
      'var s = "</script>";',
    );

    assert.equal(html.match(/<\/script>/g).length, 2);
    assert.match(html, /mutation-test-report-app/);
  });
});
