// Run: node test-menu.js   (uses a throwaway temp data dir, never touches poll/data)
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'menutest-'));
const p = require('./poll');

const SAMPLE = `Menu for the week 2/11/26 to 6/11/26
Monday
✨ upma +chutney✨
✨ Lunch✨
Shahi mixed veg
Phulka
Rice
Dal
Salad( chola )

✨ tuesday✨
 ✨ veg moong dal idli+chutney
Pav bhaji
Chitrana
Raita
Wednesday

✨ aloo stuffed sandwiches
✨ Lunch✨
Paneer butter masala
Phulka
Dal fry
Rice
Salad

✨ Thursday ✨
✨ breakfast ✨
Idli sambhar chutney
✨ Lunch✨
Bhindi sabzi+ gutte sabzi
Phulka
Pulav
Raita
Rass malai
Salad

✨ Friday ✨
Breakfast -cabbage + veggie paratha + curd`;

(async () => {
  const m = await p.parseMenu(SAMPLE);
  assert.equal(m.weekStart, '2026-11-02');
  assert.equal(m.weekEnd, '2026-11-06');
  assert.equal(m.rawText, SAMPLE);
  assert.deepEqual(m.days, [
    { day: 'Monday', date: '2026-11-02', breakfast: ['Upma + chutney'], lunch: ['Shahi mixed veg', 'Phulka', 'Rice', 'Dal', 'Salad (chola)'] },
    { day: 'Tuesday', date: '2026-11-03', breakfast: ['Veg moong dal idli + chutney'], lunch: ['Pav bhaji', 'Chitrana', 'Raita'] },
    { day: 'Wednesday', date: '2026-11-04', breakfast: ['Aloo stuffed sandwiches'], lunch: ['Paneer butter masala', 'Phulka', 'Dal fry', 'Rice', 'Salad'] },
    { day: 'Thursday', date: '2026-11-05', breakfast: ['Idli sambhar chutney'], lunch: ['Bhindi sabzi + gutte sabzi', 'Phulka', 'Pulav', 'Raita', 'Rass malai', 'Salad'] },
    { day: 'Friday', date: '2026-11-06', breakfast: ['Cabbage + veggie paratha + curd'], lunch: [] },
  ]);
  assert.deepEqual(m.warnings, [
    "Tuesday: no 'Lunch' heading found, guessed which items are lunch",
    'Friday: no lunch items found',
  ]);

  // Lost line breaks are warned
  const flat = await p.parseMenu('Menu for the week 2/11/26 to 6/11/26 Monday upma Lunch Shahi mixed vegPhulkaRiceDal');
  assert.ok(flat.warnings[0].startsWith('Only 1 line(s) found'));

  // Missing dates and days are warned, not thrown
  const bare = await p.parseMenu('monday\nPoha\nLunch: Rice');
  assert.equal(bare.weekStart, null);
  assert.deepEqual(bare.days[0], { day: 'Monday', date: null, breakfast: ['Poha'], lunch: ['Rice'] });
  assert.ok(bare.warnings.some((w) => w.startsWith('No week dates')));
  assert.ok(bare.warnings.includes('Tuesday: not found in the menu'));
  await assert.rejects(p.saveMenu(bare)); // can't save without weekStart

  // Save / get
  assert.equal(await p.getMenu('2026-11-02'), null);
  await p.saveMenu(m);
  assert.deepEqual(await p.getMenu('2026-11-02'), m);

  console.log('All menu tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
