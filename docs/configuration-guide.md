## Start with the configuration model

CultBot keeps secrets and booking preferences separate:

* Put the copied Cult.fit curl command and notification credentials in `.env`.
* Put schedules, class preferences, retry settings, and logging in
  `cultbot.config.yaml`.
* Put the same YAML in the `CULTBOT_CONFIG_YAML` environment variable when a
  deployment cannot mount a local file, such as GitHub Actions.

CultBot resolves a booking in four steps:

1. Select a date from the live Cult.fit schedule using `booking.date`.
2. Look for an exact rule under `dates`.
3. If no exact rule exists, look for that weekday under `weekly`.
4. If no calendar rule exists, use `default`.

Profiles and calendar rules inherit missing preference fields from `default`.
An inline field on a calendar rule overrides the selected profile. Arrays
replace inherited arrays; they are not appended.

> [!IMPORTANT]
> An exact-date rule replaces the weekday rule for that date. It does not merge
> with the weekday rule. Build the date from `default`, a named `profile`, and
> any inline overrides that the date needs.

## Begin with a public starter template

All center IDs, workout names, times, and dates in this guide are illustrative.
Replace them with values from your own Cult.fit account and schedule. The
publishable `cultbot.config.example.yaml` follows the same neutral pattern.

This starter uses one routine on most days, a later weekend profile, one weekly
rest day, and two exact-date exceptions:

```yaml
version: 1

booking:
  date: last
  dryRun: false
  maxRetries: 3
  retryDelayMs: 1000

logging:
  level: info

default:
  centers: [1001]
  slots: ["07:00", "08:00"]
  workouts:
    - "YOGA"
  enableWaitlist: true

profiles:
  weekend:
    centers: [2001, 1001]
    timeRange: "09:00-12:00"
    workouts:
      - "DANCE FITNESS"
      - "YOGA"

weekly:
  saturday:
    profile: weekend
  sunday:
    skip: true

dates:
  "2030-01-06":
    profile: default
  "2030-01-07":
    skip: true
```

Unlisted days use `default`. The weekend profile inherits the waitlist setting
and default selection order. The January 6 date explicitly restores `default`
even though its Sunday rule normally skips booking, while January 7 is skipped.

## Discover valid values

Center IDs and workout names come from the live Cult.fit schedule. Discover
them before editing the YAML:

```bash
npm run list-centers
npm run list-workouts
npm run list-slots
node index.js list-slots --center 1001
```

Use the numeric center ID, not the displayed center name. Copy workout names
exactly, including capitalization. Workout matching is case-sensitive.
Replace `1001` in the command with an ID returned by `list-centers`.

Times must be quoted strings in either `HH:mm` or `HH:mm:ss` format. CultBot
normalizes `"07:00"` to `"07:00:00"` internally.

## Understand each section

### Root sections

| Field      | Required | Purpose                                                        |
|------------|----------|----------------------------------------------------------------|
| `version`  | Yes      | Configuration schema version. The only supported value is `1`  |
| `default`  | Yes      | Complete fallback preferences inherited by profiles and rules  |
| `profiles` | No       | Reusable, named preference overrides                           |
| `weekly`   | No       | Rules for lowercase weekday names                              |
| `dates`    | No       | Rules for quoted `YYYY-MM-DD` dates                            |
| `booking`  | No       | Target-date, dry-run, and retry behavior                       |
| `logging`  | No       | Log verbosity                                                  |

### Preference fields

The `default` section must resolve to at least one center, one workout, and
either `slots` or `timeRange`. A profile or rule can provide only the fields it
changes because it inherits the rest.

| Field             | Value                                         | Behavior                                      |
|-------------------|-----------------------------------------------|-----------------------------------------------|
| `centers`         | Non-empty list of positive integer IDs        | Earlier IDs have higher priority              |
| `workouts`        | Non-empty list of exact workout names         | Earlier names have higher priority            |
| `slots`           | Non-empty list of quoted exact times          | Tried in the listed order                     |
| `timeRange`       | Quoted inclusive `HH:mm-HH:mm` range          | Uses matching times found in the live schedule|
| `enableWaitlist`  | `true` or `false`                             | Defaults to `true`                            |
| `selectionOrder`  | Permutation of times, centers, and workouts   | Controls which preference dimension wins      |

You can use `slots`, `timeRange`, or both. When both are present, CultBot tries
the exact slots first in their configured order. It then adds other live
schedule times inside the range in chronological order and removes duplicates.

For example:

```yaml
slots: ["08:00", "07:00"]
timeRange: "06:00-09:00"
```

If the live schedule contains 06:00, 07:00, 08:00, and 09:00, the resulting
time priority is 08:00, 07:00, 06:00, then 09:00.

> [!NOTE]
> With `enableWaitlist: true`, a waitlisted class at a higher-priority
> combination is selected before an available class at a lower-priority
> combination. CultBot does not currently express "prefer any open seat before
> joining a waitlist" as a separate policy.

### Calendar rule fields

A `weekly` or `dates` entry can do one of three things:

* Set `skip: true` as the only field to disable that date.
* Select `profile: default` or a named profile.
* Override one or more preference fields directly, with or without a profile.

This is a valid rule fragment:

```yaml
weekly:
  monday:
    profile: early-morning
    centers: [1001]
  friday:
    slots: ["18:30"]
  sunday:
    skip: true
```

`skip: true` cannot be combined with a profile or any preference field.

### Booking and logging fields

| Field                  | Default | Accepted values                                  |
|------------------------|---------|--------------------------------------------------|
| `booking.date`         | `last`  | `first`, `last`, or a quoted `YYYY-MM-DD` date   |
| `booking.dryRun`       | `false` | `true` or `false`                                |
| `booking.maxRetries`   | `3`     | A non-negative integer                           |
| `booking.retryDelayMs` | `1000`  | A positive integer in milliseconds               |
| `logging.level`        | `info`  | `debug`, `info`, `warn`, `error`, or `silent`    |

`first` selects the earliest day returned by Cult.fit. `last` selects the
newest bookable day returned by Cult.fit, which is the normal automation mode.
An exact date works only while that date appears in the live schedule response.

The selected schedule date controls `weekly` and `dates` resolution. It is not
necessarily the date on which the command runs.

## Choose the right selection order

`selectionOrder` lists dimensions from most important to least important. The
default is `[times, centers, workouts]`.

Suppose you configure these values:

```yaml
centers: [1001, 1002]
slots: ["07:00", "08:00"]
workouts: ["YOGA", "DANCE FITNESS"]
```

| Selection order                  | Use it when                                                      |
|----------------------------------|------------------------------------------------------------------|
| `[times, centers, workouts]`     | Getting the earliest preferred time matters most                 |
| `[times, workouts, centers]`     | Time comes first, then workout, with center as the fallback      |
| `[centers, times, workouts]`     | Staying at the nearest center matters most                       |
| `[centers, workouts, times]`     | Center comes first, then workout, and any configured time works  |
| `[workouts, times, centers]`     | Getting the favorite workout matters more than center            |
| `[workouts, centers, times]`     | Workout and center both matter more than time                    |

With `[times, centers, workouts]`, the first candidates are:

```text
07:00 / center 1001 / YOGA
07:00 / center 1001 / DANCE FITNESS
07:00 / center 1002 / YOGA
07:00 / center 1002 / DANCE FITNESS
08:00 / center 1001 / YOGA
...
```

CultBot books the first candidate whose state is available or, when enabled,
waitlist available.

## Scenario 1: Book one routine every day

Use a default-only configuration when your preferences do not change by day.
This person wants a 07:00 yoga class at center 1001 and will try 08:00 if the
first slot is unavailable.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["07:00", "08:00"]
  workouts:
    - "YOGA"
  enableWaitlist: true
```

The omitted selection order defaults to `[times, centers, workouts]`.

## Scenario 2: Prefer the nearest center

This person can visit two centers but strongly prefers the one near home. They
would rather take a later class at center 1001 than an earlier class at center
1002, so `centers` is the first selection dimension.

```yaml
version: 1

default:
  centers: [1001, 1002]
  slots: ["07:00", "08:00"]
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: true
  selectionOrder: [centers, times, workouts]
```

The bot exhausts both times and workouts at center 1001 before trying center
1002.

## Scenario 3: Prefer a workout even at a later time

This person wants yoga above everything else. They will take yoga at 09:00
instead of dance fitness at 08:00. A workout-first order expresses that choice.

```yaml
version: 1

default:
  centers: [1001, 1002]
  slots: ["08:00", "09:00"]
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: false
  selectionOrder: [workouts, times, centers]
```

The first workout name remains the top priority across every configured time
and center.

## Scenario 4: Use exact favorites with a flexible window

This person prefers 07:30, then 08:30, but can attend any morning class between
06:00 and 10:00. Exact slots remain first, while `timeRange` discovers schedule
changes without requiring a YAML edit.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["07:30", "08:30"]
  timeRange: "06:00-10:00"
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: true
  selectionOrder: [times, workouts, centers]
```

If Cult.fit adds a 09:15 class, it becomes a fallback because it is inside the
range. A class outside the range is ignored.

## Scenario 5: Use weekday and weekend routines

This person trains before work on weekdays, sleeps later on Saturday, and rests
on Sunday. Profiles contain only the fields that differ from `default`.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["06:30", "07:30"]
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: true

profiles:
  saturday-late:
    timeRange: "09:00-12:00"
    slots: ["10:00"]
    workouts:
      - "DANCE FITNESS"
      - "YOGA"

weekly:
  saturday:
    profile: saturday-late
  sunday:
    skip: true
```

The Saturday profile inherits center 1001 and the waitlist setting. Because it
defines both `slots` and `timeRange`, 10:00 is tried before the other live times
from 09:00 through 12:00.

## Scenario 6: Alternate morning and evening routines

This person normally trains before work, can train only in the evening on
Tuesday and Thursday, and keeps Friday as a rest day.

```yaml
version: 1

default:
  centers: [1001, 1002]
  slots: ["07:00", "08:00"]
  workouts:
    - "YOGA"
  enableWaitlist: true
  selectionOrder: [times, centers, workouts]

profiles:
  evening:
    slots: ["18:30", "19:30"]

weekly:
  tuesday:
    profile: evening
  thursday:
    profile: evening
  friday:
    skip: true
```

## Scenario 7: Never join a waitlist

This person only wants a confirmed seat. The bot skips `WAITLIST_AVAILABLE`
classes and continues through lower-priority candidates looking for an
`AVAILABLE` class.

```yaml
version: 1

default:
  centers: [1001, 1002]
  timeRange: "17:00-20:00"
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: false
  selectionOrder: [times, centers, workouts]
```

If no candidate has an open seat, the run finishes as unavailable and makes no
booking.

## Scenario 8: Skip holidays and restore one normal Sunday

This person normally rests every Sunday. They also want to skip a Monday
holiday, but make one Sunday an ordinary training day. Exact dates take
precedence over weekly rules.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["07:00"]
  workouts:
    - "YOGA"

weekly:
  sunday:
    skip: true

dates:
  "2030-01-06":
    profile: default
  "2030-01-07":
    skip: true
```

January 6 uses `default` even though it is a Sunday. January 7 is skipped even
though its Monday weekday has no special rule.

> [!TIP]
> Remove expired entries from `dates` periodically. They are harmless, but a
> short exception list is easier to audit.

## Scenario 9: Change one date for travel

This person normally trains at center 1001. On January 9 they will be near
center 2001 and can train only in the evening. The inline date fields replace the
inherited center and slots for that date.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["07:00", "08:00"]
  workouts:
    - "YOGA"
    - "DANCE FITNESS"
  enableWaitlist: true

dates:
  "2030-01-09":
    centers: [2001]
    timeRange: "18:00-20:00"
    slots: ["19:00"]
```

This date still inherits both workout names and the waitlist setting from
`default`. Its `centers` and `slots` arrays replace the inherited arrays.

## Scenario 10: Keep reusable home and office profiles

This person trains near the office on Monday and Wednesday, at home on Tuesday
and Thursday, and uses the default home routine on the weekend.

```yaml
version: 1

default:
  centers: [1001]
  slots: ["08:00"]
  workouts:
    - "YOGA"
  enableWaitlist: true

profiles:
  office:
    centers: [2001, 2002]
    slots: ["18:30", "19:30"]
    workouts:
      - "DANCE FITNESS"
      - "YOGA"
    selectionOrder: [centers, times, workouts]
  home-early:
    slots: ["06:30", "07:30"]

weekly:
  monday:
    profile: office
  tuesday:
    profile: home-early
  wednesday:
    profile: office
  thursday:
    profile: home-early
  friday:
    skip: true
```

Named profiles are useful when several calendar entries share a meaningful
routine. For a one-date change, inline overrides are usually clearer.

## Scenario 11: Stage a new setup in dry-run mode

This person is deploying CultBot on a new server and wants several days of
observation before enabling real bookings. Debug logs expose candidate and API
details, while `dryRun` prevents the booking request.

```yaml
version: 1

booking:
  date: last
  dryRun: true
  maxRetries: 3
  retryDelayMs: 1000

logging:
  level: debug

default:
  centers: [1001]
  timeRange: "06:00-09:00"
  workouts:
    - "YOGA"
  enableWaitlist: false
```

After the previews consistently select the expected class, change
`booking.dryRun` to `false` and usually return `logging.level` to `info`.

You can also leave the file ready for live bookings and preview one run:

```bash
npm run preview
```

## Scenario 12: Target a specific exposed date

Most scheduled installations should keep `booking.date: last`. A specific date
is useful for controlled testing while that date is still present in the live
schedule.

```yaml
version: 1

booking:
  date: "2030-01-07"
  dryRun: true
  maxRetries: 1
  retryDelayMs: 2000

default:
  centers: [1001]
  slots: ["07:00"]
  workouts:
    - "YOGA"
```

If Cult.fit does not return January 7 as a currently bookable day, the booking
run reports that no bookable day matched. Restore `last` for normal automation.

## Apply one-off command overrides

You do not need to edit YAML for every experiment:

```bash
# Preview the class selected by the normal configuration.
node index.js book --dry-run

# Restrict this run to one center.
node index.js book --center 2001 --dry-run

# Target a currently exposed date for this run.
node index.js book --date 2030-01-07 --dry-run

# Inspect extra logs without changing logging.level.
node index.js book --dry-run --verbose
```

`--center` replaces the configured center list for that run. `--date` replaces
`booking.date`. `--dry-run` forces a preview. There is no command option that
forces live booking when the YAML has `dryRun: true`; change the YAML to
`false` when you are ready.

## Store configuration by deployment type

### Local machine, Raspberry Pi, or Docker bind mount

Keep the configuration at the repository root:

```text
cultbot.config.yaml
```

CultBot reads that path relative to its working directory.

### GitHub Actions or environment-only deployment

Create a multiline `CULTBOT_CONFIG_YAML` variable containing the entire YAML
document. A non-empty environment value takes precedence over the local file.
If that environment value is invalid, CultBot reports the error and does not
fall back to `cultbot.config.yaml`.

Keep `CURL_COMMAND` and notification credentials in secrets, not inside the
YAML variable.

## Validate before enabling bookings

Use this sequence after every meaningful configuration change:

```bash
# Parse and validate YAML without authentication or network access.
npm run config:validate

# Resolve representative dates without contacting Cult.fit.
node index.js config show --date 2030-01-07
node index.js config show --date 2030-01-08
node index.js config show --date 2030-01-13

# Confirm credentials and access to the live schedule.
npm run doctor

# Preview the actual candidate that would be selected.
npm run preview
```

Check one date for every profile, skipped weekday, and exact-date exception.
`config show` reports whether the result came from `default`, a weekday rule,
or a date rule.

## Avoid common configuration mistakes

### A profile unexpectedly keeps an old value

Profiles inherit every omitted field from `default`. Add an explicit field to
replace it. Arrays replace the whole inherited list.

### A date does not include its weekday changes

An exact date takes precedence over the whole weekday rule. Select the needed
profile again or repeat the needed override on the date.

### A workout never matches

Workout names are exact and case-sensitive. Run `npm run list-workouts` and
copy the displayed name.

### A time is rejected

Quote times and use zero-padded 24-hour values such as `"07:00"` or
`"18:30:00"`. A range uses `"06:00-09:30"`, and its start cannot be later
than its end.

### The wrong class wins

Read `selectionOrder` from left to right as most important to least important.
Then inspect each associated array from first item to last item.

### CultBot joins a waitlist before trying an open fallback

With waitlisting enabled, candidate priority wins over seat type. Set
`enableWaitlist: false` if any lower-priority open seat should be preferred to
a higher-priority waitlist.

### A skipped rule fails validation

Use only `skip: true` in that rule. Do not combine it with `profile`, `centers`,
or another preference.

### YAML syntax is valid but CultBot rejects it

CultBot deliberately rejects unknown fields, duplicate keys, multiple YAML
documents, anchors, aliases, merge keys, and explicit YAML tags. These checks
keep configuration behavior predictable. Use direct mappings and repeated
values instead of YAML indirection.
