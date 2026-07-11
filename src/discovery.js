import { listCenters, listWorkouts, listSlots } from './schedule.js';

const pad = (value, length) => String(value).padEnd(length);

/**
 * Discovery commands help users fill in their YAML config by listing the centers,
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
    logger.print('Add one or more IDs to default.centers in cultbot.config.yaml.');
    return centers;
  }

  if (type === 'workouts') {
    const workouts = listWorkouts(classes);
    logger.success(`Found ${workouts.length} workout type(s):`);
    logger.print('');
    for (const workout of workouts) logger.print(`  - ${JSON.stringify(workout.name)}`);
    logger.print('');
    logger.print('Add exact names to default.workouts in cultbot.config.yaml, in priority order.');
    return workouts;
  }

  if (type === 'slots') {
    const centerId = options.center ?? null;
    const slots = listSlots(classes, centerId);
    logger.success(`Found ${slots.length} time slot(s)${centerId ? ` for center ${centerId}` : ''}:`);
    logger.print('');
    for (const slot of slots) logger.print(`  - ${slot}`);
    logger.print('');
    logger.print('Add times to default.slots in cultbot.config.yaml, e.g. ["07:00", "08:00"].');
    return slots;
  }

  throw new Error(`Unknown discovery type: ${type}`);
}
