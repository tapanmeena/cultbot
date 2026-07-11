import {
  selectDay,
  getDaySchedule,
  hasExistingBooking,
  resolveCandidateTimes,
  iterateCandidates,
  findCandidateClass,
} from './schedule.js';
import { normalizeCalendarDate, resolvePreferences } from './profile-config.js';

/**
 * Runs the end-to-end booking flow:
 *   fetch schedule -> pick the target day -> skip if already booked ->
 *   try each preferred slot in order -> book (or waitlist) the highest
 *   priority matching workout.
 *
 * @returns {Promise<{ status: string, message: string, class?: object, date?: string }>}
 */
export async function runBooking({ apiClient, config, logger, notifier, options = {} }) {
  const { booking } = config;
  const dryRun = options.dryRun ?? booking.dryRun;
  const dateSelector = options.date ?? booking.date;

  const finish = async (result) => {
    switch (result.status) {
      case 'booked':
      case 'waitlisted':
        logger.success(result.message);
        await notifier.notify(`CultBot: ${result.message}`);
        break;
      case 'unavailable':
        logger.warn(result.message);
        await notifier.notify(`CultBot: ${result.message}`);
        break;
      case 'error':
        logger.error(result.message);
        await notifier.notify(`CultBot: ${result.message}`);
        break;
      default:
        logger.info(result.message);
    }
    return result;
  };

  logger.info('Fetching class schedule...');
  const classes = await apiClient.getClasses();

  const dayId = selectDay(classes, dateSelector);
  if (!dayId) {
    return finish({ status: 'error', message: 'No bookable days were found in the schedule.' });
  }

  let targetDate;
  try {
    targetDate = normalizeCalendarDate(String(dayId), 'target schedule date');
  } catch (error) {
    return finish({ status: 'error', message: error.message });
  }

  const resolved = resolvePreferences(config.application, targetDate);
  if (resolved.skip) {
    return finish({
      status: 'skipped',
      message: `Booking is skipped for ${targetDate} by its ${resolved.source} rule.`,
      date: targetDate,
    });
  }

  const preferences = {
    ...resolved.preferences,
    ...(options.center !== undefined ? { centers: [options.center] } : {}),
  };
  const daySchedule = getDaySchedule(classes, dayId);
  logger.info(
    `Target date: ${targetDate}; profile: ${resolved.profile}; priority: ${preferences.selectionOrder.join(' -> ')}.`,
  );

  if (hasExistingBooking(daySchedule)) {
    return finish({
      status: 'skipped',
      message: `Already booked for ${targetDate}. Nothing to do.`,
      date: targetDate,
    });
  }

  const times = resolveCandidateTimes(daySchedule, preferences);
  for (const candidate of iterateCandidates(preferences, times)) {
    const target = findCandidateClass(daySchedule, candidate, preferences.enableWaitlist);
    if (!target) continue;
    const isWaitlist = target.state === 'WAITLIST_AVAILABLE';
    const context = isWaitlist
      ? `waitlist (${target.waitlistInfo?.waitlistedUserCount ?? 0} ahead)`
      : `${target.availableSeats ?? '?'} seats open`;

    logger.info(
      `Found "${target.workoutName}" at ${candidate.slot}, center ${candidate.centerId} — ${context}.`,
    );

    if (dryRun) {
      return finish({
        status: 'dry-run',
        message: `[DRY RUN] Would ${isWaitlist ? 'join waitlist for' : 'book'} "${target.workoutName}" at ${candidate.slot}, center ${candidate.centerId}, on ${targetDate}.`,
        class: target,
        date: targetDate,
      });
    }

    logger.info(`${isWaitlist ? 'Joining waitlist for' : 'Booking'} "${target.workoutName}"...`);
    await apiClient.bookClass(target.id);

    return finish({
      status: isWaitlist ? 'waitlisted' : 'booked',
      message: `${isWaitlist ? 'Joined waitlist for' : 'Booked'} "${target.workoutName}" at ${candidate.slot}, center ${candidate.centerId}, on ${targetDate}.`,
      class: target,
      date: targetDate,
    });
  }

  return finish({
    status: 'unavailable',
    message: `No preferred workout (${preferences.workouts.join(', ')}) was available on ${targetDate} at centers (${preferences.centers.join(', ')}) and times (${times.join(', ') || 'none matched'}).`,
    date: targetDate,
  });
}
