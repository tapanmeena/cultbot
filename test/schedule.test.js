import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCandidateClass,
  hasExistingBooking,
  iterateCandidates,
  resolveCandidateTimes,
} from '../src/schedule.js';

const dimensions = {
  times: ['T1', 'T2'],
  centers: [1, 2],
  workouts: ['W1', 'W2'],
};

const expectedOrders = new Map([
  [
    'times,centers,workouts',
    ['T1/1/W1', 'T1/1/W2', 'T1/2/W1', 'T1/2/W2', 'T2/1/W1', 'T2/1/W2', 'T2/2/W1', 'T2/2/W2'],
  ],
  [
    'times,workouts,centers',
    ['T1/1/W1', 'T1/2/W1', 'T1/1/W2', 'T1/2/W2', 'T2/1/W1', 'T2/2/W1', 'T2/1/W2', 'T2/2/W2'],
  ],
  [
    'centers,times,workouts',
    ['T1/1/W1', 'T1/1/W2', 'T2/1/W1', 'T2/1/W2', 'T1/2/W1', 'T1/2/W2', 'T2/2/W1', 'T2/2/W2'],
  ],
  [
    'centers,workouts,times',
    ['T1/1/W1', 'T2/1/W1', 'T1/1/W2', 'T2/1/W2', 'T1/2/W1', 'T2/2/W1', 'T1/2/W2', 'T2/2/W2'],
  ],
  [
    'workouts,times,centers',
    ['T1/1/W1', 'T1/2/W1', 'T2/1/W1', 'T2/2/W1', 'T1/1/W2', 'T1/2/W2', 'T2/1/W2', 'T2/2/W2'],
  ],
  [
    'workouts,centers,times',
    ['T1/1/W1', 'T2/1/W1', 'T1/2/W1', 'T2/2/W1', 'T1/1/W2', 'T2/1/W2', 'T1/2/W2', 'T2/2/W2'],
  ],
]);

test('supports all six selection-order permutations', () => {
  for (const [key, expected] of expectedOrders) {
    const selectionOrder = key.split(',');
    const candidates = [...iterateCandidates(
      { ...dimensions, selectionOrder },
      dimensions.times,
    )].map((candidate) => `${candidate.slot}/${candidate.centerId}/${candidate.workout}`);
    assert.deepEqual(candidates, expected, key);
  }
});

test('places exact slots before chronological range slots and removes overlap', () => {
  const day = {
    classByTimeList: [
      { id: '09:00:00' },
      { id: '06:00:00' },
      { id: '07:00:00' },
      { id: '08:00:00' },
    ],
  };
  assert.deepEqual(
    resolveCandidateTimes(day, {
      slots: ['08:00:00', '07:00:00'],
      timeRange: '06:00:00-09:00:00',
    }),
    ['08:00:00', '07:00:00', '06:00:00', '09:00:00'],
  );
});

test('finds only classes in a permitted booking state', () => {
  const day = {
    classByTimeList: [{
      id: '07:00:00',
      centerWiseClasses: [{
        centerId: 101,
        classes: [{ id: 'x', workoutName: 'X', state: 'WAITLIST_AVAILABLE' }],
      }],
    }],
  };
  const candidate = { slot: '07:00:00', centerId: 101, workout: 'X' };
  assert.equal(findCandidateClass(day, candidate, false), null);
  assert.equal(findCandidateClass(day, candidate, true).id, 'x');
  assert.equal(
    findCandidateClass(day, { ...candidate, workout: 'x' }, true),
    null,
  );
});

test('detects an existing booking anywhere in the target day', () => {
  const day = {
    classByTimeList: [{
      id: '07:00:00',
      centerWiseClasses: [
        { centerId: 101, classes: [{ state: 'AVAILABLE' }] },
        { centerId: 999, classes: [{ state: 'BOOKED' }] },
      ],
    }],
  };
  assert.equal(hasExistingBooking(day), true);
});
