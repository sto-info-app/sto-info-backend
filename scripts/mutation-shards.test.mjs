import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  chunkOf,
  chunkReportName,
  expandMutate,
  expectedChunkReports,
  filesForChunk,
  filesForShard,
  incrementalFileName,
  keepFiles,
  mergeReports,
  parseChunks,
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

describe('chunking', () => {
  const files = Array.from({ length: 400 }, (_, i) => `src/file-${i}.ts`);
  const shard = filesForShard(files, 2, 4);

  it('puts every file of a shard in exactly one chunk', () => {
    const chunks = [1, 2, 3, 4].map(chunk => filesForChunk(shard, chunk, 4));

    assert.deepEqual(chunks.flat().sort(), [...shard].sort());
  });

  it('keeps a file in its chunk when other files come and go', () => {
    const changed = [...shard.slice(10), 'src/new-1.ts', 'src/new-2.ts'];

    for (const file of shard.slice(10)) {
      assert.equal(
        filesForChunk(changed, chunkOf(file, 4), 4).includes(file),
        true,
      );
    }
  });

  it('splits a shard rather than following the shard split', () => {
    const sizes = [1, 2, 3, 4].map(
      chunk => filesForChunk(shard, chunk, 4).length,
    );

    for (const size of sizes) {
      assert.ok(size > 10, `a chunk has only ${size} of ${shard.length}`);
    }
  });

  it('is a single chunk holding the whole shard by default', () => {
    assert.deepEqual(filesForChunk(shard, 1, 1), shard);
  });
});

describe('incrementalFileName', () => {
  it('keeps the unchunked name for a single chunk, so saved results apply', () => {
    assert.equal(incrementalFileName(3, 16, 1, 1), 'shard-3-of-16.json');
  });

  it('names each chunk and the chunk count', () => {
    assert.equal(
      incrementalFileName(3, 16, 2, 4),
      'shard-3-of-16-chunk-2-of-4.json',
    );
  });
});

describe('expectedChunkReports', () => {
  it('lists each shard and chunk that has files, once', () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`);
    const expected = expectedChunkReports(files, 4, 3);

    assert.equal(expected.length, 12);
    assert.ok(expected.includes(chunkReportName(4, 3)));
  });

  it('leaves out a chunk with no files', () => {
    assert.deepEqual(expectedChunkReports(['src/a.ts'], 4, 3), [
      chunkReportName(shardOf('src/a.ts', 4), chunkOf('src/a.ts', 3)),
    ]);
  });
});

describe('keepFiles', () => {
  it('keeps only the given files, matching absolute or relative names', () => {
    const root = tree([]);
    const report = {
      schemaVersion: '2',
      files: {
        'src/a.ts': { mutants: [] },
        [join(root, 'src', 'b.ts')]: { mutants: [] },
        'src/c.ts': { mutants: [] },
      },
      testFiles: { 'src/a.spec.ts': { tests: [] } },
    };

    const kept = keepFiles(report, ['src/a.ts', 'src/b.ts'], root);

    assert.equal(Object.keys(kept.files).length, 2);
    assert.ok('src/a.ts' in kept.files);
    assert.equal('src/c.ts' in kept.files, false);
    assert.deepEqual(kept.testFiles, report.testFiles);
    assert.equal(kept.schemaVersion, '2');
  });
});

describe('parseChunks', () => {
  it('is 1 when not given', () => {
    assert.equal(parseChunks(['--force']), 1);
  });

  it('reads --chunks', () => {
    assert.equal(parseChunks(['--chunks', '4', '--force']), 4);
  });

  for (const value of ['0', '1.5', 'x', undefined]) {
    it(`rejects --chunks ${value}`, () => {
      assert.throws(() =>
        parseChunks(value === undefined ? ['--chunks'] : ['--chunks', value]),
      );
    });
  }
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
