## Overview

CultBot books your preferred Cult.fit fitness class for you. It reads the class
schedule, finds your chosen workout at your preferred time and center, and books
it (or joins the waitlist) automatically. Run it by hand or let a scheduled
GitHub Action book for you every morning.

## How it works

1. It fetches the current Cult.fit class schedule using your account cookies.
2. It selects the target day (by default, the newest bookable day).
3. If you already have a booking that day, it stops.
4. It walks your preferred time slots in order and, within each slot, picks the
   highest priority workout that is available.
5. It books the class, or joins the waitlist when the class is full and waitlist
   is enabled.
6. It optionally sends you a notification with the result.

## Requirements

* Node.js 18 or newer (for the built-in `fetch`)
* A Cult.fit account with an active pass
* pnpm, npm, or yarn to install dependencies

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create your configuration and secrets

Copy both example files:

```bash
cp .env.example .env
cp cultbot.config.example.yaml cultbot.config.yaml
```

### 3. Get your credentials

CultBot authenticates as you, using your browser session.

1. Open [cult.fit](https://www.cult.fit) and log in.
2. Open your browser DevTools (F12) and switch to the Network tab.
3. Refresh the page.
4. Right-click any request sent to `cult.fit`, then choose Copy, then Copy as cURL.
5. Paste the whole command into `.env` as the value of `CURL_COMMAND`, on a single line.

> [!IMPORTANT]
> The curl command contains your session cookies. Treat it like a password.
> Never commit your `.env` file. It is already listed in `.gitignore`.

### 4. Find your preferences

Use the discovery commands to find values for `cultbot.config.yaml`:

```bash
npm run list-centers    # find center IDs
npm run list-workouts   # find exact workout names
npm run list-slots      # find exact class times
```

The smallest useful configuration applies to every day:

```yaml
version: 1

default:
  centers: [1018]
  timeRange: "06:00-21:00"
  workouts: ["HRX WORKOUT"]
```

### 5. Verify everything

```bash
npm run config:validate
npm run doctor
```

The first command validates YAML without authentication or network access. The
second confirms that authentication and the live schedule work.

## Usage

| Command                 | What it does                                     |
|-------------------------|--------------------------------------------------|
| `npm run book`          | Book your preferred class for the target day     |
| `npm run preview`       | Dry run that shows what would be booked          |
| `npm run config:validate` | Validate YAML without authentication or network |
| `npm run list-centers`  | List every center and its ID                     |
| `npm run list-workouts` | List every available workout name                |
| `npm run list-slots`    | List every available time slot                   |
| `npm run doctor`        | Validate configuration and test authentication   |
| `npm run test-notify`   | Send a test message to your notification channels |
| `npm run help`          | Show the full command line help                  |

You can also call the CLI directly for one-off overrides:

```bash
node index.js book --dry-run
node index.js book --center 1018
node index.js list-slots --center 1018
node index.js config show --date 2026-07-13
```

## Run automatically with GitHub Actions

A scheduled workflow lives at [.github/workflows/book.yml](.github/workflows/book.yml).
The scheduled run is **opt-in**, so it never competes with a self-hosted
scheduler (systemd, cron, or Docker). To use it:

1. Push this repository to GitHub.
2. Open Settings, then Secrets and variables, then Actions.
3. Add a secret named `CURL_COMMAND` with your curl command.
4. Add a multiline repository variable named `CULTBOT_CONFIG_YAML` containing
   the complete contents of your validated `cultbot.config.yaml`.
5. Add a repository variable `ENABLE_GITHUB_SCHEDULE` set to `true` to turn the
   daily scheduled booking on. Leave it unset (or set to anything else) to keep
   the schedule off, for example when you book from a Raspberry Pi instead.
6. Adjust the `cron` schedule in the workflow to run just after your booking
   window opens. Cron times are in UTC.

You can always trigger a run manually from the Actions tab, with an optional
dry-run toggle. Manual runs work even when `ENABLE_GITHUB_SCHEDULE` is off, so
you can test without turning on the daily cron.

> [!NOTE]
> GitHub schedules run in UTC and may start a few minutes late under load. Set
> the cron slightly before your target and rely on the retry logic.

## Run on a Raspberry Pi or local server

CultBot is a one-shot command (`node index.js book`), so any scheduler can run
it. A Raspberry Pi or an always-on home server is a good fit. Nothing in the
booking logic is GitHub-specific: you only replace the schedule and the config
injection.

> [!NOTE]
> If you schedule bookings on a device, leave the GitHub Action schedule off
> (keep `ENABLE_GITHUB_SCHEDULE` unset, see
> [Run automatically with GitHub Actions](#run-automatically-with-github-actions))
> so the two do not both try to book.

### Prepare the device

1. Install Node.js 18 or newer (LTS 20/22 recommended) for your CPU
   architecture. On 64-bit Raspberry Pi OS the NodeSource builds work well.
   Very old armv6 boards (Pi Zero/1) need an unofficial Node build.
2. Clone the repository and enter it:

   ```bash
   git clone https://github.com/tapanmeena/CultBot.git
   cd CultBot
   ```

3. Set the device time zone so scheduled times match your local clock, and
   confirm the clock is kept accurate over the network:

   ```bash
   sudo timedatectl set-timezone Asia/Kolkata   # your zone
   timedatectl                                  # check "System clock synchronized: yes"
   ```

   Accurate time matters: booking windows open at a fixed minute, and a Pi
   without a real-time clock drifts until NTP syncs. Wait for
   `System clock synchronized: yes` before relying on the schedule.

4. Run the setup helper. It checks Node and pnpm, installs dependencies, and
   creates a locked-down `.env`:

   ```bash
   ./scripts/setup-pi.sh
   ```

   Then edit `.env` with your `CURL_COMMAND`, edit `cultbot.config.yaml` with
   your preferences, and verify with `npm run config:validate` and
   `npm run doctor`.

Now choose one of the three scheduling paths below.

### Path 1: systemd timer (recommended)

A systemd timer is the most reliable option on a Pi: it runs in local time,
**catches up a run missed while the Pi was off** (`Persistent=true`), waits for
the network at boot, and captures logs automatically. The setup helper can
install it for you:

```bash
./scripts/setup-pi.sh --with-systemd
```

Or install the units by hand:

```bash
sudo cp deploy/cultbot.service deploy/cultbot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cultbot.timer
```

Edit the schedule in [deploy/cultbot.timer](deploy/cultbot.timer) (`OnCalendar=`)
to a minute after your booking window opens, then run `sudo systemctl
daemon-reload`. Useful commands:

```bash
systemctl list-timers cultbot.timer     # when it next runs
sudo systemctl start cultbot.service    # run once, right now
journalctl -u cultbot.service -f        # follow the logs
```

### Path 2: cron (quick start)

Cron is the simplest option and closest to the GitHub schedule. It does **not**
re-run jobs missed during downtime, and you manage the log file yourself. Open
your crontab and add a line based on [deploy/crontab.example](deploy/crontab.example):

```bash
crontab -e
```

```cron
# Book daily at 22:01 local time (edit the time and the path).
1 22 * * * cd /home/pi/CultBot && /usr/bin/env node index.js book >> /home/pi/CultBot/cultbot.log 2>&1
```

The redirected log grows forever, so rotate it with the provided snippet:

```bash
sudo cp deploy/cultbot.logrotate /etc/logrotate.d/cultbot   # then edit the path inside
```

### Path 3: Docker (portable)

Best for a non-Pi home server or NAS. The container runs one booking pass and
exits:

```bash
cp .env.example .env
cp cultbot.config.example.yaml cultbot.config.yaml
# Fill in .env and cultbot.config.yaml.
docker compose build
docker compose run --rm cultbot            # book once
docker compose run --rm cultbot book --dry-run   # preview
```

Set `TZ` (in `.env` or your shell) so the container clock matches your zone.
Schedule it by having host cron or systemd call
`docker compose run --rm cultbot`, or use your container platform's scheduler.

### Refresh your session on a headless device

Your Cult.fit session expires periodically. To refresh it without a desktop on
the Pi, copy a fresh curl command on your laptop (see
[step 3 above](#3-get-your-credentials)), then update `.env` over ssh:

```bash
ssh pi@raspberrypi
nano ~/CultBot/.env               # replace CURL_COMMAND, then save
node ~/CultBot/index.js doctor    # confirm auth works
```

### Troubleshooting on a Pi

* **Nothing ran:** check the timer with `systemctl list-timers cultbot.timer`,
  or cron with `crontab -l`. Review logs with `journalctl -u cultbot.service`
  (systemd) or your redirected log file (cron).
* **Ran at the wrong time:** confirm the zone with `timedatectl` and that
  `OnCalendar` / the cron time uses local time.
* **Auth failed:** the session expired - refresh `CURL_COMMAND` as above.
* **No network at trigger time:** the systemd unit waits for
  `network-online.target` and the client retries transient failures; a missed
  systemd run is retried thanks to `Persistent=true`.
* **Clock is off:** run `timedatectl` and ensure `System clock synchronized: yes`.

## Notifications

Notifications are optional. Set any of these in `.env` (or as GitHub secrets) to
receive booking results. You can enable more than one at a time.

| Channel  | Variables                                  |
|----------|--------------------------------------------|
| Discord  | `DISCORD_WEBHOOK_URL`                       |
| Slack    | `SLACK_WEBHOOK_URL`                         |
| Telegram | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |
| Generic  | `NOTIFY_WEBHOOK_URL`                         |

After adding a channel to your `.env`, send a test message to confirm it works
before relying on it:

```bash
npm run test-notify
```

The command reports delivery per channel and works even before your Cult.fit
credentials are set, so you can verify notifications in isolation.

## Configuration reference

### Secrets

`CURL_COMMAND` is required in `.env` locally or as a GitHub Actions secret.
Optional notification credentials also remain environment secrets:
`DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, and `NOTIFY_WEBHOOK_URL`.

All non-secret settings live in `cultbot.config.yaml`. GitHub Actions reads the
same document from the multiline repository variable `CULTBOT_CONFIG_YAML`.
Inline YAML takes precedence over the local file.

### Booking preferences

```yaml
version: 1

default:
  centers: [1018, 1042]
  slots: ["07:00", "08:00"]
  timeRange: "06:00-09:00"
  workouts: ["HRX WORKOUT", "DANCE FITNESS"]
  enableWaitlist: true
  selectionOrder: [times, centers, workouts]
```

`centers`, `slots`, and `workouts` are ordered. Exact slots are tried first;
other live schedule slots inside the inclusive `timeRange` follow
chronologically. `selectionOrder` is optional and defaults to
`[times, centers, workouts]`. It accepts any permutation of `times`, `centers`,
and `workouts`.

For example, the default order tries 07:00 at every center before 08:00:

```text
07:00 / center 1018 / HRX WORKOUT
07:00 / center 1042 / HRX WORKOUT
08:00 / center 1018 / HRX WORKOUT
08:00 / center 1042 / HRX WORKOUT
```

### Profiles and calendar rules

The `default` preference applies every day. Profiles and rules are optional:

```yaml
profiles:
  weekend:
    centers: [1042, 1018]
    timeRange: "09:00-12:00"
    workouts: ["YOGA", "DANCE FITNESS"]

weekly:
  saturday:
    profile: weekend
  sunday:
    skip: true

dates:
  "2026-07-19":
    profile: default
  "2026-07-20":
    skip: true
```

Resolution order is exact date, weekday, then `default`. Profiles and inline
rules inherit from `default`; supplied arrays replace inherited arrays.
`profile: default` can re-enable a date whose weekday is normally skipped.

Inspect any date without contacting Cult.fit:

```bash
node index.js config show --date 2026-07-19
```

### Operational settings

```yaml
booking:
  date: last
  dryRun: false
  maxRetries: 3
  retryDelayMs: 1000

logging:
  level: info
```

Legacy `PREFERRED_*`, `ENABLE_WAITLIST`, `BOOK_DATE`, `DRY_RUN`, `MAX_RETRIES`,
`RETRY_DELAY`, `LOG_LEVEL`, `COOKIES`, and related authentication variables are
no longer read. Move those values to YAML and use `CURL_COMMAND` for
authentication.

## Project structure

```text
CultBot/
  index.js                     Thin entry point
  src/
    cli.js                     Command routing and flag parsing
    config.js                  Loads authentication and notification secrets
    profile-config.js          Loads, validates, and resolves YAML configuration
    curl-parser.js             Extracts auth from a pasted curl command
    api-client.js              Cult.fit HTTP client with retries and backoff
    schedule.js                Pure schedule-parsing helpers
    booking.js                 Booking orchestration
    discovery.js               list-centers, list-workouts, list-slots
    notify.js                  Optional notifications
    logger.js                  Leveled, timestamped logging
  deploy/
    cultbot.service            systemd one-shot service (Option B)
    cultbot.timer              systemd timer with missed-run catch-up
    crontab.example            cron schedule example (Option A)
    cultbot.logrotate          logrotate config for cron logs
  scripts/
    setup-pi.sh                Raspberry Pi / local server setup helper
  Dockerfile                   Container image (Option D)
  docker-compose.yml           One-shot Compose service
  cultbot.config.example.yaml  Safe non-secret configuration example
  .dockerignore                Files excluded from the image build
  .github/workflows/book.yml   Scheduled GitHub Action
  .env.example                 Configuration template
```

## Troubleshooting

* Authentication fails: your session expired. Copy a fresh curl command into `.env`.
* Configuration rejected: run `npm run config:validate`; errors include the
  exact YAML field that needs correction.
* No class booked: run `npm run preview` to see the selected profile and
  candidate priority, then check workout names with `npm run list-workouts`.
* Wrong center: confirm the ID with `npm run list-centers`.
* Verbose output: add `--verbose` to any command for debug logging.

## Disclaimer

CultBot automates your own Cult.fit account for personal convenience. Use it
responsibly and in line with the Cult.fit terms of service. Keep your
credentials private.
