import {
  selectDay,
  getDaySchedule,
  hasExistingBooking,
  findMatchingClasses,
} from './schedule.js';

/**
 * Runs the end-to-end booking flow:
 *   fetch schedule -> pick the target day -> skip if already booked ->
 *   try each preferred slot in order -> book (or waitlist) the highest
 *   priority matching workout.
 *
 * @returns {Promise<{ status: string, message: string, class?: object, date?: string }>}
 */
export async function runBooking({ apiClient, config, logger, notifier, options = {} }) {
  const { preferences, booking } = config;
  const dryRun = options.dryRun ?? booking.dryRun;
  const dateSelector = options.date ?? preferences.date;
  const centerId = options.center ?? preferences.center;

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

  const daySchedule = getDaySchedule(classes, dayId);
  logger.info(`Target date: ${dayId}`);

  if (hasExistingBooking(daySchedule, centerId)) {
    return finish({
      status: 'skipped',
      message: `Already booked for ${dayId}. Nothing to do.`,
      date: dayId,
    });
  }

  for (const slot of preferences.slots) {
    const matches = findMatchingClasses(daySchedule, {
      slot,
      centerId,
      workouts: preferences.workouts,
      enableWaitlist: preferences.enableWaitlist,
    });

    if (matches.length === 0) {
      logger.debug(`No preferred workout available at ${slot}.`);
      continue;
    }

    const target = matches[0];
    const isWaitlist = target.state === 'WAITLIST_AVAILABLE';
    const context = isWaitlist
      ? `waitlist (${target.waitlistInfo?.waitlistedUserCount ?? 0} ahead)`
      : `${target.availableSeats ?? '?'} seats open`;

    logger.info(`Found "${target.workoutName}" at ${slot} — ${context}.`);

    if (dryRun) {
      return finish({
        status: 'dry-run',
        message: `[DRY RUN] Would ${isWaitlist ? 'join waitlist for' : 'book'} "${target.workoutName}" at ${slot} on ${dayId}.`,
        class: target,
        date: dayId,
      });
    }

    logger.info(`${isWaitlist ? 'Joining waitlist for' : 'Booking'} "${target.workoutName}"...`);
    await apiClient.bookClass(target.id);

    return finish({
      status: isWaitlist ? 'waitlisted' : 'booked',
      message: `${isWaitlist ? 'Joined waitlist for' : 'Booked'} "${target.workoutName}" at ${slot} on ${dayId}.`,
      class: target,
      date: dayId,
    });
  }

  return finish({
    status: 'unavailable',
    message: `No preferred workout (${preferences.workouts.join(', ') || 'none set'}) available on ${dayId} at your slots (${preferences.slots.join(', ') || 'none set'}).`,
    date: dayId,
  });
}
