class HearthlikeMonthCard extends HTMLElement {
  // Used when auto-discovering calendars (no "calendars" configured at all)
  // so every calendar gets a distinct, stable color without the user having
  // to pick one. Same palette hearthlike-day-card/hearthlike-week-card use, kept in
  // sync on purpose so a calendar gets the same color on every tab.
  _DEFAULT_PALETTE = ['#378ADD', '#E67E22', '#8E44AD', '#27AE60', '#E74C3C', '#16A085', '#F39C12', '#2980B9'];
  static getStubConfig() {
    // Empty config: with no "calendars" set at all, the card auto-discovers
    // every calendar.* entity on the system, so it renders something useful
    // immediately. Add a "calendars" array to pick specific calendars and
    // assign your own colors.
    return {};
  }
  static getConfigElement() {
    return document.createElement('hearthlike-month-card-editor');
  }
  setConfig(config) {
    config = config || {};
    this._config = {
      // An empty/omitted "calendars" is the auto-discovery signal (see
      // _getCalendars) rather than an error - lets the card work with zero
      // configuration and still let power users lock in an explicit list.
      calendars: Array.isArray(config.calendars) ? config.calendars : [],
    };
    this._pinnedThisMonth = true;
    this._selectedMonthStart = this._startOfMonth(new Date());
    this._events = null;
    this._fetchedKey = null;
    // Tracks the last "hearthlike-calendar-updated" signal this card has acted
    // on (see _maybeFetch) - same persistent-marker approach hearthlike-day-card
    // and hearthlike-week-card use, so it still works even if this card wasn't
    // mounted (e.g. a different tab was active) when the FAB created an event.
    this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt || 0;
    // Like hearthlike-day-card/hearthlike-week-card's auto-centering: keep scrolling
    // the current week to the top of the grid on every render (initial load,
    // periodic tick, month change) until the viewer actually scrolls the
    // grid themselves, rather than a one-shot "scroll once" that can lose a
    // timing race against layout.
    this._userScrolledMonth = false;
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
    // The tabbed-card this lives in disconnects/reconnects the same element
    // on every tab switch, which resets native scrollTop to 0. Treat
    // "reconnected" as "the viewer just switched into this view" and always
    // re-scroll to the current week, mirroring the day/week cards' approach.
    this._userScrolledMonth = false;
    this._render();
    if (!this._onCalendarUpdated) {
      this._onCalendarUpdated = () => this._forceRefresh();
      window.addEventListener('hearthlike-calendar-updated', this._onCalendarUpdated);
    }
  }
  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
    this._tickStarted = false;
    if (this._monthResizeObserver) this._monthResizeObserver.disconnect();
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
  _startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
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
  // Builds the full set of day cells for a calendar-style month grid: starts
  // on the Sunday on/before the 1st of the month and always ends on a
  // Saturday, so every row is a complete week (4-6 rows depending on the
  // month), matching how a normal calendar app lays out a month.
  _buildMonthDays(monthStart) {
    const gridStart = this._startOfWeek(monthStart);
    const lastDayOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const days = [];
    const cur = new Date(gridStart);
    for (;;) {
      days.push(new Date(cur));
      const completedWeek = cur.getDay() === 6;
      const pastMonthEnd = cur.getTime() >= lastDayOfMonth.getTime();
      cur.setDate(cur.getDate() + 1);
      if (completedWeek && pastMonthEnd) break;
      if (days.length >= 42) break; // safety cap: 6 weeks
    }
    return days;
  }
  _startTicking() {
    if (this._tickStarted) return;
    this._tickStarted = true;
    this._interval = setInterval(() => {
      if (this._pinnedThisMonth) {
        const thisMonth = this._startOfMonth(new Date());
        if (thisMonth.getTime() !== this._selectedMonthStart.getTime()) {
          this._selectedMonthStart = thisMonth;
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
    const key = this._dateKey(this._selectedMonthStart);
    if (!force && this._fetchedKey === key && this._events) return;
    this._fetchedKey = key;
    const days = this._buildMonthDays(this._selectedMonthStart);
    const start = days[0];
    const end = new Date(days[days.length - 1]);
    end.setDate(end.getDate() + 1);
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
    if (this._dateKey(this._selectedMonthStart) === key) {
      if (failed) this._fetchedKey = null;
      const changed = !this._events || JSON.stringify(this._events) !== JSON.stringify(results);
      this._events = results;
      if (changed) this._render();
    }
  }
  _shiftMonth(delta) {
    const d = new Date(this._selectedMonthStart);
    d.setMonth(d.getMonth() + delta);
    this._selectedMonthStart = this._startOfMonth(d);
    this._pinnedThisMonth =
      this._dateKey(this._selectedMonthStart) === this._dateKey(this._startOfMonth(new Date()));
    this._events = null;
    this._render();
    this._maybeFetch();
  }
  _goThisMonth() {
    this._selectedMonthStart = this._startOfMonth(new Date());
    this._pinnedThisMonth = true;
    this._userScrolledMonth = false;
    this._events = null;
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
  _formatTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const period = h < 12 ? 'AM' : 'PM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + period;
  }
  // Every event (all-day or timed) touching a given day, tagged with its
  // calendar color - reused directly to drive the simple per-day event list
  // this card renders (no cross-cell spanning; a multi-day all-day event just
  // shows up in every day cell it covers, same as the Monthly tab always did).
  _rawEventsForDay(dayDate) {
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
          const s = new Date(e.start.dateTime);
          const en = new Date(e.end.dateTime);
          const dayBase = this._startOfDay(dayDate);
          const startMin = Math.round((s - dayBase) / 60000);
          const endMin = Math.round((en - dayBase) / 60000);
          // Only include this timed event on this day if its time window
          // actually overlaps the day (0-1440 minutes) - without this check
          // every timed event fetched for the whole month would show up on
          // every single day cell instead of just its real date(s).
          if (endMin <= 0 || startMin >= 1440) continue;
          out.push({
            title: e.summary || '(untitled)',
            isAllDay: false,
            startRaw: e.start.dateTime,
            endRaw: e.end.dateTime,
            startMin,
            endMin,
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
    // All-day events first, then timed events sorted by start time.
    out.sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
      if (!a.isAllDay && !b.isAllDay) return a.startMin - b.startMin;
      return 0;
    });
    return out;
  }
  _calendarName(entityId) {
    const st = this._hass && this._hass.states && this._hass.states[entityId];
    return (st && st.attributes && st.attributes.friendly_name) || entityId;
  }
  // Mirrors the exact string Day/Week's event-detail popups produce (e.g.
  // "Monday 20 July 2026" for an all-day event, "Thursday 23 July 2026 8:00
  // AM - 8:30 AM" for a timed one) - built from fixed weekday/month names
  // rather than toLocaleDateString so it can't drift if the browser's locale
  // ever changes.
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
  // `supported_features` attribute.
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
  // events, which is what the `calendar/event/update` websocket command's
  // dtstart/dtend fields expect.
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
      // makes every hearthlike-day-card/hearthlike-week-card/hearthlike-month-card
      // instance (including ones on a currently-inactive tab) drop its cache
      // and refetch.
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
  _render() {
    if (!this._config || !this.shadowRoot) return;
    // While an event-detail dialog is open, skip the periodic/data-driven
    // re-render entirely rather than let a background tick or fetch nuke the
    // dialog out from under the viewer mid-read.
    if (this._dialogOpen) return;
    const monthStart = this._selectedMonthStart;
    const monthLabel = this._MONTH_NAMES[monthStart.getMonth()] + ' ' + monthStart.getFullYear();
    const days = this._buildMonthDays(monthStart);
    const numWeeks = days.length / 7;
    const today = this._startOfDay(new Date());
    const todayKey = this._dateKey(today);
    const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const headerHtml = dayNamesShort.map((n) => `<div class="dow">${n}</div>`).join('');
    this._dialogRecords = [];
    const cellsHtml = days
      .map((d) => {
        const isToday = this._dateKey(d) === todayKey;
        const isPastDay = d.getTime() < today.getTime();
        const inMonth = d.getMonth() === monthStart.getMonth();
        const events = this._rawEventsForDay(d);
        const itemsHtml = events
          .map((e) => {
            const ridx = this._dialogRecords.length;
            this._dialogRecords.push({
              title: e.title,
              isAllDay: e.isAllDay,
              entityId: e.entityId,
              description: e.description,
              location: e.location,
              startRaw: e.startRaw,
              endRaw: e.endRaw,
              uid: e.uid,
              recurrenceId: e.recurrenceId,
              rrule: e.rrule,
            });
            const meta = e.isAllDay ? 'Entire day' : this._formatTime(e.startMin) + ' – ' + this._formatTime(e.endMin);
            const isPastEvent = !e.isAllDay && isToday && e.endMin <= today.getHours() * 60 + today.getMinutes();
            return `
          <div class="mevent${isPastEvent ? ' past' : ''}" data-idx="${ridx}" style="background:${e.color}">
            <div class="mevent-meta">${this._esc(meta)}</div>
            <div class="mevent-title">${this._iconHtml(this._iconFor(e.entityId))}${this._esc(e.title)}</div>
          </div>`;
          })
          .join('');
        return `
      <div class="day-cell${isToday ? ' today' : ''}${isPastDay ? ' past-day' : ''}${inMonth ? '' : ' other-month'}">
        <div class="day-num${isToday ? ' today-num' : ''}">${d.getDate()}${d.getDate() === 1 ? ' ' + this._MONTH_NAMES[d.getMonth()].slice(0, 3) : ''}</div>
        <div class="day-events">${itemsHtml}</div>
      </div>`;
      })
      .join('');
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:100%; }
        ha-card { height:100%; min-height:200px; box-sizing:border-box; padding:12px 16px 12px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; }
        .topbar { flex:none; display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:6px; }
        .nav { background:none; border:none; color:var(--secondary-text-color); font-size:clamp(16px, 1.8vmin, 26px); line-height:1; cursor:pointer; padding:4px 8px; }
        .nav:hover { color:var(--primary-text-color); }
        .date-block { display:flex; align-items:center; gap:10px; }
        .date-label { font-size:clamp(16px, 1.8vmin, 26px); font-weight:500; color:var(--primary-text-color); }
        .today-btn { font-size:clamp(9px, 1vmin, 13px); padding:2px 10px; border-radius:12px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }
        .dow-row { flex:none; display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; margin-bottom:4px; }
        .dow { text-align:center; font-size:clamp(11px, 1.4vmin, 16px); font-weight:600; letter-spacing:0.03em; text-transform:uppercase; color:var(--secondary-text-color); padding:2px 0; }
        .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; scrollbar-width:thin; }
        .grid { display:grid; grid-template-columns:repeat(7, 1fr); grid-template-rows:repeat(${numWeeks}, minmax(52px, 1fr)); gap:4px; min-height:100%; }
        .day-cell { position:relative; min-width:0; min-height:0; border-radius:6px; padding:3px 4px; display:flex; flex-direction:column; gap:clamp(4px, 0.55vmin, 7px); overflow:hidden; }
        .day-cell.today { background:color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
        .day-cell.other-month { opacity:0.35; }
        .day-cell.past-day:not(.other-month) { filter:brightness(0.6); }
        .day-num { flex:none; font-size:clamp(11px, 1.3vmin, 16px); font-weight:400; color:var(--primary-text-color); }
        .day-num.today-num { color:var(--primary-color, #378ADD); }
        .day-events { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:clamp(4px, 0.42vmin, 6px); scrollbar-width:thin; }
        .mevent { flex:none; border-radius:3px; padding:clamp(4px, 0.5vmin, 6px); box-sizing:border-box; cursor:pointer; overflow:hidden; }
        .mevent-meta { font-size:clamp(11.9px, 1.3vmin, 17px); font-weight:500; color:rgba(255,255,255,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
        .evicon { display:inline-block; width:1.15em; height:1.15em; margin-right:0.35em; vertical-align:-0.2em; --mdc-icon-size:1.15em; object-fit:contain; } span.evicon { width:auto; height:auto; line-height:1; vertical-align:baseline; } .evpic { border-radius:50%; object-fit:cover; }
        .mevent-title { font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; color:#fff; line-height:1.2; white-space:normal; overflow-wrap:break-word; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; }
        .mevent.past { filter:brightness(0.55); }
        :host([light]) .mevent.past { filter:saturate(0.45); opacity:0.7; }
        :host([light]) .day-cell.past-day:not(.other-month) { filter:saturate(0.45); opacity:0.7; }
        :host([light]) .day-cell.other-month { opacity:0.55; }
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
      </style>
      <ha-card>
        <div class="topbar">
          <button class="nav" id="prev">&#8249;</button>
          <div class="date-block">
            <div class="date-label">${monthLabel}</div>
            ${this._pinnedThisMonth ? '' : '<button class="today-btn" id="thismonth">This Month</button>'}
          </div>
          <button class="nav" id="next">&#8250;</button>
        </div>
        <div class="dow-row">${headerHtml}</div>
        <div class="grid-scroll"><div class="grid">${cellsHtml}</div></div>
      </ha-card>
    `;
    this.shadowRoot.getElementById('prev').addEventListener('click', () => this._shiftMonth(-1));
    this.shadowRoot.getElementById('next').addEventListener('click', () => this._shiftMonth(1));
    const thisMonthBtn = this.shadowRoot.getElementById('thismonth');
    if (thisMonthBtn) thisMonthBtn.addEventListener('click', () => this._goThisMonth());
    this.shadowRoot.querySelectorAll('.mevent[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        this._openEventDialog(this._dialogRecords[idx]);
      });
    });
    // Scroll the grid so the row containing today sits at the top, instead
    // of opening on whatever week happens to start the month. Only applies
    // while viewing the actual current month (_pinnedThisMonth) - flipping
    // to a past/future month via the nav arrows leaves scroll position
    // alone. A plain requestAnimationFrame isn't reliable here: like the
    // day/week cards, this card's height is driven by CSS flex/grid from a
    // container that may still report 0 height on the very first frame (or
    // during a tab switch), which would silently scroll to 0 and never
    // retry. A ResizeObserver on .grid-scroll is the backup that fires once
    // the real size is available, and applyScroll re-runs on every render
    // (initial load, periodic tick, reconnect) until the viewer scrolls the
    // grid themselves - a single missed/premature attempt just gets
    // corrected on the next pass instead of getting stuck.
    const scrollEl = this.shadowRoot.querySelector('.grid-scroll');
    if (scrollEl) {
      const applyMonthScroll = () => {
        if (!this._pinnedThisMonth || this._userScrolledMonth) return;
        if (scrollEl.clientHeight <= 0) return;
        const todayEl = this.shadowRoot.querySelector('.day-cell.today');
        if (!todayEl) return;
        // offsetTop is measured against offsetTop's nearest *positioned*
        // ancestor, not necessarily .grid-scroll - none of .grid,
        // .grid-scroll, or ha-card set "position", so .day-cell's offsetTop
        // was actually landing relative to some ancestor way outside this
        // card (off by roughly a row's worth of pixels, which is why the
        // previous version scrolled about one week short). Measuring both
        // rects and diffing is independent of the positioned-ancestor chain
        // entirely, so it lands exactly on the row regardless of what (if
        // anything) up the tree happens to be positioned.
        const todayRect = todayEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        scrollEl.scrollTop = scrollEl.scrollTop + (todayRect.top - scrollRect.top);
      };
      requestAnimationFrame(applyMonthScroll);
      if (this._monthResizeObserver) this._monthResizeObserver.disconnect();
      this._monthResizeObserver = new ResizeObserver(() => applyMonthScroll());
      this._monthResizeObserver.observe(scrollEl);
      // shadowRoot.innerHTML is rebuilt fresh on every render, so scrollEl is
      // a brand-new element each time - attach directly rather than
      // guarding with a "did I already attach" flag (that flag would never
      // let a listener reach the new element after the first render).
      ['wheel', 'touchstart', 'pointerdown'].forEach((evt) =>
        scrollEl.addEventListener(evt, () => { this._userScrolledMonth = true; }, { passive: true })
      );
    }
  }
}
if (!customElements.get('hearthlike-month-card')) customElements.define('hearthlike-month-card', HearthlikeMonthCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'hearthlike-month-card'))
  window.customCards.push({
  type: 'hearthlike-month-card',
  name: 'HearthLike Month Card',
  description: 'Full month calendar grid view, inspired by Hearth Display',
});
// Visual GUI editor for hearthlike-month-card's "calendars" list - identical
// pattern to hearthlike-week-card-editor (one entity-picker + color per row).
class HearthlikeMonthCardEditor extends HTMLElement {
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
      </style>
      <div class="hde-wrap">
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
  }
}
if (!customElements.get('hearthlike-month-card-editor')) customElements.define('hearthlike-month-card-editor', HearthlikeMonthCardEditor);

// Version banner. dist/build.sh fills in the version from CHANGELOG.md; unbundled or unreleased shows "dev".
console.info(
  '%c HEARTHLIKE-MONTH-CARD %c ' + ('__HEARTHLIKE_VERSION__'.startsWith('__') ? 'dev' : 'v__HEARTHLIKE_VERSION__') + ' ',
  'color:#fff;background:#03a9f4;font-weight:700;',
  'color:#03a9f4;background:#fff;font-weight:700;'
);
