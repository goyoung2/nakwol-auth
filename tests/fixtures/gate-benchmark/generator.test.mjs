import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

test('synthetic fixture has fixed inventory, reproducible SHA, and inflated RGB images', async () => {
  const { generateFixture } = await import('./generator.mjs');
  for (const imageKiB of [1, 10, 50, 200]) {
    const fixture = generateFixture({ imageKiB, seed: 'fixture-test' });
    assert.equal(fixture.assets.size, 315);
    assert.deepEqual(fixture.manifest.counts, { html: 1, javascript: 4, css: 3, json: 4, image: 300, font: 2, download: 1 });
    assert.equal(fixture.manifest.imageBytes, 300 * imageKiB * 1024);
    for (const entry of fixture.manifest.assets) {
      const asset = fixture.assets.get(entry.path);
      assert.equal(asset.body.length, entry.bytes);
      assert.equal(createHash('sha256').update(asset.body).digest('hex'), entry.sha256);
      if (asset.contentType === 'font/ttf') {
        assert.equal(asset.body.readUInt32BE(), 0x10000);
        let sum = 0;
        for (let offset = 0; offset < asset.body.length; offset += 4) sum = (sum + asset.body.readUInt32BE(offset)) >>> 0;
        assert.equal(sum, 0xb1b0afba, 'TrueType whole-font checksum');
        const tables = new Set();
        for (let index = 0; index < asset.body.readUInt16BE(4); index++) {
          const record = 12 + index * 16;
          tables.add(asset.body.toString('ascii', record, record + 4));
          assert.ok(asset.body.readUInt32BE(record + 8) + asset.body.readUInt32BE(record + 12) <= asset.body.length);
        }
        for (const name of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) assert.ok(tables.has(name));
      }
      if (asset.contentType !== 'image/png') continue;
      assert.equal(asset.body.length, imageKiB * 1024);
      assert.equal(asset.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const width = asset.body.readUInt32BE(16);
      const height = asset.body.readUInt32BE(20);
      const data = [];
      for (let offset = 8; offset < asset.body.length;) {
        const length = asset.body.readUInt32BE(offset);
        if (asset.body.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(asset.body.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      const pixels = inflateSync(Buffer.concat(data));
      assert.equal(pixels.length, height * (width * 3 + 1));
      for (let row = 0; row < height; row++) assert.equal(pixels[row * (width * 3 + 1)], 0);
    }
    assert.deepEqual(generateFixture({ imageKiB, seed: 'fixture-test' }).manifest, fixture.manifest);
  }
  assert.notEqual(generateFixture({ seed: 'one' }).manifest.sha256, generateFixture({ seed: 'two' }).manifest.sha256);
  assert.throws(() => generateFixture({ imageKiB: 0 }), /imageKiB/);
});
