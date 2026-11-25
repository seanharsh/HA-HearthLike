// Styles both layouts share: event icons and the event dialogs.
const HEARTHLIKE_WEEK_SHARED_CSS = `
  .evicon { display:inline-block; width:1.15em; height:1.15em; margin-right:0.35em; vertical-align:-0.2em; --mdc-icon-size:1.15em; object-fit:contain; } span.evicon { width:auto; height:auto; line-height:1; vertical-align:baseline; } .evpic { border-radius:50%; object-fit:cover; }
  .hd-content { padding:20px 24px 24px; color:var(--primary-text-color); font-size:14px; }
  .hd-row { display:flex; align-items:center; gap:8px; margin:0 0 8px; }
  .hd-row ha-icon { color:var(--primary-text-color); flex:none; width:20px; height:22px; }
  .hd-info { font-size:14px; }
  .hd-info a { color:var(--primary-text-color); text-decoration:none; }
  .hd-desc { font-size:14px; color:var(--primary-text-color); white-space:normal; border-top:1px solid var(--divider-color); padding-top:16px; margin-top:16px; }
  .hd-actions { display:flex; gap:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--divider-color); }
  .hd-btn { display:flex; align-items:center; gap:6px; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }
  .hd-btn ha-icon { width:18px; height:18px; }
  .hd-btn-danger { color:#e24b4a; border-color:#e24b4a; }
  .hd-error { color:#e24b4a; font-size:13px; min-height:16px; margin-top:8px; }
  .hd-confirm-label { font-size:15px; color:var(--primary-text-color); margin-bottom:4px; }
  .af-content { display:flex; flex-direction:column; gap:14px; padding:20px 24px 4px; min-width:280px; color:var(--primary-text-color); }
  .af-row { display:flex; gap:12px; }
  .af-row .af-field { flex:1; }
  .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }
  .af-label { color:var(--secondary-text-color); }
  .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }
  .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }
  .af-error { color:#e24b4a; font-size:13px; min-height:16px; }
  .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; flex-wrap:wrap; }
  .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }
  .af-btn-text { background:none; color:var(--primary-color, #378ADD); }
  .af-btn-filled { background:var(--primary-color, #378ADD); color:#fff; }
  .af-btn-danger { background:#e24b4a; color:#fff; }
`;

class HearthlikeWeekCard extends HTMLElement {
  // Used when auto-discovering calendars (no "calendars" configured at all)
  // so every calendar gets a distinct, stable color without the user having
  // to pick one.
  _DEFAULT_PALETTE = ['#378ADD', '#E67E22', '#8E44AD', '#27AE60', '#E74C3C', '#16A085', '#F39C12', '#2980B9'];

  static getStubConfig() {
    // Empty config: with no "calendars" set at all, the card auto-discovers
    // every calendar.* entity on the system, so it renders something useful
    // immediately. Add a "calendars" array to pick specific calendars and
    // assign your own colors.
    return {};
  }

  static getConfigElement() {
    return document.createElement('hearthlike-week-card-editor');
  }

  setConfig(config) {
    config = config || {};
    this._config = {
      // "list" (default): scrolling day columns, one box per event. "grid": one week as an hourly grid.
      layout: config.layout === 'grid' ? 'grid' : 'list',
      // list layout: how many weeks, starting with the current one, can be scrolled through.
      weeks: Math.min(26, Math.max(1, Math.round(Number(config.weeks)) || 13)),
      hour_start: config.hour_start ?? 0,
      hour_end: config.hour_end ?? 24,
      px_per_hour: config.px_per_hour ?? 80,
      // An empty/omitted "calendars" is the auto-discovery signal (see
      // _getCalendars) rather than an error - lets the card work with zero
      // configuration and still let power users lock in an explicit list.
      calendars: Array.isArray(config.calendars) ? config.calendars : [],
    };
    this._pinnedThisWeek = true;
    this._selectedWeekStart = this._startOfWeek(new Date());
    this._events = null;
    this._fetchedKey = null;
    // Tracks the last "hearthlike-calendar-updated" signal this card has acted
    // on (see _maybeFetch). window.__hearthlikeCalendarUpdatedAt is a persistent
    // marker rather than a one-shot event, so it still works even if this
    // card wasn't mounted (e.g. a different tab was active) at the moment
    // the FAB created a new event.
    this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt || 0;
    // Same persistent-centering approach as hearthlike-day-card: keep re-centering
    // on current time on every render/resize until the viewer manually
    // scrolls, rather than a one-shot flag that can get stuck on a timing race.
    this._userScrolled = false;
    this._lastScrollTop = null;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Lets the stylesheet soften the past-event dimming on light themes.
    this.toggleAttribute('light', !!(hass && hass.themes && hass.themes.darkMode === false));
    this._startTicking();
    this._maybeFetch();
  }

  connectedCallback() {
    this._startTicking();
    // The tabbed-card this lives in actually disconnects/reconnects the same
    // element on every tab switch (rather than just hiding it with CSS), and
    // reattaching a scrollable element resets its native scrollTop to 0
    // regardless of what we'd remembered. So "reconnected" is treated as
    // "the viewer just switched into this view" and always re-centers on the
    // current time, rather than trying to preserve a scroll position that's
    // already been silently reset out from under us.
    this._userScrolled = false;
    this._lastScrollTop = null;
    this._listScroll = 0;
    this._render();
    if (!this._onCalendarUpdated) {
      this._onCalendarUpdated = () => this._forceRefresh();
      window.addEventListener('hearthlike-calendar-updated', this._onCalendarUpdated);
    }
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
    this._tickStarted = false;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._onCalendarUpdated) {
      window.removeEventListener('hearthlike-calendar-updated', this._onCalendarUpdated);
      this._onCalendarUpdated = null;
    }
  }

  // Called when the "+" FAB successfully creates a new event, so the newly
  // added event shows up immediately instead of waiting for the next 30s
  // poll or a manual reload.
  _forceRefresh() {
    this._events = null;
    this._maybeFetch();
  }

  getCardSize() {
    return 10;
  }

  // Returns the configured calendars, or - if "calendars" was left empty in
  // the config - auto-discovers one entry per calendar.* entity currently
  // known to hass, sorted for a stable order, colored from the default
  // palette. This is what lets the card render usefully with zero config.
  _getCalendars() {
    if (this._config.calendars && this._config.calendars.length) return this._config.calendars;
    if (!this._hass || !this._hass.states) return [];
    const calIds = Object.keys(this._hass.states)
      .filter((id) => id.startsWith('calendar.'))
      .sort();
    return calIds.map((id, i) => ({
      entity: id,
      color: this._DEFAULT_PALETTE[i % this._DEFAULT_PALETTE.length],
    }));
  }

  _startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  _startOfWeek(d) {
    const x = this._startOfDay(d);
    x.setDate(x.getDate() - x.getDay()); // back up to Sunday
    return x;
  }

  _dateKey(d) {
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  _localYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  _startTicking() {
    if (this._tickStarted) return;
    this._tickStarted = true;
    this._interval = setInterval(() => {
      if (this._pinnedThisWeek) {
        const thisWeek = this._startOfWeek(new Date());
        if (thisWeek.getTime() !== this._selectedWeekStart.getTime()) {
          this._selectedWeekStart = thisWeek;
          this._events = null;
        }
      }
      this._maybeFetch(true);
      this._render();
    }, 30000);
  }

  // force: re-query even when this range is already loaded (the 30s tick uses it to pick up outside changes).
  async _maybeFetch(force) {
    if (
      window.__hearthlikeCalendarUpdatedAt &&
      window.__hearthlikeCalendarUpdatedAt !== this._lastCalendarUpdateSeen
    ) {
      this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt;
      this._events = null;
    }
    if (!this._hass || !this._config) return;
    const key = this._dateKey(this._selectedWeekStart);
    if (!force && this._fetchedKey === key && this._events) return;
    this._fetchedKey = key;
    const start = new Date(this._selectedWeekStart);
    const end = new Date(this._selectedWeekStart);
    end.setDate(end.getDate() + 7 * (this._config.layout === 'list' ? this._config.weeks : 1));
    const results = {};
    let failed = false;
    await Promise.all(
      this._getCalendars().map(async (cal) => {
        try {
          const path =
            'calendars/' +
            cal.entity +
            '?start=' +
            encodeURIComponent(start.toISOString()) +
            '&end=' +
            encodeURIComponent(end.toISOString());
          results[cal.entity] = (await this._hass.callApi('GET', path)) || [];
        } catch (e) {
          // Keep what we already had for this calendar and retry on the next tick.
          failed = true;
          results[cal.entity] = (this._events && this._events[cal.entity]) || [];
        }
      })
    );
    if (this._dateKey(this._selectedWeekStart) === key) {
      if (failed) this._fetchedKey = null;
      const changed = !this._events || JSON.stringify(this._events) !== JSON.stringify(results);
      this._events = results;
      if (changed) this._render();
    }
  }

  _shiftWeek(delta) {
    const d = new Date(this._selectedWeekStart);
    d.setDate(d.getDate() + delta * 7);
    this._selectedWeekStart = this._startOfWeek(d);
    this._pinnedThisWeek =
      this._dateKey(this._selectedWeekStart) === this._dateKey(this._startOfWeek(new Date()));
    this._events = null;
    this._render();
    this._maybeFetch();
  }

  _goThisWeek() {
    this._selectedWeekStart = this._startOfWeek(new Date());
    this._pinnedThisWeek = true;
    this._events = null;
    this._userScrolled = false;
    this._listScroll = 0;
    this._render();
    this._maybeFetch();
  }

  _iconFor(entityId) {
    const c = this._getCalendars().find((x) => x.entity === entityId);
    return c && c.icon;
  }

  // Small icon shown before an event title. `icon` is an MDI name (mdi:soccer), an image URL or /local path,
  // an entity id (its picture, else its icon), or any other text, which is shown as is (an emoji).
  _iconHtml(icon) {
    const v = icon == null ? '' : String(icon).trim();
    if (!v) return '';
    if (/^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(v)) return `<ha-icon class="evicon" icon="${this._esc(v)}"></ha-icon>`;
    if (/^(\/|https?:|data:image\/)/i.test(v)) return `<img class="evicon" src="${this._esc(v)}" alt="">`;
    const st = /^[a-z_]+\.[a-z0-9_]+$/.test(v) && this._hass && this._hass.states && this._hass.states[v];
    if (st) {
      const a = st.attributes || {};
      if (a.entity_picture) return `<img class="evicon evpic" src="${this._esc(a.entity_picture)}" alt="">`;
      if (a.icon) return `<ha-icon class="evicon" icon="${this._esc(a.icon)}"></ha-icon>`;
      return `<span class="evicon">${this._esc(String(a.friendly_name || v).slice(0, 1).toUpperCase())}</span>`;
    }
    return `<span class="evicon">${this._esc(v)}</span>`;
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _formatHour(h) {
    const hh = ((h % 24) + 24) % 24;
    const period = hh < 12 ? 'AM' : 'PM';
    let h12 = hh % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ' ' + period;
  }

  _formatTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const period = h < 12 ? 'AM' : 'PM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + period;
  }

  _rawEventsForDay(dayDate) {
    // Combine every configured calendar's events, tag each with its color.
    const out = [];
    const ymd = this._localYMD(dayDate);
    for (const cal of this._getCalendars()) {
      const events = (this._events && this._events[cal.entity]) || [];
      for (const e of events) {
        const isAllDay = !!(e.start && e.start.date && !e.start.dateTime);
        if (isAllDay) {
          const startYMD = e.start.date;
          const endYMD = e.end.date;
          if (!(startYMD <= ymd && ymd < endYMD)) continue;
          out.push({
            title: e.summary || '(untitled)',
            isAllDay: true,
            color: cal.color,
            entityId: cal.entity,
            description: e.description || '',
            location: e.location || '',
            startRaw: startYMD,
            endRaw: endYMD,
            uid: e.uid || null,
            recurrenceId: e.recurrence_id || null,
            rrule: e.rrule || null,
          });
        } else {
          out.push({
            title: e.summary || '(untitled)',
            isAllDay: false,
            startRaw: e.start.dateTime,
            endRaw: e.end.dateTime,
            color: cal.color,
            entityId: cal.entity,
            description: e.description || '',
            location: e.location || '',
            uid: e.uid || null,
            recurrenceId: e.recurrence_id || null,
            rrule: e.rrule || null,
          });
        }
      }
    }
    return out;
  }

  _calendarName(entityId) {
    const st = this._hass && this._hass.states && this._hass.states[entityId];
    return (st && st.attributes && st.attributes.friendly_name) || entityId;
  }

  // Mirrors the exact string Monthly's underlying week-planner-card produces
  // in its own event-detail popup (e.g. "Monday 20 July 2026" for an all-day
  // event, "Thursday 23 July 2026 8:00 AM - 8:30 AM" for a timed one) — built
  // from fixed weekday/month names rather than toLocaleDateString so it can't
  // drift from Monthly's format if the browser's locale ever changes.
  _WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  _MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  _formatLongDate(d) {
    return `${this._WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${this._MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }

  _formatClockTime(d) {
    let h = d.getHours();
    const period = h < 12 ? 'AM' : 'PM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + period;
  }

  _formatEventDateTime(record) {
    if (record.isAllDay) {
      const s = new Date(record.startRaw + 'T00:00:00');
      const endExclusive = new Date(record.endRaw + 'T00:00:00');
      const lastDay = new Date(endExclusive);
      lastDay.setDate(lastDay.getDate() - 1);
      if (this._dateKey(s) === this._dateKey(lastDay)) {
        return this._formatLongDate(s);
      }
      return this._formatLongDate(s) + ' - ' + this._formatLongDate(lastDay);
    }
    const s = new Date(record.startRaw);
    const e = new Date(record.endRaw);
    if (this._dateKey(s) === this._dateKey(e)) {
      return this._formatLongDate(s) + ' ' + this._formatClockTime(s) + ' - ' + this._formatClockTime(e);
    }
    return (
      this._formatLongDate(s) + ' ' + this._formatClockTime(s) +
      ' - ' +
      this._formatLongDate(e) + ' ' + this._formatClockTime(e)
    );
  }

  _closeEventDialog() {
    const existing = this.shadowRoot.querySelector('ha-dialog.hearthlike-event-dialog');
    if (existing) existing.remove();
    this._dialogOpen = false;
  }

  // Bit flags from HA's CalendarEntityFeature enum. A calendar entity only
  // supports edit/delete if it advertises the matching bit in its own
  // `supported_features` attribute - e.g. the built-in Google Calendar
  // integration sets CREATE_EVENT|DELETE_EVENT (3) but never UPDATE_EVENT,
  // so "Edit" simply never appears for those calendars, while "Delete" does.
  _CAL_FEATURE_DELETE = 2;
  _CAL_FEATURE_UPDATE = 4;

  _calendarFeatures(entityId) {
    const st = this._hass && this._hass.states && this._hass.states[entityId];
    return (st && st.attributes && st.attributes.supported_features) || 0;
  }

  _pad(n) {
    return String(n).padStart(2, '0');
  }

  _toDateInputValue(d) {
    return d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate());
  }

  _toTimeInputValue(d) {
    return this._pad(d.getHours()) + ':' + this._pad(d.getMinutes());
  }

  _addOneDay(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate());
  }

  // Builds a "YYYY-MM-DDTHH:mm:ss±HH:MM" string in the browser's local
  // timezone - the same shape HA's REST calendar API returns for timed
  // events (e.g. the "dateTime" field), which is what the
  // `calendar/event/update` websocket command's dtstart/dtend fields expect.
  _toISOWithOffset(d) {
    const offMin = -d.getTimezoneOffset();
    const sign = offMin >= 0 ? '+' : '-';
    const abs = Math.abs(offMin);
    const offH = this._pad(Math.floor(abs / 60));
    const offM = this._pad(abs % 60);
    return (
      d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate()) +
      'T' + this._pad(d.getHours()) + ':' + this._pad(d.getMinutes()) + ':' + this._pad(d.getSeconds()) +
      sign + offH + ':' + offM
    );
  }

  _openEventDialog(record) {
    if (!record) return;
    this._closeEventDialog();
    const dlg = document.createElement('ha-dialog');
    dlg.className = 'hearthlike-event-dialog';
    // Newer ha-dialog takes headerTitle; older releases use heading.
    dlg.headerTitle = record.title;
    dlg.heading = record.title;
    dlg.addEventListener('closed', () => {
      dlg.remove();
      this._dialogOpen = false;
    });
    this.shadowRoot.appendChild(dlg);
    this._renderEventDialogView(dlg, record);
    dlg.open = true;
    this._dialogOpen = true;
  }

  _renderEventDialogView(dlg, record) {
    const calName = this._calendarName(record.entityId);
    const dtLabel = this._formatEventDateTime(record);
    const mapsUrl = record.location
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(record.location)
      : '';
    const features = this._calendarFeatures(record.entityId);
    const canDelete = !!(record.uid && (features & this._CAL_FEATURE_DELETE));
    const canUpdate = !!(record.uid && (features & this._CAL_FEATURE_UPDATE));
    dlg.innerHTML = `
      <div class="hd-content">
        <div class="hd-row"><ha-icon icon="mdi:calendar-account"></ha-icon><div class="hd-info">${this._esc(calName)}</div></div>
        <div class="hd-row"><ha-icon icon="mdi:calendar-clock"></ha-icon><div class="hd-info">${this._esc(dtLabel)}</div></div>
        ${record.location ? `<div class="hd-row"><ha-icon icon="mdi:map-marker"></ha-icon><div class="hd-info"><a href="${this._esc(mapsUrl)}" target="_blank" rel="noopener">${this._esc(record.location)}</a></div></div>` : ''}
        ${record.description ? `<div class="hd-desc">${this._esc(record.description)}</div>` : ''}
        ${(canUpdate || canDelete) ? `
        <div class="hd-actions">
          ${canUpdate ? '<button class="hd-btn" id="hd-edit"><ha-icon icon="mdi:pencil"></ha-icon>Edit</button>' : ''}
          ${canDelete ? '<button class="hd-btn hd-btn-danger" id="hd-delete"><ha-icon icon="mdi:trash-can-outline"></ha-icon>Delete</button>' : ''}
        </div>` : ''}
      </div>
    `;
    const editBtn = dlg.querySelector('#hd-edit');
    if (editBtn) editBtn.addEventListener('click', () => this._renderEventEditView(dlg, record));
    const deleteBtn = dlg.querySelector('#hd-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', () => this._renderDeleteConfirmView(dlg, record));
  }

  _renderDeleteConfirmView(dlg, record) {
    const isRecurring = !!record.recurrenceId;
    dlg.innerHTML = `
      <div class="hd-content">
        <div class="hd-confirm-label">${isRecurring ? 'This is a recurring event. What would you like to delete?' : 'Delete this event?'}</div>
        <div class="hd-error" id="hd-error"></div>
        <div class="af-actions">
          <button class="af-btn af-btn-text" id="hd-cancel">Cancel</button>
          ${isRecurring ? `
          <button class="af-btn af-btn-danger" id="hd-del-this">This event</button>
          <button class="af-btn af-btn-danger" id="hd-del-future">This &amp; following</button>
          <button class="af-btn af-btn-danger" id="hd-del-all">All events</button>` : `
          <button class="af-btn af-btn-danger" id="hd-del-this">Delete</button>`}
        </div>
      </div>
    `;
    dlg.querySelector('#hd-cancel').addEventListener('click', () => this._renderEventDialogView(dlg, record));
    dlg.querySelector('#hd-del-this').addEventListener('click', () => this._submitDelete(dlg, record, 'THIS'));
    const futureBtn = dlg.querySelector('#hd-del-future');
    if (futureBtn) futureBtn.addEventListener('click', () => this._submitDelete(dlg, record, 'THISANDFUTURE'));
    const allBtn = dlg.querySelector('#hd-del-all');
    if (allBtn) allBtn.addEventListener('click', () => this._submitDelete(dlg, record, 'ALL'));
  }

  async _submitDelete(dlg, record, scope) {
    const errorEl = dlg.querySelector('#hd-error');
    if (errorEl) errorEl.textContent = '';
    const params = { type: 'calendar/event/delete', entity_id: record.entityId, uid: record.uid };
    if (scope === 'THIS') {
      if (record.recurrenceId) params.recurrence_id = record.recurrenceId;
    } else if (scope === 'THISANDFUTURE') {
      if (record.recurrenceId) params.recurrence_id = record.recurrenceId;
      params.recurrence_range = 'THISANDFUTURE';
    }
    // scope === 'ALL' deletes the whole series by uid alone (no recurrence_id).
    try {
      await this._hass.callWS(params);
      this._closeEventDialog();
      // Same persistent-marker signal the FAB uses after creating an event -
      // makes every hearthlike-day-card/hearthlike-week-card instance (including
      // ones on a currently-inactive tab) drop its cache and refetch.
      window.__hearthlikeCalendarUpdatedAt = Date.now();
      window.dispatchEvent(new CustomEvent('hearthlike-calendar-updated'));
      this._forceRefresh();
    } catch (e) {
      if (errorEl) errorEl.textContent = 'Failed to delete: ' + (e && e.message ? e.message : 'unknown error');
    }
  }

  _renderEventEditView(dlg, record) {
    const s = record.isAllDay ? new Date(record.startRaw + 'T00:00:00') : new Date(record.startRaw);
    let endForInput;
    if (record.isAllDay) {
      endForInput = new Date(record.endRaw + 'T00:00:00');
      endForInput.setDate(endForInput.getDate() - 1);
    } else {
      endForInput = new Date(record.endRaw);
    }
    dlg.innerHTML = `
      <div class="af-content">
        <label class="af-field">
          <span class="af-label">Title</span>
          <input class="af-input" id="ef-title" type="text" value="${this._esc(record.title)}" />
        </label>
        <label class="af-checkrow">
          <input type="checkbox" id="ef-allday" ${record.isAllDay ? 'checked' : ''} />
          <span>All day</span>
        </label>
        <div class="af-row">
          <label class="af-field">
            <span class="af-label">Start date</span>
            <input class="af-input" id="ef-start-date" type="date" value="${this._toDateInputValue(s)}" />
          </label>
          <label class="af-field" id="ef-start-time-wrap">
            <span class="af-label">Start time</span>
            <input class="af-input" id="ef-start-time" type="time" value="${this._toTimeInputValue(s)}" />
          </label>
        </div>
        <div class="af-row">
          <label class="af-field">
            <span class="af-label">End date</span>
            <input class="af-input" id="ef-end-date" type="date" value="${this._toDateInputValue(endForInput)}" />
          </label>
          <label class="af-field" id="ef-end-time-wrap">
            <span class="af-label">End time</span>
            <input class="af-input" id="ef-end-time" type="time" value="${this._toTimeInputValue(endForInput)}" />
          </label>
        </div>
        <label class="af-field">
          <span class="af-label">Location</span>
          <input class="af-input" id="ef-location" type="text" value="${this._esc(record.location || '')}" />
        </label>
        <label class="af-field">
          <span class="af-label">Description</span>
          <textarea class="af-input" id="ef-desc" rows="2">${this._esc(record.description || '')}</textarea>
        </label>
        <div class="af-error" id="hd-error"></div>
        <div class="af-actions">
          <button class="af-btn af-btn-text" id="ef-cancel">Cancel</button>
          <button class="af-btn af-btn-filled" id="ef-save">Save</button>
        </div>
      </div>
    `;
    const alldayEl = dlg.querySelector('#ef-allday');
    const startTimeWrap = dlg.querySelector('#ef-start-time-wrap');
    const endTimeWrap = dlg.querySelector('#ef-end-time-wrap');
    const syncAllDay = () => {
      const isAllDay = alldayEl.checked;
      startTimeWrap.style.display = isAllDay ? 'none' : '';
      endTimeWrap.style.display = isAllDay ? 'none' : '';
    };
    alldayEl.addEventListener('change', syncAllDay);
    syncAllDay();
    dlg.querySelector('#ef-cancel').addEventListener('click', () => this._renderEventDialogView(dlg, record));
    dlg.querySelector('#ef-save').addEventListener('click', () => this._submitEditDialog(dlg, record));
  }

  async _submitEditDialog(dlg, record) {
    const errorEl = dlg.querySelector('#hd-error');
    errorEl.textContent = '';
    const title = dlg.querySelector('#ef-title').value.trim();
    const isAllDay = dlg.querySelector('#ef-allday').checked;
    const startDate = dlg.querySelector('#ef-start-date').value;
    const endDate = dlg.querySelector('#ef-end-date').value;
    const startTime = dlg.querySelector('#ef-start-time').value;
    const endTime = dlg.querySelector('#ef-end-time').value;
    const location = dlg.querySelector('#ef-location').value;
    const description = dlg.querySelector('#ef-desc').value;

    if (!title) {
      errorEl.textContent = 'Title is required.';
      return;
    }

    const eventPayload = { summary: title };
    if (description) eventPayload.description = description;
    if (location) eventPayload.location = location;

    if (isAllDay) {
      if (!startDate) {
        errorEl.textContent = 'Start date is required.';
        return;
      }
      const effectiveEnd = endDate && endDate > startDate ? this._addOneDay(endDate) : this._addOneDay(startDate);
      eventPayload.dtstart = startDate;
      eventPayload.dtend = effectiveEnd;
    } else {
      if (!startDate || !startTime || !endDate || !endTime) {
        errorEl.textContent = 'Start and end date/time are required.';
        return;
      }
      const startDt = new Date(startDate + 'T' + startTime + ':00');
      const endDt = new Date(endDate + 'T' + endTime + ':00');
      if (endDt <= startDt) {
        errorEl.textContent = 'End must be after start.';
        return;
      }
      eventPayload.dtstart = this._toISOWithOffset(startDt);
      eventPayload.dtend = this._toISOWithOffset(endDt);
    }

    const params = {
      type: 'calendar/event/update',
      entity_id: record.entityId,
      uid: record.uid,
      event: eventPayload,
    };
    if (record.recurrenceId) params.recurrence_id = record.recurrenceId;

    try {
      await this._hass.callWS(params);
      this._closeEventDialog();
      window.__hearthlikeCalendarUpdatedAt = Date.now();
      window.dispatchEvent(new CustomEvent('hearthlike-calendar-updated'));
      this._forceRefresh();
    } catch (e) {
      errorEl.textContent = 'Failed to save: ' + (e && e.message ? e.message : 'unknown error');
    }
  }

  _layoutTimedEvents(dayDate, hourStart, hourEnd, pxPerHour) {
    const dayStartMin = hourStart * 60;
    const dayEndMin = hourEnd * 60;
    const dayBase = this._startOfDay(dayDate);
    const raw = this._rawEventsForDay(dayDate).filter((e) => !e.isAllDay);
    let items = [];
    for (const e of raw) {
      const s = new Date(e.startRaw);
      const en = new Date(e.endRaw);
      let startMin = Math.round((s - dayBase) / 60000);
      let endMin = Math.round((en - dayBase) / 60000);
      if (endMin <= dayStartMin || startMin >= dayEndMin) continue;
      const trueStartMin = startMin;
      const trueEndMin = endMin;
      startMin = Math.max(startMin, dayStartMin);
      endMin = Math.min(endMin, dayEndMin);
      if (endMin <= startMin) endMin = startMin + 15;
      items.push({
        title: e.title,
        startMin,
        endMin,
        trueStartMin,
        trueEndMin,
        color: e.color,
        entityId: e.entityId,
        description: e.description,
        location: e.location,
        startRaw: e.startRaw,
        endRaw: e.endRaw,
        uid: e.uid,
        recurrenceId: e.recurrenceId,
        rrule: e.rrule,
      });
    }
    items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const clusters = [];
    let cur = [];
    let curEnd = -Infinity;
    for (const it of items) {
      if (cur.length && it.startMin >= curEnd) {
        clusters.push(cur);
        cur = [];
        curEnd = -Infinity;
      }
      cur.push(it);
      curEnd = Math.max(curEnd, it.endMin);
    }
    if (cur.length) clusters.push(cur);
    const laidOut = [];
    for (const cluster of clusters) {
      const colsEnd = [];
      for (const it of cluster) {
        let placed = false;
        for (let i = 0; i < colsEnd.length; i++) {
          if (colsEnd[i] <= it.startMin) {
            it._col = i;
            colsEnd[i] = it.endMin;
            placed = true;
            break;
          }
        }
        if (!placed) {
          it._col = colsEnd.length;
          colsEnd.push(it.endMin);
        }
      }
      const numCols = colsEnd.length;
      for (const it of cluster) {
        laidOut.push({
          title: it.title,
          startMin: it.trueStartMin,
          endMin: it.trueEndMin,
          top: ((it.startMin - dayStartMin) / 60) * pxPerHour,
          height: Math.max(((it.endMin - it.startMin) / 60) * pxPerHour, 68),
          leftPct: (it._col / numCols) * 100,
          widthPct: (1 / numCols) * 100,
          color: it.color,
          entityId: it.entityId,
          description: it.description,
          location: it.location,
          startRaw: it.startRaw,
          endRaw: it.endRaw,
          uid: it.uid,
          recurrenceId: it.recurrenceId,
          rrule: it.rrule,
        });
      }
    }
    return laidOut;
  }

  // Positions a box that spans one or more of the 7 day columns, accounting
  // for the real 15px flex `gap` between columns - a plain
  // fraction-of-numCols percentage would misalign a box under the wrong
  // columns once a real gap exists between them. Same technique already
  // used by hearthlike-day-card for its merged multi-person all-day boxes.
  _colSpanBox(numCols, gapPx, startIdx, spanCount) {
    const availPx = `(100% - ${(numCols - 1) * gapPx}px)`;
    const colWidthExpr = `${availPx} / ${numCols}`;
    const left = `calc(${startIdx} * (${colWidthExpr}) + ${startIdx * gapPx}px)`;
    const width = `calc((${colWidthExpr}) * ${spanCount} + ${(spanCount - 1) * gapPx}px)`;
    return { left, width };
  }

  _dayIndexInWeek(weekStart, ymd) {
    const d = new Date(ymd + 'T00:00:00');
    return Math.round((d - weekStart) / 86400000);
  }

  // Merges a multi-day all-day event (e.g. a week-long vacation) into a
  // single box spanning every day column it covers, instead of rendering one
  // separate badge per day it happens to be active on. Mirrors
  // hearthlike-day-card's _mergedAllDayEvents, but here the "columns" being
  // spanned are the 7 day columns of the visible week rather than person
  // columns within a single day.
  _mergedWeekAllDayEvents(days) {
    const weekStart = days[0];
    const weekStartYMD = this._localYMD(days[0]);
    const weekEndYMD = this._localYMD(days[6]);
    const today = this._startOfDay(new Date());
    const map = new Map();
    for (const cal of this._getCalendars()) {
      const events = (this._events && this._events[cal.entity]) || [];
      for (const e of events) {
        const isAllDay = !!(e.start && e.start.date && !e.start.dateTime);
        if (!isAllDay) continue;
        const startYMD = e.start.date;
        const endYMD = e.end.date; // exclusive
        // Skip events that don't overlap the visible week at all.
        if (endYMD <= weekStartYMD || startYMD > weekEndYMD) continue;
        const title = e.summary || '(untitled)';
        const uid = e.uid || null;
        // Prefer the event's own uid as the identity key (robust against
        // multi-day spans); fall back to the same title+color dedup the
        // old per-day code used, for the rare event with no uid.
        const key = uid ? 'u:' + uid : cal.color + '|' + title + '|' + startYMD + '|' + endYMD;
        if (map.has(key)) continue;
        const lastInclDate = new Date(endYMD + 'T00:00:00');
        lastInclDate.setDate(lastInclDate.getDate() - 1);
        const minIdx = Math.max(0, this._dayIndexInWeek(weekStart, startYMD));
        const maxIdx = Math.min(6, this._dayIndexInWeek(weekStart, this._localYMD(lastInclDate)));
        map.set(key, {
          title,
          color: cal.color,
          entityId: cal.entity,
          description: e.description || '',
          location: e.location || '',
          startRaw: startYMD,
          endRaw: endYMD,
          uid,
          recurrenceId: e.recurrence_id || null,
          rrule: e.rrule || null,
          minIdx,
          maxIdx,
          // The whole span is faded together only once every day it covers
          // has fully elapsed - a box that's still running today or into
          // the future stays bright, matching how a whole past day (rather
          // than an individual past event) gets dimmed elsewhere.
          isPast: lastInclDate.getTime() < today.getTime(),
        });
      }
    }
    const items = Array.from(map.values());
    items.sort((a, b) => a.minIdx - b.minIdx || (b.maxIdx - b.minIdx) - (a.maxIdx - a.minIdx));
    const lanes = [];
    for (const it of items) {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] < it.minIdx) {
          it._lane = i;
          lanes[i] = it.maxIdx;
          placed = true;
          break;
        }
      }
      if (!placed) {
        it._lane = lanes.length;
        lanes.push(it.maxIdx);
      }
    }
    return {
      items: items.map((it) => ({
        title: it.title,
        color: it.color,
        lane: it._lane,
        minIdx: it.minIdx,
        maxIdx: it.maxIdx,
        entityId: it.entityId,
        description: it.description,
        location: it.location,
        startRaw: it.startRaw,
        endRaw: it.endRaw,
        uid: it.uid,
        recurrenceId: it.recurrenceId,
        rrule: it.rrule,
        isPast: it.isPast,
      })),
      laneCount: lanes.length,
    };
  }

  // ---- list layout: seven day columns per row, scrolling through the coming weeks ----

  // Events touching one day, all-day first then by start time. Timed events that run past midnight are
  // clipped to the day, and a day they cover completely shows as "Entire day".
  _listEventsForDay(day) {
    const start = this._startOfDay(day);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const out = [];
    for (const e of this._rawEventsForDay(day)) {
      if (e.isAllDay) {
        out.push({ ...e, label: 'Entire day', order: 0, ended: false });
        continue;
      }
      const s = new Date(e.startRaw);
      const en = new Date(e.endRaw);
      if (!(s < end && (en > start || s >= start))) continue;
      const whole = s <= start && en >= end;
      const from = s > start ? s : start;
      const to = en < end ? en : end;
      out.push({
        ...e,
        label: whole ? 'Entire day' : this._formatClockTime(from) + ' - ' + this._formatClockTime(to),
        order: whole ? 0 : from.getTime(),
        ended: en <= new Date(),
      });
    }
    return out.sort((a, b) => a.order - b.order);
  }

  _renderList() {
    const today = this._startOfDay(new Date());
    this._dialogRecords = [];
    const daysHtml = [];
    for (let i = 0; i < 7 * this._config.weeks; i++) {
      const d = new Date(this._selectedWeekStart);
      d.setDate(d.getDate() + i);
      const isToday = d.getTime() === today.getTime();
      const isPastDay = d < today;
      const events = this._listEventsForDay(d);
      const eventsHtml = events
        .map((e) => {
          const ridx = this._dialogRecords.push(e) - 1;
          return `<div class="ev${isToday && e.ended ? ' past' : ''}" part="event" data-idx="${ridx}" style="background:${this._esc(e.color)};border-color:${this._esc(e.color)}">
            <div class="ev-time">${e.label}</div>
            <div class="ev-title">${this._iconHtml(this._iconFor(e.entityId))}${this._esc(e.title)}</div>
          </div>`;
        })
        .join('');
      daysHtml.push(`<div class="day${isToday ? ' today' : ''}${isPastDay ? ' past-day' : ''}" part="day">
        <div class="date"><span class="number">${d.getDate()}</span><span class="month">${this._MONTH_NAMES[d.getMonth()]}</span><span class="month short">${this._MONTH_NAMES[d.getMonth()].slice(0, 3)}</span><span class="weekday">${this._WEEKDAY_NAMES[d.getDay()].slice(0, 3)}</span></div>
        <div class="events">${eventsHtml || (this._events ? '<div class="none">No events</div>' : '')}</div>
      </div>`);
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:100%; }
        ha-card { height:100%; min-height:var(--hearthlike-view-min-height, 400px); box-sizing:border-box; padding:0 16px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; border:none; container-type:inline-size; }
        .wk-head, .wk-grid { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); column-gap:15px; }
        .wk-head { flex:none; padding-top:10px; overflow:hidden; scrollbar-gutter:stable; scrollbar-width:thin; }
        .wk-head div { text-align:center; font-size:var(--hearthlike-day-name-size, 20px); font-weight:600; line-height:32px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .list-scroll { flex:1 1 0; min-height:0; overflow-y:auto; scrollbar-gutter:stable; scrollbar-width:thin; padding:8px 0 var(--hearthlike-week-bottom-space, 16px); }
        .wk-grid { row-gap:15px; }
        .day { min-width:0; border-radius:4px; }
        .day.today { background:color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
        .day.past-day { opacity:0.3; }
        :host([light]) .day.past-day { filter:saturate(0.45); opacity:0.65; }
        .date { display:flex; align-items:baseline; gap:4px; line-height:35px; white-space:nowrap; overflow:hidden; }
        .number { font-size:var(--hearthlike-day-number-size, 29px); font-weight:500; }
        .month, .weekday { font-size:14px; }
        .weekday, .month.short { display:none; }
        .weekday { margin-left:auto; padding-right:4px; font-weight:600; }
        .events { margin-top:10px; display:flex; flex-direction:column; gap:5px; }
        .ev { box-sizing:border-box; border-radius:3px; border-left:5px solid; padding:10px 10px 10px 10px; color:#fff; cursor:pointer; overflow-wrap:anywhere; }
        .ev.past { filter:brightness(0.5); }
        :host([light]) .ev.past { filter:saturate(0.45); opacity:0.7; }
        .ev-time { font-size:var(--hearthlike-event-time-size, 11.9px); font-weight:500; line-height:1.4; margin-bottom:3px; }
        .ev-title { font-size:var(--hearthlike-event-title-size, 14px); font-weight:800; line-height:1.2; }
        .none { border-radius:5px; padding:5px; font-size:14px; line-height:17px; background:color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
        @container (max-width: 1099px) { .wk-head, .wk-grid { column-gap:8px; } .wk-grid { row-gap:12px; } }
        /* Too narrow for seven columns: fewer columns, and each day carries its own weekday name. */
        @container (max-width: 839px) { .wk-head { display:none; } .wk-grid { grid-template-columns:repeat(4, minmax(0, 1fr)); } .weekday, .month.short { display:inline; } .month:not(.short) { display:none; } }
        @container (max-width: 559px) { .wk-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } .day.past-day { display:none; } }
        @container (max-width: 339px) { .wk-grid { grid-template-columns:minmax(0, 1fr); } }
        ${HEARTHLIKE_WEEK_SHARED_CSS}
      </style>
      <ha-card>
        <div class="wk-head" part="header">${this._WEEKDAY_NAMES.map((n) => `<div>${n}</div>`).join('')}</div>
        <div class="list-scroll"><div class="wk-grid">${daysHtml.join('')}</div></div>
      </ha-card>
    `;
    this.shadowRoot.querySelectorAll('.ev[data-idx]').forEach((el) => {
      el.addEventListener('click', () => this._openEventDialog(this._dialogRecords[Number(el.dataset.idx)]));
    });
    const scroller = this.shadowRoot.querySelector('.list-scroll');
    const restore = () => { if (scroller.clientHeight > 0) scroller.scrollTop = this._listScroll || 0; };
    restore();
    scroller.addEventListener('scroll', () => { if (scroller.clientHeight > 0) this._listScroll = scroller.scrollTop; }, { passive: true });
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._resizeObserver = new ResizeObserver(restore);
    this._resizeObserver.observe(scroller);
  }

  _render() {
    if (!this._config || !this.shadowRoot) return;
    // While an event-detail dialog is open, skip the periodic/data-driven
    // re-render entirely rather than let a background tick or fetch nuke the
    // dialog out from under the viewer mid-read.
    if (this._dialogOpen) return;
    if (this._config.layout === 'list') {
      this._renderList();
      return;
    }
    const prevGridScroll = this.shadowRoot.querySelector('.grid-scroll');
    if (prevGridScroll) {
      this._lastScrollTop = prevGridScroll.scrollTop;
    }
    const cfg = this._config;
    const hourStart = cfg.hour_start;
    const hourEnd = cfg.hour_end;
    const pxPerHour = cfg.px_per_hour;
    const totalHeight = (hourEnd - hourStart) * pxPerHour;

    const weekStart = this._selectedWeekStart;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    const today = this._startOfDay(new Date());
    const todayKey = this._dateKey(today);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    const rangeLabel = sameMonth
      ? weekStart.toLocaleDateString(undefined, { month: 'long' }) +
        ' ' +
        weekStart.getDate() +
        ' – ' +
        weekEnd.getDate() +
        ', ' +
        weekEnd.getFullYear()
      : weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' – ' +
        weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ', ' +
        weekEnd.getFullYear();

    const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const headerHtml = days
      .map((d, i) => {
        const isToday = this._dateKey(d) === todayKey;
        const isPastDay = d.getTime() < today.getTime();
        return `
      <div class="col-header${isToday ? ' today' : ''}${isPastDay ? ' past-day' : ''}">
        <span class="day-name">${dayNamesShort[i]}</span>
        <span class="day-num${isToday ? ' today-num' : ''}">${d.getDate()}</span>
      </div>`;
      })
      .join('');

    // All-day row: events spanning multiple days render as one continuous
    // box across every day column they cover (like a multi-day vacation),
    // instead of a separate badge repeated on each day.
    const colGap = 15;
    const merged = this._mergedWeekAllDayEvents(days);
    // Lane height fits the "Entire day" box of the wall display: two lines of title plus padding.
    const laneHeight = 57;
    const laneGap = 5;
    const alldayHeight = merged.laneCount ? merged.laneCount * laneHeight + (merged.laneCount - 1) * laneGap : 0;
    this._dialogRecords = [];
    const alldayItemsHtml = merged.items
      .map((it) => {
        const { left, width } = this._colSpanBox(days.length, colGap, it.minIdx, it.maxIdx - it.minIdx + 1);
        const ridx = this._dialogRecords.length;
        this._dialogRecords.push({
          title: it.title,
          isAllDay: true,
          entityId: it.entityId,
          description: it.description,
          location: it.location,
          startRaw: it.startRaw,
          endRaw: it.endRaw,
          uid: it.uid,
          recurrenceId: it.recurrenceId,
          rrule: it.rrule,
        });
        return `
      <div class="allday-box${it.isPast ? ' past-day' : ''}" data-idx="${ridx}" style="top:${it.lane * (laneHeight + laneGap)}px;left:${left};width:${width};height:${laneHeight}px;background:${it.color}">
        ${this._iconHtml(this._iconFor(it.entityId))}${this._esc(it.title)}
      </div>`;
      })
      .join('');
    const alldayRowHtml = merged.items.length
      ? `<div class="allday-row">
          <div class="spacer allday-label">All-Day</div>
          <div class="allday-flex" style="height:${alldayHeight}px">${alldayItemsHtml}</div>
        </div>`
      : '';

    const hourRows = [];
    for (let h = hourStart; h <= hourEnd; h++) hourRows.push(h);

    const hourLabelsHtml = hourRows
      .map(
        (h) => `<div class="hour-label" style="top:${(h - hourStart) * pxPerHour}px">${this._formatHour(h)}</div>`
      )
      .join('');

    const hlineHtml = hourRows
      .map((h) => `<div class="hline" style="top:${(h - hourStart) * pxPerHour}px"></div>`)
      .join('');

    const now = new Date();
    const nowMinReal = now.getHours() * 60 + now.getMinutes();
    const showNowLine = nowMinReal >= hourStart * 60 && nowMinReal <= hourEnd * 60;
    const nowTop = ((nowMinReal - hourStart * 60) / 60) * pxPerHour;

    const colBodiesHtml = days
      .map((d) => {
        const isToday = this._dateKey(d) === todayKey;
        const isPastDay = d.getTime() < today.getTime();
        const events = this._layoutTimedEvents(d, hourStart, hourEnd, pxPerHour);
        const eventsHtml = events
          .map((e) => {
            // Only today's column can have individually-faded events (some
            // already ended, some still upcoming/ongoing) — past days are
            // already dimmed as a whole column below.
            const isPastEvent = isToday && e.endMin <= nowMinReal;
            // A full-width (non-overlapping) event fills its day column
            // edge-to-edge, matching the Monthly tab's event boxes — the
            // spacing between events now comes entirely from the 15px gap
            // between day columns, not from per-event insets. Only events
            // actually sharing a time slot side-by-side keep a hairline
            // 1px gap so they don't visually merge into one block.
            const inset = e.widthPct < 100 ? 1 : 0;
            const ridx = this._dialogRecords.length;
            this._dialogRecords.push({
              title: e.title,
              isAllDay: false,
              entityId: e.entityId,
              description: e.description,
              location: e.location,
              startRaw: e.startRaw,
              endRaw: e.endRaw,
              uid: e.uid,
              recurrenceId: e.recurrenceId,
              rrule: e.rrule,
            });
            return `
          <div class="event${isPastEvent ? ' past' : ''}" data-idx="${ridx}" style="top:${e.top}px;height:${e.height}px;left:calc(${e.leftPct}% + ${inset}px);width:calc(${e.widthPct}% - ${inset * 2}px);background:${e.color}">
            <div class="event-title">${this._iconHtml(this._iconFor(e.entityId))}${this._esc(e.title)}</div>
            <div class="event-time">${this._formatTime(e.startMin)} – ${this._formatTime(e.endMin)}</div>
          </div>`;
          })
          .join('');
        const nowLineHtml = isToday && showNowLine
          ? `<div class="now-line" style="top:${nowTop}px"><span class="now-dot"></span></div>`
          : '';
        return `<div class="col-body${isToday ? ' today' : ''}${isPastDay ? ' past-day' : ''}">${eventsHtml}${nowLineHtml}</div>`;
      })
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:100%; }
        ha-card { height:100%; min-height:var(--hearthlike-view-min-height, 400px); box-sizing:border-box; padding:12px 16px 12px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; }
        .topbar { flex:none; display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:6px; }
        .nav { background:none; border:none; color:var(--secondary-text-color); font-size:clamp(16px, 1.8vmin, 26px); line-height:1; cursor:pointer; padding:4px 8px; }
        .nav:hover { color:var(--primary-text-color); }
        .date-block { display:flex; align-items:center; gap:10px; }
        .date-label { font-size:clamp(16px, 1.8vmin, 26px); font-weight:500; color:var(--primary-text-color); }
        .today-btn { font-size:clamp(9px, 1vmin, 13px); padding:2px 10px; border-radius:12px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }
        .headers-row { flex:none; display:flex; margin-bottom:4px; align-items:center; }
        .headers-row .spacer { width:52px; flex:none; }
        .headers-flex { flex:1; display:flex; gap:15px; }
        .col-header { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:2px; padding:2px 4px; border-radius:8px; }
        .col-header.today { background:color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
        .day-name { font-size:var(--hearthlike-day-name-size, 20px); font-weight:600; letter-spacing:0.03em; text-transform:uppercase; color:var(--secondary-text-color); }
        .day-num { font-size:var(--hearthlike-day-number-size, 29px); font-weight:500; color:var(--primary-text-color); }
        .allday-row { flex:none; display:flex; margin-bottom:6px; }
        .allday-row .spacer { width:52px; flex:none; }
        .allday-label { display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }
        .allday-flex { flex:1; position:relative; }
        .allday-box { position:absolute; border-radius:3px; box-sizing:border-box; font-size:var(--hearthlike-event-title-size, 14px); font-weight:800; line-height:1.25; padding:10px 10px 10px 15px; white-space:normal; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; text-overflow:ellipsis; color:#fff; }
        .allday-box.past-day { opacity:0.3; }
        .grid-scroll { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
        .grid-wrap { display:flex; position:relative; }
        .hour-col { position:relative; width:52px; flex:none; }
        .hour-label { position:absolute; right:8px; white-space:nowrap; transform:translateY(4px); font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }
        .cols-wrap { position:relative; flex:1; display:flex; gap:15px; border-top:1px solid var(--divider-color, rgba(127,127,127,0.3)); }
        .hour-lines { position:absolute; left:0; right:0; top:0; bottom:0; pointer-events:none; z-index:0; }
        .hline { position:absolute; left:0; right:0; border-top:1px solid var(--divider-color, rgba(127,127,127,0.3)); }
        .col-body { position:relative; flex:1; min-width:0; z-index:1; }
        .col-body.today { background:color-mix(in srgb, var(--primary-text-color) 3%, transparent); border-radius:6px; }
        .event { position:absolute; border-radius:3px; padding:5px 8px 5px 10px; box-sizing:border-box; overflow:hidden; }
        .event-title { font-size:var(--hearthlike-event-title-size, 14px); font-weight:800; line-height:1.2; color:#fff; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; white-space:normal; overflow:hidden; text-overflow:ellipsis; }
        .event-time { font-size:var(--hearthlike-event-time-size, 11.9px); font-weight:500; color:rgba(255,255,255,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
        .now-line { position:absolute; left:0; right:0; height:0; border-top:2px solid #e24b4a; z-index:5; }
        .now-dot { position:absolute; left:-4px; top:-4px; width:8px; height:8px; border-radius:50%; background:#e24b4a; }
        .col-header.past-day { opacity:0.3; }
        .col-body.past-day { filter:brightness(0.3); }
        .event.past { filter:brightness(0.5); }
        :host([light]) .event.past { filter:saturate(0.45); opacity:0.7; }
        :host([light]) .col-body.past-day { filter:saturate(0.45); opacity:0.65; }
        :host([light]) .allday-box.past-day { filter:saturate(0.45); opacity:0.65; }
        .event, .allday-box { cursor:pointer; } ${HEARTHLIKE_WEEK_SHARED_CSS}
      </style>
      <ha-card>
        <div class="topbar">
          <button class="nav" id="prev">&#8249;</button>
          <div class="date-block">
            <div class="date-label">${rangeLabel}</div>
            ${this._pinnedThisWeek ? '' : '<button class="today-btn" id="thisweek">This Week</button>'}
          </div>
          <button class="nav" id="next">&#8250;</button>
        </div>
        <div class="headers-row">
          <div class="spacer"></div>
          <div class="headers-flex">${headerHtml}</div>
        </div>
        ${alldayRowHtml}
        <div class="grid-scroll">
          <div class="grid-wrap">
            <div class="hour-col" style="height:${totalHeight}px">${hourLabelsHtml}</div>
            <div class="cols-wrap" style="height:${totalHeight}px">
              <div class="hour-lines">${hlineHtml}</div>
              ${colBodiesHtml}
            </div>
          </div>
        </div>
      </ha-card>
    `;

    this.shadowRoot.getElementById('prev').addEventListener('click', () => this._shiftWeek(-1));
    this.shadowRoot.getElementById('next').addEventListener('click', () => this._shiftWeek(1));
    const thisWeekBtn = this.shadowRoot.getElementById('thisweek');
    if (thisWeekBtn) thisWeekBtn.addEventListener('click', () => this._goThisWeek());

    this.shadowRoot.querySelectorAll('.event[data-idx], .allday-box[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        this._openEventDialog(this._dialogRecords[idx]);
      });
    });

    const gridScrollEl = this.shadowRoot.querySelector('.grid-scroll');
    if (gridScrollEl) {
      const applyScroll = () => {
        const viewportH = gridScrollEl.clientHeight;
        if (viewportH <= 0) return;
        const shouldCenter = !this._userScrolled || this._lastScrollTop == null;
        const anchorTop = ((nowMinReal - hourStart * 60) / 60) * pxPerHour;
        const maxScroll = Math.max(0, totalHeight - viewportH);
        // Snap to the nearest hour boundary so the topmost visible hour
        // label/gridline is never left half-clipped by the scroll
        // container's edge (which happened whenever "now" landed close to
        // an hour line, cutting the label in half and making the all-day
        // row above look like it ran straight into a broken/cut-off event).
        const rawCenteredScrollTop = Math.max(0, Math.min(anchorTop - viewportH / 2, maxScroll));
        const centeredScrollTop = Math.max(
          0,
          Math.min(Math.round(rawCenteredScrollTop / pxPerHour) * pxPerHour, maxScroll)
        );
        const targetScrollTop = shouldCenter
          ? centeredScrollTop
          : Math.max(0, Math.min(this._lastScrollTop, maxScroll));
        gridScrollEl.scrollTop = targetScrollTop;
        this._lastScrollTop = targetScrollTop;
      };
      requestAnimationFrame(applyScroll);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this._resizeObserver = new ResizeObserver(() => applyScroll());
      this._resizeObserver.observe(gridScrollEl);
      ['wheel', 'touchstart', 'pointerdown'].forEach((evt) =>
        gridScrollEl.addEventListener(evt, () => { this._userScrolled = true; }, { passive: true })
      );
    }
  }
}

if (!customElements.get('hearthlike-week-card')) customElements.define('hearthlike-week-card', HearthlikeWeekCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'hearthlike-week-card'))
  window.customCards.push({
  type: 'hearthlike-week-card',
  name: 'HearthLike Week Card',
  description: 'Sunday-start week view: day columns over several weeks, or an hourly grid',
});

// Visual GUI editor for hearthlike-week-card's "calendars" list - same pattern as
// hearthlike-day-card-editor, just one entity-picker + color per row instead of a
// picker per column (there's no separate "name" field here since the week
// view doesn't show per-calendar headers).
class HearthlikeWeekCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach((el) => {
      el.hass = hass;
    });
  }

  _emitChange() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _updateCalendar(idx, patch) {
    const calendars = (this._config.calendars || []).slice();
    calendars[idx] = { ...calendars[idx], ...patch };
    this._config = { ...this._config, calendars };
    this._emitChange();
  }

  // Set a top-level option, or drop it when empty so the default applies.
  _setOption(key, value) {
    const config = { ...this._config };
    if (value === '') delete config[key];
    else config[key] = value;
    this._config = config;
    this._emitChange();
    this._render();
  }

  _addCalendar() {
    const calendars = (this._config.calendars || []).slice();
    const palette = ['#378ADD', '#E67E22', '#8E44AD', '#27AE60', '#E74C3C', '#16A085'];
    calendars.push({ entity: '', color: palette[calendars.length % palette.length] });
    this._config = { ...this._config, calendars };
    this._emitChange();
    this._render();
  }

  _removeCalendar(idx) {
    const calendars = (this._config.calendars || []).slice();
    calendars.splice(idx, 1);
    this._config = { ...this._config, calendars };
    this._emitChange();
    this._render();
  }

  _render() {
    const calendars = this._config.calendars || [];
    const rowsHtml = calendars
      .map(
        (cal, idx) => `
      <div class="hde-row" data-idx="${idx}">
        <ha-entity-picker class="hde-picker" data-idx="${idx}" allow-custom-entity></ha-entity-picker>
        <input class="hde-color" data-field="color" data-idx="${idx}" type="color" value="${cal.color || '#378ADD'}" />
        <button class="hde-remove" data-idx="${idx}" title="Remove calendar">&#10005;</button>
        <input class="hde-icon" data-field="icon" data-idx="${idx}" type="text" placeholder="Icon (optional): mdi:soccer, emoji, image URL, or entity" value="${(cal.icon || '').replace(/"/g, '&quot;')}" />
      </div>`
      )
      .join('');

    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .hde-wrap { display:flex; flex-direction:column; gap:10px; padding:8px 0; }
        .hde-empty { font-size:13px; color:var(--secondary-text-color); }
        .hde-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
        .hde-icon { order:4; flex:1 1 100%; box-sizing:border-box; font:inherit; font-size:13px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }
        .hde-row ha-entity-picker { flex:1; }
        .hde-color { width:36px; height:32px; border:none; background:none; padding:0; cursor:pointer; }
        .hde-remove { background:none; border:none; color:var(--secondary-text-color); font-size:16px; cursor:pointer; padding:4px 8px; }
        .hde-remove:hover { color:#e24b4a; }
        .hde-add { align-self:flex-start; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }
        .hde-hint { font-size:12px; color:var(--secondary-text-color); }
        .hde-field { display:flex; flex-direction:column; gap:4px; font-size:14px; color:var(--primary-text-color); }
        .hde-field select, .hde-field input { font:inherit; padding:8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }
      </style>
      <div class="hde-wrap">
        <label class="hde-field">Layout
          <select id="hde-layout">
            <option value="list" ${this._config.layout === 'grid' ? '' : 'selected'}>Day list, several weeks (default)</option>
            <option value="grid" ${this._config.layout === 'grid' ? 'selected' : ''}>Hourly grid, one week</option>
          </select>
        </label>
        ${this._config.layout === 'grid' ? '' : `<label class="hde-field">Weeks to show (1-26)
          <input id="hde-weeks" type="number" min="1" max="26" placeholder="13" value="${Number(this._config.weeks) || ''}" />
        </label>`}
        <div class="hde-hint">Leave "calendars" empty (remove all rows) to auto-show every calendar on the system. Add rows to pick specific calendars and colors.</div>
        ${calendars.length ? rowsHtml : '<div class="hde-empty">No calendars configured — the card will auto-discover every calendar.</div>'}
        <button class="hde-add" id="hde-add">+ Add calendar</button>
      </div>
    `;

    this.shadowRoot.querySelectorAll('.hde-picker').forEach((picker) => {
      const idx = parseInt(picker.getAttribute('data-idx'), 10);
      picker.hass = this._hass;
      picker.includeDomains = ['calendar'];
      picker.label = 'Calendar';
      picker.value = (calendars[idx] && calendars[idx].entity) || '';
      picker.addEventListener('value-changed', (ev) => {
        this._updateCalendar(idx, { entity: ev.detail.value || '' });
      });
    });

    this.shadowRoot.querySelectorAll('input[data-field]').forEach((input) => {
      input.addEventListener('change', (ev) => {
        const idx = parseInt(input.getAttribute('data-idx'), 10);
        const field = input.getAttribute('data-field');
        this._updateCalendar(idx, { [field]: ev.target.value });
      });
    });

    this.shadowRoot.querySelectorAll('.hde-remove').forEach((btn) => {
      btn.addEventListener('click', () => this._removeCalendar(parseInt(btn.getAttribute('data-idx'), 10)));
    });

    this.shadowRoot.getElementById('hde-add').addEventListener('click', () => this._addCalendar());
    this.shadowRoot.getElementById('hde-layout').addEventListener('change', (ev) => this._setOption('layout', ev.target.value === 'grid' ? 'grid' : ''));
    const weeks = this.shadowRoot.getElementById('hde-weeks');
    if (weeks) weeks.addEventListener('change', (ev) => this._setOption('weeks', Number(ev.target.value) || ''));
  }
}

if (!customElements.get('hearthlike-week-card-editor')) customElements.define('hearthlike-week-card-editor', HearthlikeWeekCardEditor);

// Version banner. dist/build.sh fills in the version from CHANGELOG.md; unbundled or unreleased shows "dev".
console.info(
  '%c HEARTHLIKE-WEEK-CARD %c ' + ('__HEARTHLIKE_VERSION__'.startsWith('__') ? 'dev' : 'v__HEARTHLIKE_VERSION__') + ' ',
  'color:#fff;background:#03a9f4;font-weight:700;',
  'color:#03a9f4;background:#fff;font-weight:700;'
);
