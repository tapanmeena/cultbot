import { listCenters, listWorkouts, listSlots } from './schedule.js';

const pad = (value, length) => String(value).padEnd(length);

/**
 * Discovery commands help users fill in their .env by listing the centers,
 * workouts, and time slots that Cult.fit currently offers.
 *
 * @param {{ apiClient: object, logger: object, type: 'centers'|'workouts'|'slots', options?: object }} params
 */
export async function runDiscovery({ apiClient, logger, type, options = {} }) {
  logger.info('Fetching schedule to discover available options...');
  const classes = await apiClient.getClasses();

  if (type === 'centers') {
    const centers = listCenters(classes);
    logger.success(`Found ${centers.length} center(s):`);
    logger.print('');
    logger.print(`  ${pad('CENTER ID', 12)} NAME`);
    logger.print(`  ${pad('---------', 12)} ----`);
    for (const center of centers) logger.print(`  ${pad(center.id, 12)} ${center.name}`);
    logger.print('');
    logger.print('Set PREFERRED_CENTER in your .env to one of the IDs above.');
    return centers;
  }

  if (type === 'workouts') {
    const workouts = listWorkouts(classes);
    logger.success(`Found ${workouts.length} workout type(s):`);
    logger.print('');
    for (const workout of workouts) logger.print(`  - ${workout.name}`);
    logger.print('');
    logger.print('Set PREFERRED_WORKOUTS in your .env (comma-separated, in priority order).');
    return workouts;
  }

  if (type === 'slots') {
    const centerId = options.center ? Number.parseInt(options.center, 10) : null;
    const slots = listSlots(classes, centerId);
    logger.success(`Found ${slots.length} time slot(s)${centerId ? ` for center ${centerId}` : ''}:`);
    logger.print('');
    for (const slot of slots) logger.print(`  - ${slot}`);
    logger.print('');
    logger.print('Set PREFERRED_SLOTS in your .env (comma-separated, e.g. 07:00:00,08:00:00).');
    return slots;
  }

  throw new Error(`Unknown discovery type: ${type}`);
}
