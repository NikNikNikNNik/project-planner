import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectDayType,
  isKazakhstanWorkday,
  shiftKazakhstanWorkdays,
} from './kazakhstan-calendar.ts';

test('staffing mode selects the calendar used for training', () => {
  assert.equal(getProjectDayType({ staffingMode: 'shift', dayType: 'working' }), 'calendar');
  assert.equal(getProjectDayType({ staffingMode: 'local', dayType: 'calendar' }), 'working');
  assert.equal(getProjectDayType({ dayType: 'working' }), 'working');
});

test('Kazakhstan state holidays and substitute days are excluded for local staff', () => {
  for (const date of [
    '2026-03-21', '2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25',
    '2026-05-27', '2026-10-25', '2026-10-26',
    '2027-03-15', '2027-05-16',
  ]) {
    assert.equal(isKazakhstanWorkday(date), false, `${date} should be a non-working day`);
  }
  assert.equal(isKazakhstanWorkday('2026-03-26'), true);
  assert.equal(isKazakhstanWorkday('2026-08-31'), true);
});

test('working-day shifts skip weekends, state holidays, and confirmed project dates', () => {
  const projectDates = [{ date: '2028-05-02', name: 'Подтверждённый выходной' }];
  assert.equal(shiftKazakhstanWorkdays('2026-03-20', 1), '2026-03-26');
  assert.equal(shiftKazakhstanWorkdays('2026-03-26', -1), '2026-03-20');
  assert.equal(shiftKazakhstanWorkdays('2028-04-28', 1, projectDates), '2028-05-03');
  assert.equal(isKazakhstanWorkday('2028-05-02', projectDates), false);
});
