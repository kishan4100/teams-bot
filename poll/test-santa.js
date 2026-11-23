// Run: node test-santa.js
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'santa-'));
const s = require('./santa');
(async () => {
  for (let n = 2; n <= 12; n++) for (let r = 0; r < 200; r++) {
    const ids = Array.from({ length: n }, (_, i) => 'u' + i), d = s.derangement(ids);
    assert.deepStrictEqual(Object.keys(d).sort(), ids.slice().sort());
    assert.deepStrictEqual(Object.values(d).sort(), ids.slice().sort()); // everyone receives exactly once
    ids.forEach((g) => assert.notStrictEqual(d[g], g));
  }
  const e = await s.createEvent({ title: 'Office Santa', budget: '₹500' });
  await assert.rejects(() => s.createEvent({ title: 'Another' }), /already open/);
  await s.join(e.id, 'a', 'Asha', 't1'); await s.join(e.id, 'b', 'Bala'); await s.join(e.id, 'b', 'Bala'); // re-join is harmless
  await assert.rejects(() => s.draw(e.id), /at least 3/);
  await s.join(e.id, 'c', 'Chitra'); await s.leave(e.id, 'c'); await s.join(e.id, 'c', 'Chitra'); await s.join(e.id, 'd', 'Dev');
  assert.strictEqual(await s.getAssignmentFor(e.id, 'a'), null);
  const drawn = await s.draw(e.id);
  assert.strictEqual(drawn.status, 'drawn');
  for (const u of ['a', 'b', 'c', 'd']) { const x = await s.getAssignmentFor(e.id, u); assert.ok(x && x.userId !== u && x.name); }
  assert.strictEqual(await s.getAssignmentFor(e.id, 'zzz'), null);
  await assert.rejects(() => s.draw(e.id), /already done/);
  await assert.rejects(() => s.join(e.id, 'x', 'X'), /already done/);
  assert.strictEqual((await s.getCurrentEvent()).id, e.id);
  await s.cancel(e.id); assert.strictEqual(await s.getCurrentEvent(), null);
  console.log('santa tests passed');
})().catch((x) => { console.error(x); process.exit(1); });
