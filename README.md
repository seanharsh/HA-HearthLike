# HearthLike Cards for Home Assistant

Lovelace dashboard cards for a family wall display: a shared calendar with day, week and month views and
quick add/edit/delete.

> **Status:** pre-release. There is no tagged release yet, so HACS can't install it until the first one.

- **Calendar views** — day, week and month, plus a combined card with an add-event button
- **Edit in place** — add, edit and delete calendar events (including recurring ones) from the dashboard
- **All-in-one dashboard card** — weather and clock, people badges, the calendar and quick toggle buttons on one panel view
- **Visual editors** — the cards can be configured from the dashboard UI, and the dashboard card accepts custom CSS

## Screenshots

The all-in-one dashboard card, with weather and clock, people badges, the calendar and quick buttons:

![HearthLike dashboard card](docs/dashboard-card.png)

The day, week and month cards on their own:

![HearthLike day card](docs/day-card.png)

![HearthLike week card](docs/week-card.png)

![HearthLike month card](docs/month-card.png)

## Cards at a Glance

| Card | What it does |
|---|---|
| Day (`hearthlike-day-card`) | One day, one column per calendar |
| Week (`hearthlike-week-card`) | Day list over several weeks, or an hourly week grid with all-day row and now-line |
| Month (`hearthlike-month-card`) | Month grid with colored dots and the selected day's events, or event boxes in each day |
| Add event button (`hearthlike-fab-card`) | Floating "+" that creates a calendar event |
| Calendar (`hearthlike-calendar-card`) | Day / Week / Month in a single card with the add button built in |
| Dashboard (`hearthlike-dashboard-card`) | All-in-one wall display for a panel view: weather + clock, people badges, the calendar, and quick toggle buttons |

## Default view and idle reset

`hearthlike-calendar-card` shows the Day tab first. Pick another with `default_view`, and set `idle_timeout` (seconds)
to have the card go back to that view, and to today's date, after nobody has touched it for that long (handy on a
wall display). Both are in the visual editor's View tab.

```yaml
type: custom:hearthlike-calendar-card
default_view: week      # day (default) | week | month
idle_timeout: 120       # seconds; omit or 0 to never reset
```

## Add-event button colour

The "+" button follows your theme's primary colour. Override it with `--hearthlike-fab-color` (button) and
`--hearthlike-fab-icon-color` (the plus), for example from a theme or card-mod.

## Event icons

Give a calendar a small icon that shows in front of its event titles in the day, week and month views. Set `icon`
on a day column or on a week/month calendar entry (also in the visual editors):

```yaml
columns:                      # day card; week and month use calendars: [{ entity, color, icon }]
  - name: Hockey
    color: "#fdb827"
    entities: [calendar.hockey]
    icon: mdi:hockey-puck       # an MDI icon
  - name: Kids
    color: "#2d7ff9"
    entities: [calendar.kids]
    icon: person.riley          # an entity: its picture (or its icon) is used
```

`icon` can also be an emoji (`🏒`) or an image, including SVG (`/local/logo.svg` or a full URL).
An image address must point at the file itself, not at a web page that shows it. An image that fails to load is
replaced by a broken-image icon.

In the visual editors, the icon field searches MDI and installed icon sets, accepts anything else you type, and
offers tappable emoji, led by the ones that suit the column or calendar name. For other emoji, use your system's
emoji keyboard.

## Weather tap action

Tapping the weather in `hearthlike-dashboard-card` opens the weather entity's more-info popup. Change that with
`weather_tap_action` (also in the visual editor, General tab):

```yaml
type: custom:hearthlike-dashboard-card
weather: weather.home
weather_tap_action:
  action: navigate              # more-info (default) | navigate | url | call-service | none
  navigation_path: /lovelace/forecast
```

`url` takes `url_path` (and `new_tab: false` to stay in the same tab); `call-service` takes `service`
(`domain.service`) and optional `service_data` and `target`.

## Week and month layouts

Both views default to a wall-display layout; the older ones are still available (also in each view's editor).

```yaml
week:
  layout: list      # list (default): day columns for several weeks, scrolling | grid: one week by the hour
  weeks: 13         # list only: weeks shown, starting with the current one (1-26)
month:
  layout: dots      # dots (default): a dot per calendar color, tap a day to list its events | events: boxes in each day
```

The same keys work on `hearthlike-week-card` and `hearthlike-month-card`. The week list shows fewer columns on
narrow screens. `hour_start`, `hour_end` and `px_per_hour` apply to the `grid` layout only. The `dots` layout
fits as many weeks as the screen has room for; set `--hearthlike-month-row-height` (for example `197px`) for
taller rows, and `--hearthlike-month-title-size`, `--hearthlike-month-day-name-size`,
`--hearthlike-month-number-size`, `--hearthlike-month-dot-size` or `--hearthlike-month-list-size` to resize its parts.

On screens too short for everything, the dashboard card keeps the calendar at a usable height
(`--hearthlike-calendar-min-height`, 420px) and scrolls.

## Styling the dashboard card

`hearthlike-dashboard-card` follows your theme out of the box. To change it, use any of these:

- **CSS variables** (from a theme, card-mod, or the card's `style` option):
  `--hearthlike-height`, `--hearthlike-background`, `--hearthlike-text-color`, `--hearthlike-header-font-size`,
  `--hearthlike-header-padding`, `--hearthlike-people-gap`, `--hearthlike-people-padding`, `--hearthlike-avatar-size`,
  `--hearthlike-avatar-font-size`, `--hearthlike-ring-width`, `--hearthlike-name-font-size`,
  `--hearthlike-button-background`, `--hearthlike-button-color`, `--hearthlike-button-active-color`,
  `--hearthlike-button-icon-size`, `--hearthlike-button-padding`, `--hearthlike-calendar-min-height`.
  The calendar views (inside this card or on their own) also read `--hearthlike-tab-font-size` (14px),
  `--hearthlike-day-name-size` (20px, week column headings), `--hearthlike-day-number-size` (29px, week),
  `--hearthlike-event-title-size` (14px) and `--hearthlike-event-time-size` (11.9px).
- **The `style` option**: your CSS is applied inside the card and wins over the built-in rules. It is also
  in the visual editor (General tab).

  ```yaml
  type: custom:hearthlike-dashboard-card
  style: |
    :host { --hearthlike-avatar-size: 120px; }
    .clock { color: orange; }
    .btn.on ha-icon { color: hotpink; }
  ```

  Classes: `.header .weather .clock .people .person .avatar .badge .pname .cal .buttons .btn` (with
  `.on`, `.off` or `.unavailable`) `.bname .bstate`.
- **`::part()`** (for a stylesheet in the same tree as the card, which Home Assistant's own shadow DOM usually prevents; the `style` option is the reliable way): `root`, `header`, `weather`, `clock`, `people`, `person`, `avatar`, `badge`,
  `person-name`, `calendar`, `buttons`, `button`, `button-on` / `button-off` / `button-unavailable`,
  `button-icon`, `button-name`, `button-state`.

The CSS variables also work when set from card-mod or a theme, since they inherit into the card.

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

- **Home Assistant 2026.10.1** or newer (the oldest release the cards have been tested on)
- **Calendar cards**: one or more `calendar.*` entities that support creating and editing events
  (for example [Local Calendar](https://www.home-assistant.io/integrations/local_calendar/))

The day, week and month cards size themselves to their container, so place them in a panel view or a
sections/grid layout with a fixed height. See [`example-dashboard.yaml`](example-dashboard.yaml) for a
complete configuration of every card.

## License

MIT — see [LICENSE](LICENSE).
