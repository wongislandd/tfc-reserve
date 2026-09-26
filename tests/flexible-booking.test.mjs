import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateTimes, validateFlexiblePreferences, newYorkInstant } from '../app/flexible-booking.ts';

const target = { booking_date: '2026-09-27', start_time: '14:00', end_time: '15:00' };
const prefs = { version: 1, window_start: '11:00', window_end: '18:00', notice_minutes: 120, preference: 'closest', amenity_ids: [1, 2] };
const dayBefore = Date.parse('2026-09-26T12:00:00-04:00');

test('ranks preferred, then nearby later and earlier starts; whole duration fits', () => {
  const choices = candidateTimes(target, prefs, dayBefore);
  assert.deepEqual(choices.slice(0, 5).map(c => c.start_time), ['14:00', '14:30', '13:30', '15:00', '13:00']);
  assert.equal(choices.length, 13);
  assert.ok(choices.some(c => c.start_time === '11:00'));
  assert.ok(!choices.some(c => c.end_time > '18:00'));
});
test('any opening mode ranks earlier times first', () => {
  assert.equal(candidateTimes(target, { ...prefs, preference: 'earliest' }, dayBefore)[0].start_time, '11:00');
});
test('each start expires independently, even after preferred time has passed', () => {
  const now = Date.parse('2026-09-27T14:15:00-04:00');
  assert.deepEqual(candidateTimes(target, prefs, now).map(c => c.start_time), ['16:30', '17:00']);
  assert.equal(candidateTimes(target, prefs, Date.parse('2026-09-27T15:00:00-04:00')).length, 0);
});
test('zero notice never allows already started slots', () => {
  assert.equal(candidateTimes(target, { ...prefs, notice_minutes: 0 }, Date.parse('2026-09-27T14:00:00-04:00'))[0].start_time, '14:30');
});
test('accepts a passed preferred time when other acceptable starts remain', () => {
  const p = { ...prefs, notice_minutes: 30 };
  assert.equal(candidateTimes(target, p, Date.parse('2026-09-27T15:00:00-04:00'))[0].start_time, '16:00');
});
test('rejects bad ranges, invalid dates, unknown ranking and locations', () => {
  for (const patch of [{window_start: '15:00'}, {window_end: '14:30'}, {window_end: '02:00'}, {window_start: '11:15'}, {notice_minutes: -1}, {preference: 'anything'}, {amenity_ids: []}, {amenity_ids: [1.5]}]) {
    assert.throws(() => validateFlexiblePreferences({ ...prefs, ...patch }, target));
  }
  assert.throws(() => validateFlexiblePreferences(prefs, { ...target, booking_date: '2026-02-30' }));
});
test('New York conversion handles seasons, DST gaps, and repeated hours', () => {
  assert.equal(newYorkInstant('2026-09-27', '11:00'), '2026-09-27T15:00:00.000Z');
  assert.equal(newYorkInstant('2026-12-27', '11:00'), '2026-12-27T16:00:00.000Z');
  assert.equal(newYorkInstant('2026-03-08', '02:30'), null);
  assert.equal(newYorkInstant('2026-11-01', '01:30'), '2026-11-01T05:30:00.000Z');
});
test('does not change duration across a DST transition', () => {
  const choices = candidateTimes({ booking_date: '2026-11-01', start_time: '01:00', end_time: '02:00' }, { ...prefs, window_start: '00:00', window_end: '04:00', notice_minutes: 0 }, 0);
  assert.ok(!choices.some(c => c.start_time === '01:00' || c.start_time === '01:30'));
  assert.ok(choices.every(c => Date.parse(c.ends_at) - Date.parse(c.starts_at) === 3600_000));
});
