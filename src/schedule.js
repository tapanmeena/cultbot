/**
 * Pure helpers for reading the Cult.fit class schedule response.
 * No network calls and no side effects, which keeps this logic easy to reason
 * about and to test.
 */

/**
 * Picks which day to book from the schedule.
 * @param {object} classes Raw /classes response.
 * @param {string} selector 'last' | 'first' | a specific day id.
 * @returns {string|null} day id
 */
export function selectDay(classes, selector = 'last') {
  const days = classes?.days || [];
  if (days.length === 0) return null;
  if (selector === 'last') return days[days.length - 1].id;
  if (selector === 'first') return days[0].id;
  const match = days.find((day) => String(day.id) === String(selector));
  return match ? match.id : null;
}

export function getDaySchedule(classes, dayId) {
  return classes?.classByDateMap?.[dayId] || null;
}

/**
 * Yields every class in a day, optionally filtered to a single center.
 */
function* iterateClasses(daySchedule, centerId = null) {
  for (const timeSlot of daySchedule?.classByTimeList || []) {
    for (const center of timeSlot.centerWiseClasses || []) {
      if (centerId !== null && center.centerId !== centerId) continue;
      for (const cls of center.classes || []) {
        yield { timeSlotId: timeSlot.id, center, cls };
      }
    }
  }
}

/**
 * True if the user already has a class booked for the day at the given center.
 */
export function hasExistingBooking(daySchedule) {
  for (const { cls } of iterateClasses(daySchedule)) {
    if (cls.state === 'BOOKED' || cls.isBooked === true) return true;
  }
  return false;
}

/**
 * Builds the ordered time dimension from explicit slots and live schedule slots
 * inside the configured range.
 */
export function resolveCandidateTimes(daySchedule, { slots = [], timeRange }) {
  const ordered = [...slots];
  if (timeRange) {
    const [start, end] = timeRange.split('-');
    const ranged = (daySchedule?.classByTimeList || [])
      .map((item) => normalizeScheduleTime(item.id))
      .filter((slot) => slot && slot >= start && slot <= end)
      .sort();
    ordered.push(...ranged);
  }
  return [...new Set(ordered)];
}

function normalizeScheduleTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value));
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

/**
 * Traverses every time/center/workout combination using selectionOrder from
 * outermost to innermost.
 */
export function* iterateCandidates(preferences, times) {
  const dimensions = {
    times,
    centers: preferences.centers,
    workouts: preferences.workouts,
  };
  const selected = {};

  function* walk(depth) {
    if (depth === preferences.selectionOrder.length) {
      yield {
        slot: selected.times,
        centerId: selected.centers,
        workout: selected.workouts,
      };
      return;
    }

    const dimension = preferences.selectionOrder[depth];
    for (const value of dimensions[dimension]) {
      selected[dimension] = value;
      yield* walk(depth + 1);
    }
  }

  yield* walk(0);
}

/**
 * Finds the class represented by one exact candidate when its state permits
 * booking.
 */
export function findCandidateClass(daySchedule, candidate, enableWaitlist) {
  const timeSlot = (daySchedule?.classByTimeList || []).find(
    (item) => normalizeScheduleTime(item.id) === candidate.slot,
  );
  if (!timeSlot) return null;

  const center = (timeSlot.centerWiseClasses || []).find(
    (item) => item.centerId === candidate.centerId,
  );
  if (!center) return null;

  const bookable = new Set(enableWaitlist ? ['AVAILABLE', 'WAITLIST_AVAILABLE'] : ['AVAILABLE']);
  const match = (center.classes || []).find(
    (cls) => cls.workoutName === candidate.workout && bookable.has(cls.state),
  );

  return match ? { ...match, centerId: candidate.centerId, slot: candidate.slot } : null;
}

/**
 * Resolves a center's display name from the schedule metadata.
 */
export function getCenterName(classes, centerId) {
  const info = classes?.centerInfoMap || {};
  const meta = info[centerId] || info[String(centerId)] || {};
  return meta.centerName || meta.name || null;
}

/**
 * Every distinct center that appears anywhere in the schedule, enriched with
 * its display name from the response's centerInfoMap.
 */
export function listCenters(classes) {
  const centers = new Map();
  for (const dayId of Object.keys(classes?.classByDateMap || {})) {
    for (const { center } of iterateClasses(classes.classByDateMap[dayId])) {
      if (!centers.has(center.centerId)) {
        centers.set(center.centerId, {
          id: center.centerId,
          name: getCenterName(classes, center.centerId) || '(name unavailable)',
        });
      }
    }
  }
  return [...centers.values()].sort((a, b) => a.id - b.id);
}

/**
 * Every distinct workout type that appears anywhere in the schedule.
 */
export function listWorkouts(classes) {
  const workouts = new Map();
  for (const dayId of Object.keys(classes?.classByDateMap || {})) {
    for (const { cls } of iterateClasses(classes.classByDateMap[dayId])) {
      const key = cls.workoutName || cls.workoutId;
      if (key && !workouts.has(key)) {
        workouts.set(key, { id: cls.workoutId, name: cls.workoutName || '(unnamed)' });
      }
    }
  }
  return [...workouts.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Every distinct time slot that appears in the schedule, optionally for one center.
 */
export function listSlots(classes, centerId = null) {
  const slots = new Set();
  for (const dayId of Object.keys(classes?.classByDateMap || {})) {
    for (const { timeSlotId } of iterateClasses(classes.classByDateMap[dayId], centerId)) {
      slots.add(timeSlotId);
    }
  }
  return [...slots].sort();
}
