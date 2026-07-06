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
export function hasExistingBooking(daySchedule, centerId) {
  for (const { cls } of iterateClasses(daySchedule, centerId)) {
    if (cls.state === 'BOOKED' || cls.isBooked === true) return true;
  }
  return false;
}

/**
 * Find bookable classes for a given slot and center that match one of the
 * preferred workouts, sorted by workout preference (their index in the list).
 * Matching is done by workout name (case-insensitive), which is stable across
 * the Cult.fit catalogue, unlike the numeric workout ids.
 */
export function findMatchingClasses(daySchedule, { slot, centerId, workouts, enableWaitlist }) {
  const timeSlot = (daySchedule?.classByTimeList || []).find((item) => item.id === slot);
  if (!timeSlot) return [];

  const center = (timeSlot.centerWiseClasses || []).find((item) => item.centerId === centerId);
  if (!center) return [];

  const wanted = workouts.map((workout) => workout.toLowerCase());
  const bookable = new Set(enableWaitlist ? ['AVAILABLE', 'WAITLIST_AVAILABLE'] : ['AVAILABLE']);

  return (center.classes || [])
    .map((cls) => ({ ...cls, preference: wanted.indexOf((cls.workoutName || '').toLowerCase()) }))
    .filter((cls) => cls.preference !== -1 && bookable.has(cls.state))
    .sort((a, b) => a.preference - b.preference);
}

/**
 * Every distinct center that appears anywhere in the schedule, enriched with
 * its display name from the response's centerInfoMap.
 */
export function listCenters(classes) {
  const info = classes?.centerInfoMap || {};
  const centers = new Map();
  for (const dayId of Object.keys(classes?.classByDateMap || {})) {
    for (const { center } of iterateClasses(classes.classByDateMap[dayId])) {
      if (!centers.has(center.centerId)) {
        const meta = info[center.centerId] || info[String(center.centerId)] || {};
        centers.set(center.centerId, {
          id: center.centerId,
          name: meta.centerName || meta.name || '(name unavailable)',
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
