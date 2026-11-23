# Changelog

## [Unreleased]

### Added
- `hearthlike-dashboard-card`: all-in-one panel-view wall display (weather and clock, people badges, the calendar card, quick toggle buttons), with a visual editor.
- `hearthlike-dashboard-card`: `weather_tap_action` (more-info by default, or navigate / URL / call a service / none), and reorder arrows for people and buttons in the editor.
- `hearthlike-calendar-card`: `default_view` (which tab shows first) and `idle_timeout` (return to that view and today after inactivity), with a View tab in the editor.
- Add-event button: centred plus icon, and its colour follows the HA theme (`--hearthlike-fab-color` / `--hearthlike-fab-icon-color` to override).
- Day, week and month views: per-calendar `icon` (MDI icon, emoji, image or entity picture) shown before event titles.
- `hearthlike-calendar-card`: Day / Weekly / Monthly tabs with a built-in add-event button and a visual editor.
- `hearthlike-day-card`: per-person hourly day view with all-day row and now-line.
- `hearthlike-week-card`: weekly hourly grid with overlapping-event layout.
- `hearthlike-month-card`: month grid.
- `hearthlike-fab-card`: floating add-event button.
- Edit and delete events (including recurring ones) from the day, week and month views.
