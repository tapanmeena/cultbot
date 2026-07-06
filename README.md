---
title: CultBot
description: Automatically book your preferred Cult.fit fitness classes with waitlist support, retries, notifications, and scheduled runs.
---

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

### 2. Create your configuration

Copy the example file and open it in your editor:

```bash
cp .env.example .env
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

Use the discovery commands to fill in the rest of your `.env`:

```bash
npm run list-centers    # find your PREFERRED_CENTER id
npm run list-workouts   # find exact PREFERRED_WORKOUTS names
npm run list-slots      # find PREFERRED_SLOTS times
```

Then set `PREFERRED_CENTER`, `PREFERRED_SLOTS`, and `PREFERRED_WORKOUTS` in `.env`.

### 5. Verify everything

```bash
npm run doctor
```

This validates your configuration and confirms that authentication works.

## Usage

| Command                 | What it does                                     |
|-------------------------|--------------------------------------------------|
| `npm run book`          | Book your preferred class for the target day     |
| `npm run preview`       | Dry run that shows what would be booked          |
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
```

## Run automatically with GitHub Actions

A scheduled workflow lives at [.github/workflows/book.yml](.github/workflows/book.yml).
To use it:

1. Push this repository to GitHub.
2. Open Settings, then Secrets and variables, then Actions.
3. Add a secret named `CURL_COMMAND` with your curl command.
4. Add repository variables for `PREFERRED_CENTER`, `PREFERRED_SLOTS`,
   `PREFERRED_WORKOUTS`, and `ENABLE_WAITLIST`.
5. Adjust the `cron` schedule in the workflow to run just after your booking
   window opens. Cron times are in UTC.

You can also trigger a run manually from the Actions tab, with an optional
dry-run toggle.

> [!NOTE]
> GitHub schedules run in UTC and may start a few minutes late under load. Set
> the cron slightly before your target and rely on the retry logic.

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

One of `CURL_COMMAND` or `COOKIES` is required. Everything else is optional,
though setting the preferences is strongly recommended.

| Variable             | Default | Description                                            |
|----------------------|---------|--------------------------------------------------------|
| `CURL_COMMAND`       | none    | Full curl command copied from Cult.fit (provides auth) |
| `COOKIES`            | none    | Raw cookie string, as an alternative to `CURL_COMMAND` |
| `PREFERRED_CENTER`   | none    | Numeric center ID from `npm run list-centers`          |
| `PREFERRED_SLOTS`    | none    | Times to try, in order (`07:00:00,08:00:00`)           |
| `PREFERRED_WORKOUTS` | none    | Workout names in priority order (comma-separated)      |
| `ENABLE_WAITLIST`    | `true`  | Join the waitlist when a class is full                 |
| `BOOK_DATE`          | `last`  | `last`, `first`, or a specific day id                  |
| `DRY_RUN`            | `false` | Preview without booking                                |
| `MAX_RETRIES`        | `3`     | Retry attempts for failed requests                     |
| `RETRY_DELAY`        | `1000`  | Base backoff between retries, in milliseconds          |
| `LOG_LEVEL`          | `info`  | `debug`, `info`, `warn`, or `error`                    |

> [!TIP]
> `PREFERRED_WORKOUTS` accepts several names. CultBot tries them in order, so you
> can set a fallback such as `HRX WORKOUT,EVOLVE YOGA,DANCE FITNESS`.

## Project structure

```text
CultBot/
  index.js                     Thin entry point
  src/
    cli.js                     Command routing and flag parsing
    config.js                  Loads and validates configuration
    curl-parser.js             Extracts auth from a pasted curl command
    api-client.js              Cult.fit HTTP client with retries and backoff
    schedule.js                Pure schedule-parsing helpers
    booking.js                 Booking orchestration
    discovery.js               list-centers, list-workouts, list-slots
    notify.js                  Optional notifications
    logger.js                  Leveled, timestamped logging
  .github/workflows/book.yml   Scheduled GitHub Action
  .env.example                 Configuration template
```

## Troubleshooting

* Authentication fails: your session expired. Copy a fresh curl command into `.env`.
* No class booked: run `npm run preview` to see what CultBot found, then check that your workout name matches `npm run list-workouts` exactly.
* Wrong center: confirm the ID with `npm run list-centers`.
* Verbose output: add `--verbose` to any command for debug logging.

## Disclaimer

CultBot automates your own Cult.fit account for personal convenience. Use it
responsibly and in line with the Cult.fit terms of service. Keep your
credentials private.
