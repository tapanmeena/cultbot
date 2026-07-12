import test from 'node:test';
import assert from 'node:assert/strict';
import { runBooking } from '../src/booking.js';
import { parseConfigYaml } from '../src/profile-config.js';

function createConfig(yaml) {
  const application = parseConfigYaml(yaml);
  return {
    application,
    booking: application.booking,
  };
}

function createLogger() {
  return {
    debug() {},
    info() {},
    success() {},
    warn() {},
    error() {},
  };
}

function createNotifier() {
  return { notify: async () => [] };
}

function createSchedule({ bookedElsewhere = false } = {}) {
  return {
    days: [{ id: '2026-07-13' }],
    centerInfoMap: {
      101: { centerName: 'Indiranagar' },
      102: { centerName: 'Koramangala' },
    },
    classByDateMap: {
      '2026-07-13': {
        classByTimeList: [
          {
            id: '07:00:00',
            centerWiseClasses: [
              { centerId: 101, classes: [{ id: 'a', workoutName: 'X', state: 'UNAVAILABLE' }] },
              { centerId: 102, classes: [{ id: 'b', workoutName: 'X', state: 'AVAILABLE' }] },
              {
                centerId: 999,
                classes: [{ id: 'existing', workoutName: 'Z', state: bookedElsewhere ? 'BOOKED' : 'UNAVAILABLE' }],
              },
            ],
          },
          {
            id: '08:00:00',
            centerWiseClasses: [
              { centerId: 101, classes: [{ id: 'c', workoutName: 'X', state: 'AVAILABLE' }] },
            ],
          },
        ],
      },
    },
  };
}

test('default time-first order checks fallback centers before later times', async () => {
  const config = createConfig(`
version: 1
default:
  centers: [101, 102]
  slots: ["07:00", "08:00"]
  workouts: [X]
`);
  const booked = [];
  const result = await runBooking({
    apiClient: {
      getClasses: async () => createSchedule(),
      bookClass: async (id) => booked.push(id),
    },
    config,
    logger: createLogger(),
    notifier: createNotifier(),
    options: { dryRun: true },
  });

  assert.equal(result.status, 'dry-run');
  assert.equal(result.class.id, 'b');
  assert.deepEqual(booked, []);
});

test('booking logs and notifications include the center name and ID', async () => {
  const config = createConfig(`
version: 1
default:
  centers: [101, 102]
  slots: ["07:00"]
  workouts: [X]
`);
  const logs = [];
  const notifications = [];
  const logger = {
    ...createLogger(),
    info: (message) => logs.push(message),
  };
  const result = await runBooking({
    apiClient: {
      getClasses: async () => createSchedule(),
      bookClass: async () => {},
    },
    config,
    logger,
    notifier: {
      notify: async (message) => {
        notifications.push(message);
        return [];
      },
    },
  });

  assert.equal(result.status, 'booked');
  assert.match(result.message, /center Koramangala \(ID 102\)/);
  assert.ok(logs.some((message) => message.includes('center Koramangala (ID 102)')));
  assert.deepEqual(notifications, [`CultBot: ${result.message}`]);
});

test('center-first order tries later times at the first center', async () => {
  const config = createConfig(`
version: 1
default:
  centers: [101, 102]
  slots: ["07:00", "08:00"]
  workouts: [X]
  selectionOrder: [centers, times, workouts]
`);
  const result = await runBooking({
    apiClient: { getClasses: async () => createSchedule(), bookClass: async () => {} },
    config,
    logger: createLogger(),
    notifier: createNotifier(),
    options: { dryRun: true },
  });

  assert.equal(result.class.id, 'c');
});

test('date skip stops before booking', async () => {
  const config = createConfig(`
version: 1
default:
  centers: [101]
  slots: ["07:00"]
  workouts: [X]
dates:
  "2026-07-13":
    skip: true
`);
  let booked = false;
  const result = await runBooking({
    apiClient: {
      getClasses: async () => createSchedule(),
      bookClass: async () => { booked = true; },
    },
    config,
    logger: createLogger(),
    notifier: createNotifier(),
  });

  assert.equal(result.status, 'skipped');
  assert.equal(booked, false);
});

test('an existing booking at another center prevents a second booking', async () => {
  const config = createConfig(`
version: 1
default:
  centers: [101, 102]
  slots: ["07:00"]
  workouts: [X]
`);
  const result = await runBooking({
    apiClient: {
      getClasses: async () => createSchedule({ bookedElsewhere: true }),
      bookClass: async () => assert.fail('must not book'),
    },
    config,
    logger: createLogger(),
    notifier: createNotifier(),
  });
  assert.equal(result.status, 'skipped');
});

