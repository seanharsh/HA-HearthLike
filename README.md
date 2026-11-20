# HearthLike Cards for Home Assistant

Lovelace dashboard cards for a family wall display: a shared calendar with day, week and month views and
quick add/edit/delete.

> **Status:** pre-release. There is no tagged release yet, so HACS can't install it until the first one.

- **Calendar views** — day, week and month, plus a combined card with an add-event button
- **Edit in place** — add, edit and delete calendar events (including recurring ones) from the dashboard
- **Visual editors** — the calendar cards can be configured from the dashboard UI

## Cards at a Glance

_Screenshots will be added with the first release._

| Card | What it does |
|---|---|
| Day (`hearthlike-day-card`) | One day, one column per calendar |
| Week (`hearthlike-week-card`) | Hourly week grid with all-day row and now-line |
| Month (`hearthlike-month-card`) | Month grid with event editing |
| Add event button (`hearthlike-fab-card`) | Floating "+" that creates a calendar event |
| Calendar (`hearthlike-calendar-card`) | Day / Week / Month in a single card with the add button built in |
| Dashboard (`hearthlike-dashboard-card`) | All-in-one wall display for a panel view: weather + clock, people badges, the calendar, and quick toggle buttons |

## Installation

### Via HACS

1. Open **HACS** from the Home Assistant sidebar
2. Open the ⋮ menu → **Custom repositories**, add
   `https://github.com/seanharsh/HA-HearthLike` with type **Dashboard**
3. Search for "HearthLike", select **HearthLike Cards**, then **Download**
4. Restart Home Assistant (or reload the browser) so the dashboard resource is picked up

### Manual

1. Copy `dist/hearthlike-cards.js` into your Home Assistant `config/www/` directory
2. In **Settings → Dashboards → Resources**, add as **JavaScript Module**:
   - `/local/hearthlike-cards.js`

## Requirements

- A recent **Home Assistant** release (the exact minimum version will be documented once tested)
- **Calendar cards**: one or more `calendar.*` entities that support creating and editing events
  (for example [Local Calendar](https://www.home-assistant.io/integrations/local_calendar/))

The day, week and month cards size themselves to their container, so place them in a panel view or a
sections/grid layout with a fixed height. See [`example-dashboard.yaml`](example-dashboard.yaml) for a
complete configuration of every card.

## License

MIT — see [LICENSE](LICENSE).
