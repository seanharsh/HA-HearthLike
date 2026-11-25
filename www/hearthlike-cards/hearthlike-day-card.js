class HearthlikeDayCard extends HTMLElement {
  _DEFAULT_PALETTE = [
    "#378ADD",
    "#E67E22",
    "#8E44AD",
    "#27AE60",
    "#E74C3C",
    "#16A085",
    "#F39C12",
    "#2980B9",
  ];
  static getStubConfig() {
    return {};
  }
  static getConfigElement() {
    return document.createElement("hearthlike-day-card-editor");
  }
  setConfig(e) {
    (e = e || {}),
      (this._config = {
        hour_start: e.hour_start ?? 0,
        hour_end: e.hour_end ?? 24,
        px_per_hour: e.px_per_hour ?? 80,
        visible_hours: e.visible_hours ?? 10,
        title: e.title,
        columns: Array.isArray(e.columns) ? e.columns : [],
        calendar_colors: e.calendar_colors || {},
      }),
      (this._pinnedToday = !0),
      (this._selectedDate = this._startOfDay(new Date())),
      (this._events = null),
      (this._fetchedKey = null),
      (this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt || 0),
      (this._userScrolled = !1),
      (this._lastScrollTop = null),
      (this._pxPerHour = null),
      this.shadowRoot || this.attachShadow({ mode: "open" }),
      this._render();
  }
  _computeDynamicPxPerHour(e) {
    return e / (3 + 6 * Math.max(0, Math.min(1, (e - 300) / 700)));
  }
  set hass(e) {
    (this._hass = e), this._startTicking(), this._maybeFetch();
  }
  connectedCallback() {
    this._startTicking(),
      (this._userScrolled = !1),
      (this._lastScrollTop = null),
      this._render(),
      this._onCalendarUpdated ||
        ((this._onCalendarUpdated = () => this._forceRefresh()),
        window.addEventListener("hearthlike-calendar-updated", this._onCalendarUpdated));
  }
  disconnectedCallback() {
    this._interval && clearInterval(this._interval),
      (this._tickStarted = !1),
      this._resizeObserver && this._resizeObserver.disconnect(),
      this._onCalendarUpdated &&
        (window.removeEventListener("hearthlike-calendar-updated", this._onCalendarUpdated),
        (this._onCalendarUpdated = null));
  }
  _forceRefresh() {
    (this._events = null), this._maybeFetch();
  }
  getCardSize() {
    return 10;
  }
  _getColumns() {
    if (this._config.columns && this._config.columns.length) return this._config.columns;
    if (!this._hass || !this._hass.states) return [];
    return Object.keys(this._hass.states)
      .filter((e) => e.startsWith("calendar."))
      .sort()
      .map((e, t) => ({
        name:
          (this._hass.states[e].attributes && this._hass.states[e].attributes.friendly_name) || e,
        color: this._DEFAULT_PALETTE[t % this._DEFAULT_PALETTE.length],
        entities: [e],
      }));
  }
  _startOfDay(e) {
    const t = new Date(e);
    return t.setHours(0, 0, 0, 0), t;
  }
  _dateKey(e) {
    return e.getFullYear() + "-" + e.getMonth() + "-" + e.getDate();
  }
  _localYMD(e) {
    return (
      e.getFullYear() +
      "-" +
      String(e.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(e.getDate()).padStart(2, "0")
    );
  }
  _startTicking() {
    this._tickStarted ||
      ((this._tickStarted = !0),
      (this._interval = setInterval(() => {
        if (this._pinnedToday) {
          const e = this._startOfDay(new Date());
          e.getTime() !== this._selectedDate.getTime() &&
            ((this._selectedDate = e), (this._events = null));
        }
        this._maybeFetch(!0), this._render();
      }, 3e4)));
  }
  async _maybeFetch(force) {
    if (
      (window.__hearthlikeCalendarUpdatedAt &&
        window.__hearthlikeCalendarUpdatedAt !== this._lastCalendarUpdateSeen &&
        ((this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt),
        (this._events = null)),
      !this._hass || !this._config)
    )
      return;
    const e = this._dateKey(this._selectedDate);
    if (!force && this._fetchedKey === e && this._events) return;
    this._fetchedKey = e;
    const t = new Date(this._selectedDate),
      n = new Date(this._selectedDate);
    n.setDate(n.getDate() + 1);
    const a = Array.from(new Set(this._getColumns().flatMap((e) => e.entities))),
      i = {};
    let failed = !1;
    await Promise.all(
      a.map(async (e) => {
        try {
          const a =
            "calendars/" +
            e +
            "?start=" +
            encodeURIComponent(t.toISOString()) +
            "&end=" +
            encodeURIComponent(n.toISOString());
          i[e] = (await this._hass.callApi("GET", a)) || [];
        } catch (t) {
          (failed = !0), (i[e] = (this._events && this._events[e]) || []);
        }
      }),
    );
    if (this._dateKey(this._selectedDate) === e) {
      failed && (this._fetchedKey = null);
      const changed = !this._events || JSON.stringify(this._events) !== JSON.stringify(i);
      (this._events = i), changed && this._render();
    }
  }
  _shiftDay(e) {
    const t = new Date(this._selectedDate);
    t.setDate(t.getDate() + e),
      (this._selectedDate = this._startOfDay(t)),
      (this._pinnedToday =
        this._dateKey(this._selectedDate) === this._dateKey(this._startOfDay(new Date()))),
      (this._events = null),
      this._render(),
      this._maybeFetch();
  }
  _goToday() {
    (this._selectedDate = this._startOfDay(new Date())),
      (this._pinnedToday = !0),
      (this._events = null),
      (this._userScrolled = !1),
      this._render(),
      this._maybeFetch();
  }
  _iconFor(entityId) {
    const c = this._getColumns().find((x) => x.entities && x.entities.includes(entityId));
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

  _esc(e) {
    return String(null == e ? "" : e).replace(
      /[&<>"']/g,
      (e) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[e],
    );
  }
  _formatHour(e) {
    const t = ((e % 24) + 24) % 24;
    let n = t % 12;
    return 0 === n && (n = 12), n + " " + (t < 12 ? "AM" : "PM");
  }
  _formatTime(e) {
    const t = Math.floor(e / 60),
      n = e % 60,
      a = t < 12 ? "AM" : "PM";
    let i = t % 12;
    return 0 === i && (i = 12), i + (n ? ":" + String(n).padStart(2, "0") : "") + " " + a;
  }
  _collectRawEvents(e) {
    const t = [];
    for (const n of e.entities) {
      const e = (this._events && this._events[n]) || [];
      for (const a of e) {
        const e = !(!a.start || !a.start.date || a.start.dateTime);
        t.push({
          title: a.summary || "(untitled)",
          isAllDay: e,
          startRaw: e ? a.start.date : a.start.dateTime,
          endRaw: e ? a.end.date : a.end.dateTime,
          entityId: n,
          description: a.description || "",
          location: a.location || "",
          uid: a.uid || null,
          recurrenceId: a.recurrence_id || null,
          rrule: a.rrule || null,
        });
      }
    }
    return t;
  }
  _calendarName(e) {
    const t = this._hass && this._hass.states && this._hass.states[e];
    return (t && t.attributes && t.attributes.friendly_name) || e;
  }
  _WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  _MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  _formatLongDate(e) {
    return `${this._WEEKDAY_NAMES[e.getDay()]} ${e.getDate()} ${this._MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
  }
  _formatClockTime(e) {
    let t = e.getHours();
    const n = t < 12 ? "AM" : "PM";
    return (
      (t %= 12), 0 === t && (t = 12), t + ":" + String(e.getMinutes()).padStart(2, "0") + " " + n
    );
  }
  _formatEventDateTime(e) {
    if (e.isAllDay) {
      const t = new Date(e.startRaw + "T00:00:00"),
        n = new Date(e.endRaw + "T00:00:00"),
        a = new Date(n);
      return (
        a.setDate(a.getDate() - 1),
        this._dateKey(t) === this._dateKey(a)
          ? this._formatLongDate(t)
          : this._formatLongDate(t) + " - " + this._formatLongDate(a)
      );
    }
    const t = new Date(e.startRaw),
      n = new Date(e.endRaw);
    return this._dateKey(t) === this._dateKey(n)
      ? this._formatLongDate(t) + " " + this._formatClockTime(t) + " - " + this._formatClockTime(n)
      : this._formatLongDate(t) +
          " " +
          this._formatClockTime(t) +
          " - " +
          this._formatLongDate(n) +
          " " +
          this._formatClockTime(n);
  }
  _closeEventDialog() {
    const e = this.shadowRoot.querySelector("ha-dialog.hearthlike-event-dialog");
    e && e.remove(), (this._dialogOpen = !1);
  }
  _CAL_FEATURE_DELETE = 2;
  _CAL_FEATURE_UPDATE = 4;
  _calendarFeatures(e) {
    const t = this._hass && this._hass.states && this._hass.states[e];
    return (t && t.attributes && t.attributes.supported_features) || 0;
  }
  _pad(e) {
    return String(e).padStart(2, "0");
  }
  _toDateInputValue(e) {
    return e.getFullYear() + "-" + this._pad(e.getMonth() + 1) + "-" + this._pad(e.getDate());
  }
  _toTimeInputValue(e) {
    return this._pad(e.getHours()) + ":" + this._pad(e.getMinutes());
  }
  _addOneDay(e) {
    const t = new Date(e + "T00:00:00");
    return (
      t.setDate(t.getDate() + 1),
      t.getFullYear() + "-" + this._pad(t.getMonth() + 1) + "-" + this._pad(t.getDate())
    );
  }
  _toISOWithOffset(e) {
    const t = -e.getTimezoneOffset(),
      n = t >= 0 ? "+" : "-",
      a = Math.abs(t),
      i = this._pad(Math.floor(a / 60)),
      o = this._pad(a % 60);
    return (
      e.getFullYear() +
      "-" +
      this._pad(e.getMonth() + 1) +
      "-" +
      this._pad(e.getDate()) +
      "T" +
      this._pad(e.getHours()) +
      ":" +
      this._pad(e.getMinutes()) +
      ":" +
      this._pad(e.getSeconds()) +
      n +
      i +
      ":" +
      o
    );
  }
  _openEventDialog(e) {
    if (!e) return;
    this._closeEventDialog();
    const t = document.createElement("ha-dialog");
    (t.className = "hearthlike-event-dialog"),
      // Newer ha-dialog takes headerTitle; older releases use heading.
      (t.headerTitle = e.title),
      (t.heading = e.title),
      t.addEventListener("closed", () => {
        t.remove(), (this._dialogOpen = !1);
      }),
      this.shadowRoot.appendChild(t),
      this._renderEventDialogView(t, e),
      (t.open = !0),
      (this._dialogOpen = !0);
  }
  _renderEventDialogView(e, t) {
    const n = this._calendarName(t.entityId),
      a = this._formatEventDateTime(t),
      i = t.location
        ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(t.location)
        : "",
      o = this._calendarFeatures(t.entityId),
      r = !!(t.uid && o & this._CAL_FEATURE_DELETE),
      s = !!(t.uid && o & this._CAL_FEATURE_UPDATE);
    e.innerHTML = `\n      <div class="hd-content">\n        <div class="hd-row"><ha-icon icon="mdi:calendar-account"></ha-icon><div class="hd-info">${this._esc(n)}</div></div>\n        <div class="hd-row"><ha-icon icon="mdi:calendar-clock"></ha-icon><div class="hd-info">${this._esc(a)}</div></div>\n        ${t.location ? `<div class="hd-row"><ha-icon icon="mdi:map-marker"></ha-icon><div class="hd-info"><a href="${this._esc(i)}" target="_blank" rel="noopener">${this._esc(t.location)}</a></div></div>` : ""}\n        ${t.description ? `<div class="hd-desc">${this._esc(t.description)}</div>` : ""}\n        ${s || r ? `\n        <div class="hd-actions">\n          ${s ? '<button class="hd-btn" id="hd-edit"><ha-icon icon="mdi:pencil"></ha-icon>Edit</button>' : ""}\n          ${r ? '<button class="hd-btn hd-btn-danger" id="hd-delete"><ha-icon icon="mdi:trash-can-outline"></ha-icon>Delete</button>' : ""}\n        </div>` : ""}\n      </div>\n    `;
    const d = e.querySelector("#hd-edit");
    d && d.addEventListener("click", () => this._renderEventEditView(e, t));
    const l = e.querySelector("#hd-delete");
    l && l.addEventListener("click", () => this._renderDeleteConfirmView(e, t));
  }
  _renderDeleteConfirmView(e, t) {
    const n = !!t.recurrenceId;
    (e.innerHTML = `\n      <div class="hd-content">\n        <div class="hd-confirm-label">${n ? "This is a recurring event. What would you like to delete?" : "Delete this event?"}</div>\n        <div class="hd-error" id="hd-error"></div>\n        <div class="af-actions">\n          <button class="af-btn af-btn-text" id="hd-cancel">Cancel</button>\n          ${n ? '\n          <button class="af-btn af-btn-danger" id="hd-del-this">This event</button>\n          <button class="af-btn af-btn-danger" id="hd-del-future">This &amp; following</button>\n          <button class="af-btn af-btn-danger" id="hd-del-all">All events</button>' : '\n          <button class="af-btn af-btn-danger" id="hd-del-this">Delete</button>'}\n        </div>\n      </div>\n    `),
      e
        .querySelector("#hd-cancel")
        .addEventListener("click", () => this._renderEventDialogView(e, t)),
      e
        .querySelector("#hd-del-this")
        .addEventListener("click", () => this._submitDelete(e, t, "THIS"));
    const a = e.querySelector("#hd-del-future");
    a && a.addEventListener("click", () => this._submitDelete(e, t, "THISANDFUTURE"));
    const i = e.querySelector("#hd-del-all");
    i && i.addEventListener("click", () => this._submitDelete(e, t, "ALL"));
  }
  async _submitDelete(e, t, n) {
    const a = e.querySelector("#hd-error");
    a && (a.textContent = "");
    const i = { type: "calendar/event/delete", entity_id: t.entityId, uid: t.uid };
    "THIS" === n
      ? t.recurrenceId && (i.recurrence_id = t.recurrenceId)
      : "THISANDFUTURE" === n &&
        (t.recurrenceId && (i.recurrence_id = t.recurrenceId),
        (i.recurrence_range = "THISANDFUTURE"));
    try {
      await this._hass.callWS(i),
        this._closeEventDialog(),
        (window.__hearthlikeCalendarUpdatedAt = Date.now()),
        window.dispatchEvent(new CustomEvent("hearthlike-calendar-updated")),
        this._forceRefresh();
    } catch (e) {
      a && (a.textContent = "Failed to delete: " + (e && e.message ? e.message : "unknown error"));
    }
  }
  _renderEventEditView(e, t) {
    const n = t.isAllDay ? new Date(t.startRaw + "T00:00:00") : new Date(t.startRaw);
    let a;
    t.isAllDay
      ? ((a = new Date(t.endRaw + "T00:00:00")), a.setDate(a.getDate() - 1))
      : (a = new Date(t.endRaw)),
      (e.innerHTML = `\n      <div class="af-content">\n        <label class="af-field">\n          <span class="af-label">Title</span>\n          <input class="af-input" id="ef-title" type="text" value="${this._esc(t.title)}" />\n        </label>\n        <label class="af-checkrow">\n          <input type="checkbox" id="ef-allday" ${t.isAllDay ? "checked" : ""} />\n          <span>All day</span>\n        </label>\n        <div class="af-row">\n          <label class="af-field">\n            <span class="af-label">Start date</span>\n            <input class="af-input" id="ef-start-date" type="date" value="${this._toDateInputValue(n)}" />\n          </label>\n          <label class="af-field" id="ef-start-time-wrap">\n            <span class="af-label">Start time</span>\n            <input class="af-input" id="ef-start-time" type="time" value="${this._toTimeInputValue(n)}" />\n          </label>\n        </div>\n        <div class="af-row">\n          <label class="af-field">\n            <span class="af-label">End date</span>\n            <input class="af-input" id="ef-end-date" type="date" value="${this._toDateInputValue(a)}" />\n          </label>\n          <label class="af-field" id="ef-end-time-wrap">\n            <span class="af-label">End time</span>\n            <input class="af-input" id="ef-end-time" type="time" value="${this._toTimeInputValue(a)}" />\n          </label>\n        </div>\n        <label class="af-field">\n          <span class="af-label">Location</span>\n          <input class="af-input" id="ef-location" type="text" value="${this._esc(t.location || "")}" />\n        </label>\n        <label class="af-field">\n          <span class="af-label">Description</span>\n          <textarea class="af-input" id="ef-desc" rows="2">${this._esc(t.description || "")}</textarea>\n        </label>\n        <div class="af-error" id="hd-error"></div>\n        <div class="af-actions">\n          <button class="af-btn af-btn-text" id="ef-cancel">Cancel</button>\n          <button class="af-btn af-btn-filled" id="ef-save">Save</button>\n        </div>\n      </div>\n    `);
    const i = e.querySelector("#ef-allday"),
      o = e.querySelector("#ef-start-time-wrap"),
      r = e.querySelector("#ef-end-time-wrap"),
      s = () => {
        const e = i.checked;
        (o.style.display = e ? "none" : ""), (r.style.display = e ? "none" : "");
      };
    i.addEventListener("change", s),
      s(),
      e
        .querySelector("#ef-cancel")
        .addEventListener("click", () => this._renderEventDialogView(e, t)),
      e.querySelector("#ef-save").addEventListener("click", () => this._submitEditDialog(e, t));
  }
  async _submitEditDialog(e, t) {
    const n = e.querySelector("#hd-error");
    n.textContent = "";
    const a = e.querySelector("#ef-title").value.trim(),
      i = e.querySelector("#ef-allday").checked,
      o = e.querySelector("#ef-start-date").value,
      r = e.querySelector("#ef-end-date").value,
      s = e.querySelector("#ef-start-time").value,
      d = e.querySelector("#ef-end-time").value,
      l = e.querySelector("#ef-location").value,
      c = e.querySelector("#ef-desc").value;
    if (!a) return void (n.textContent = "Title is required.");
    const h = { summary: a };
    if ((c && (h.description = c), l && (h.location = l), i)) {
      if (!o) return void (n.textContent = "Start date is required.");
      const e = r && r > o ? this._addOneDay(r) : this._addOneDay(o);
      (h.dtstart = o), (h.dtend = e);
    } else {
      if (!(o && s && r && d))
        return void (n.textContent = "Start and end date/time are required.");
      const e = new Date(o + "T" + s + ":00"),
        t = new Date(r + "T" + d + ":00");
      if (t <= e) return void (n.textContent = "End must be after start.");
      (h.dtstart = this._toISOWithOffset(e)), (h.dtend = this._toISOWithOffset(t));
    }
    const p = { type: "calendar/event/update", entity_id: t.entityId, uid: t.uid, event: h };
    t.recurrenceId && (p.recurrence_id = t.recurrenceId);
    try {
      await this._hass.callWS(p),
        this._closeEventDialog(),
        (window.__hearthlikeCalendarUpdatedAt = Date.now()),
        window.dispatchEvent(new CustomEvent("hearthlike-calendar-updated")),
        this._forceRefresh();
    } catch (e) {
      n.textContent = "Failed to save: " + (e && e.message ? e.message : "unknown error");
    }
  }
  _layoutEvents(e, t, n, a) {
    const i = 60 * t,
      o = 60 * n,
      r = this._selectedDate,
      s = this._collectRawEvents(e).filter((e) => !e.isAllDay);
    let d = [];
    for (const e of s) {
      const t = new Date(e.startRaw),
        n = new Date(e.endRaw);
      let a = Math.round((t - r) / 6e4),
        s = Math.round((n - r) / 6e4);
      if (s <= i || a >= o) continue;
      const l = a,
        c = s;
      (a = Math.max(a, i)),
        (s = Math.min(s, o)),
        s <= a && (s = a + 15),
        d.push({
          title: e.title,
          startMin: a,
          endMin: s,
          trueStartMin: l,
          trueEndMin: c,
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
    d.sort((e, t) => e.startMin - t.startMin || e.endMin - t.endMin);
    const l = [];
    let c = [],
      h = -1 / 0;
    for (const e of d)
      c.length && e.startMin >= h && (l.push(c), (c = []), (h = -1 / 0)),
        c.push(e),
        (h = Math.max(h, e.endMin));
    c.length && l.push(c);
    const p = [];
    for (const t of l) {
      const n = [];
      for (const e of t) {
        let t = !1;
        for (let a = 0; a < n.length; a++)
          if (n[a] <= e.startMin) {
            (e._col = a), (n[a] = e.endMin), (t = !0);
            break;
          }
        t || ((e._col = n.length), n.push(e.endMin));
      }
      const o = n.length;
      for (const n of t)
        p.push({
          title: n.title,
          startMin: n.trueStartMin,
          endMin: n.trueEndMin,
          top: ((n.startMin - i) / 60) * a,
          height: Math.max(((n.endMin - n.startMin) / 60) * a, 72),
          leftPct: (n._col / o) * 100,
          widthPct: (1 / o) * 100,
          color:
            (this._config.calendar_colors && this._config.calendar_colors[n.entityId]) || e.color,
          entityId: n.entityId,
          description: n.description,
          location: n.location,
          startRaw: n.startRaw,
          endRaw: n.endRaw,
          uid: n.uid,
          recurrenceId: n.recurrenceId,
          rrule: n.rrule,
        });
    }
    return p;
  }
  _colSpanBox(e, t, n, a) {
    const i = `${`(100% - ${(e - 1) * t}px)`} / ${e}`;
    return {
      left: `calc(${n} * (${i}) + ${n * t}px)`,
      width: `calc((${i}) * ${a} + ${(a - 1) * t}px)`,
    };
  }
  _mergedAllDayEvents() {
    const e = this._getColumns(),
      t = this._localYMD(this._selectedDate),
      n = this._config.calendar_colors,
      a = new Map();
    e.forEach((e, i) => {
      for (const o of e.entities) {
        const r = (this._events && this._events[o]) || [];
        for (const s of r) {
          if (!!(!s.start || !s.start.date || s.start.dateTime)) continue;
          const r = s.start.date,
            d = s.end.date;
          if (!(r <= t && t < d)) continue;
          const l = s.summary || "(untitled)",
            c = o + "|" + l + "|" + r;
          if (a.has(c)) {
            const e = a.get(c);
            (e.minIdx = Math.min(e.minIdx, i)), (e.maxIdx = Math.max(e.maxIdx, i));
          } else
            a.set(c, {
              title: l,
              color: n[o] || e.color,
              minIdx: i,
              maxIdx: i,
              entityId: o,
              description: s.description || "",
              location: s.location || "",
              startRaw: r,
              endRaw: d,
              uid: s.uid || null,
              recurrenceId: s.recurrence_id || null,
              rrule: s.rrule || null,
            });
        }
      }
    });
    const i = Array.from(a.values());
    i.sort((e, t) => e.minIdx - t.minIdx || e.maxIdx - t.maxIdx);
    const o = [];
    for (const e of i) {
      let t = !1;
      for (let n = 0; n < o.length; n++)
        if (o[n] < e.minIdx) {
          (e._lane = n), (o[n] = e.maxIdx), (t = !0);
          break;
        }
      t || ((e._lane = o.length), o.push(e.maxIdx));
    }
    return {
      items: i.map((e) => ({
        title: e.title,
        color: e.color,
        lane: e._lane,
        minIdx: e.minIdx,
        maxIdx: e.maxIdx,
        entityId: e.entityId,
        description: e.description,
        location: e.location,
        startRaw: e.startRaw,
        endRaw: e.endRaw,
        uid: e.uid,
        recurrenceId: e.recurrenceId,
        rrule: e.rrule,
      })),
      laneCount: o.length,
    };
  }
  _render() {
    if (!this._config || !this.shadowRoot) return;
    if (this._dialogOpen) return;
    const e = this.shadowRoot.querySelector(".grid-scroll");
    e && (this._lastScrollTop = e.scrollTop);
    const t = this._config,
      n = this._getColumns(),
      a = t.hour_start,
      i = t.hour_end,
      o = this._pxPerHour || t.px_per_hour || 64,
      r = (i - a) * o,
      s = this._selectedDate.toLocaleDateString(void 0, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      d = this._startOfDay(new Date()),
      l = this._selectedDate.getTime() < d.getTime(),
      c = new Date(),
      h = 60 * c.getHours() + c.getMinutes(),
      p = [];
    for (let e = a; e <= i; e++) p.push(e);
    const u = n.map((e) => '\n      <div class="col-header"></div>').join(""),
      f = this._mergedAllDayEvents(),
      _ = f.laneCount ? 70 * f.laneCount + 5 * (f.laneCount - 1) : 0;
    this._dialogRecords = [];
    const m = f.items
        .map((e) => {
          const { left: t, width: a } = this._colSpanBox(
              n.length,
              15,
              e.minIdx,
              e.maxIdx - e.minIdx + 1,
            ),
            i = this._dialogRecords.length;
          return (
            this._dialogRecords.push({
              title: e.title,
              isAllDay: !0,
              entityId: e.entityId,
              description: e.description,
              location: e.location,
              startRaw: e.startRaw,
              endRaw: e.endRaw,
              uid: e.uid,
              recurrenceId: e.recurrenceId,
              rrule: e.rrule,
            }),
            `\n      <div class="allday-box" data-idx="${i}" style="top:${(() => {
              const v = Math.min(window.innerWidth, window.innerHeight) / 100;
              const lh = Math.max(64, Math.min(92, Math.round(v * 6.9)));
              const lg = Math.max(4, Math.min(7, Math.round(v * 0.42)));
              return (lh + lg) * e.lane;
            })()}px;left:${t};width:${a};height:${(() => {
              const v = Math.min(window.innerWidth, window.innerHeight) / 100;
              return Math.max(64, Math.min(92, Math.round(v * 6.9)));
            })()}px;background:${e.color}">\n        ${this._iconHtml(this._iconFor(e.entityId))}${this._esc(e.title)}\n      </div>`
          );
        })
        .join(""),
      x = f.items.length
        ? `<div class="allday-row">\n          <div class="spacer allday-label">All-Day</div>\n          <div class="allday-flex" style="height:${_}px">${m}</div>\n        </div>`
        : "",
      v = p
        .map(
          (e) =>
            `<div class="hour-label" style="top:${(e - a) * o}px">${this._formatHour(e)}</div>`,
        )
        .join(""),
      g = p.map((e) => `<div class="hline" style="top:${(e - a) * o}px"></div>`).join(""),
      y = n
        .map(
          (e) =>
            `<div class="col-body">${this._layoutEvents(e, a, i, o)
              .map((e) => {
                const t = this._pinnedToday && e.endMin <= h,
                  n = e.widthPct < 100 ? 1 : 0,
                  a = this._dialogRecords.length;
                return (
                  this._dialogRecords.push({
                    title: e.title,
                    isAllDay: !1,
                    entityId: e.entityId,
                    description: e.description,
                    location: e.location,
                    startRaw: e.startRaw,
                    endRaw: e.endRaw,
                    uid: e.uid,
                    recurrenceId: e.recurrenceId,
                    rrule: e.rrule,
                  }),
                  `\n          <div class="event${t ? " past" : ""}" data-idx="${a}" style="top:${e.top}px;height:${e.height}px;left:calc(${e.leftPct}% + ${n}px);width:calc(${e.widthPct}% - ${2 * n}px);background:${e.color}">\n            <div class="event-title">${this._iconHtml(this._iconFor(e.entityId))}${this._esc(e.title)}</div>\n            <div class="event-time">${this._formatTime(e.startMin)} – ${this._formatTime(e.endMin)}</div>\n          </div>`
                );
              })
              .join("")}</div>`,
        )
        .join("");
    let b = "";
    if (this._pinnedToday && h >= 60 * a && h <= 60 * i) {
      b = `<div class="now-line" style="top:${((h - 60 * a) / 60) * o}px"><span class="now-dot"></span></div>`;
    }
    (this.shadowRoot.innerHTML = `\n      <style>\n        :host { display:block; height:100%; }\n        ha-card { height:100%; min-height:200px; box-sizing:border-box; padding:12px 16px 12px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; }\n        .topbar { flex:none; display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:6px; }\n        .nav { background:none; border:none; color:var(--secondary-text-color); font-size:clamp(16px, 1.8vmin, 26px); line-height:1; cursor:pointer; padding:4px 8px; }\n        .nav:hover { color:var(--primary-text-color); }\n        .date-block { display:flex; align-items:center; gap:10px; }\n        .date-label { font-size:clamp(16px, 1.8vmin, 26px); font-weight:500; color:var(--primary-text-color); }\n        .today-btn { font-size:clamp(9px, 1vmin, 13px); padding:2px 10px; border-radius:12px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .headers-row { flex:none; display:flex; margin-bottom:4px; align-items:center; }\n        .headers-row .spacer { width:52px; flex:none; }\n        .headers-flex { flex:1; display:flex; gap:15px; }\n        .col-header { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px; padding:2px 8px; }\n        .allday-row { flex:none; display:flex; margin-bottom:6px; }\n        .allday-row .spacer { width:52px; flex:none; }\n        .allday-label { display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }\n        .allday-flex { flex:1; position:relative; }\n        .allday-box { position:absolute; border-radius:3px; box-sizing:border-box; font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.25; padding:clamp(4px, 0.5vmin, 6px); white-space:normal; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; text-overflow:ellipsis; color:#fff; }\n        .dot { width:8px; height:8px; border-radius:50%; flex:none; }\n        .col-name { font-size:clamp(11px, 1.3vmin, 16px); font-weight:500; color:var(--primary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n        .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }\n        .grid-wrap { display:flex; position:relative; }\n        .hour-col { position:relative; width:52px; flex:none; }\n        .hour-label { position:absolute; right:8px; transform:translateY(4px); font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }\n        .cols-wrap { position:relative; flex:1; display:flex; gap:15px; border-top:1px solid rgba(255,255,255,0.14); }\n        .hour-lines { position:absolute; left:0; right:0; top:0; bottom:0; pointer-events:none; z-index:0; }\n        .hline { position:absolute; left:0; right:0; border-top:1px solid rgba(255,255,255,0.14); }\n        .col-body { position:relative; flex:1; min-width:0; z-index:1; }\n        .event { position:absolute; border-radius:3px; padding:clamp(4px, 0.5vmin, 6px); box-sizing:border-box; overflow:hidden; }\n        .evicon { display:inline-block; width:1.15em; height:1.15em; margin-right:0.35em; vertical-align:-0.2em; --mdc-icon-size:1.15em; object-fit:contain; } span.evicon { width:auto; height:auto; line-height:1; vertical-align:baseline; } .evpic { border-radius:50%; object-fit:cover; } .event-title { font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.25; color:#fff; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; white-space:normal; overflow:hidden; text-overflow:ellipsis; }\n        .event-time { font-size:clamp(11.9px, 1.3vmin, 17px); font-weight:500; color:rgba(255,255,255,0.85); margin-bottom:2px; }\n        .now-line { position:absolute; left:0; right:0; height:0; border-top:2px solid #e24b4a; z-index:5; }\n        .now-dot { position:absolute; left:-4px; top:-4px; width:8px; height:8px; border-radius:50%; background:#e24b4a; }\n        .day-content { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }\n        .day-content.past-day { opacity:0.3; }\n        .event.past { filter:brightness(0.5); }\n        .event, .allday-box { cursor:pointer; }\n        .hd-content { padding:20px 24px 24px; color:var(--primary-text-color); font-size:14px; }\n        .hd-row { display:flex; align-items:center; gap:8px; margin:0 0 8px; }\n        .hd-row ha-icon { color:var(--primary-text-color); flex:none; width:20px; height:22px; }\n        .hd-info { font-size:14px; }\n        .hd-info a { color:var(--primary-text-color); text-decoration:none; }\n        .hd-desc { font-size:14px; color:var(--primary-text-color); white-space:normal; border-top:1px solid var(--divider-color); padding-top:16px; margin-top:16px; }\n        .hd-actions { display:flex; gap:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--divider-color); }\n        .hd-btn { display:flex; align-items:center; gap:6px; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .hd-btn ha-icon { width:18px; height:18px; }\n        .hd-btn-danger { color:#e24b4a; border-color:#e24b4a; }\n        .hd-error { color:#e24b4a; font-size:13px; min-height:16px; margin-top:8px; }\n        .hd-confirm-label { font-size:15px; color:var(--primary-text-color); margin-bottom:4px; }\n        .af-content { display:flex; flex-direction:column; gap:14px; padding:20px 24px 4px; min-width:280px; color:var(--primary-text-color); }\n        .af-row { display:flex; gap:12px; }\n        .af-row .af-field { flex:1; }\n        .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }\n        .af-label { color:var(--secondary-text-color); }\n        .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }\n        .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }\n        .af-error { color:#e24b4a; font-size:13px; min-height:16px; }\n        .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; flex-wrap:wrap; }\n        .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }\n        .af-btn-text { background:none; color:var(--primary-color, #378ADD); }\n        .af-btn-filled { background:var(--primary-color, #378ADD); color:#fff; }\n        .af-btn-danger { background:#e24b4a; color:#fff; }\n      </style>\n      <ha-card>\n        <div class="topbar">\n          <button class="nav" id="prev">&#8249;</button>\n          <div class="date-block">\n            <div class="date-label">${s}</div>\n            ${this._pinnedToday ? "" : '<button class="today-btn" id="today">Today</button>'}\n          </div>\n          <button class="nav" id="next">&#8250;</button>\n        </div>\n        <div class="day-content${l ? " past-day" : ""}">\n          <div class="headers-row">\n            <div class="spacer"></div>\n            <div class="headers-flex">${u}</div>\n          </div>\n          ${x}\n          <div class="grid-scroll">\n            <div class="grid-wrap">\n              <div class="hour-col" style="height:${r}px">${v}</div>\n              <div class="cols-wrap" style="height:${r}px">\n                <div class="hour-lines">${g}</div>\n                ${y}\n                ${b}\n              </div>\n            </div>\n          </div>\n        </div>\n      </ha-card>\n    `),
      this.shadowRoot.getElementById("prev").addEventListener("click", () => this._shiftDay(-1)),
      this.shadowRoot.getElementById("next").addEventListener("click", () => this._shiftDay(1));
    const w = this.shadowRoot.getElementById("today");
    w && w.addEventListener("click", () => this._goToday()),
      this.shadowRoot.querySelectorAll(".event[data-idx], .allday-box[data-idx]").forEach((e) => {
        e.addEventListener("click", () => {
          const t = parseInt(e.getAttribute("data-idx"), 10);
          this._openEventDialog(this._dialogRecords[t]);
        });
      });
    const D = this.shadowRoot.querySelector(".grid-scroll");
    if (D) {
      const e = () => {
        // Capped at the viewport: in a container without a fixed height the grid's own height would
        // otherwise feed back into px-per-hour and grow without bound.
        const e = Math.min(D.clientHeight, window.innerHeight);
        if (e <= 0) return;
        const t = this._computeDynamicPxPerHour(e);
        if (Math.abs(t - o) > 1) return (this._pxPerHour = t), void this._render();
        const n = !this._userScrolled || null == this._lastScrollTop,
          i = ((h - 60 * a) / 60) * o,
          s = Math.max(0, r - e),
          d = Math.max(0, Math.min(Math.round(Math.max(0, Math.min(i - e / 2, s)) / o) * o, s)),
          l = n ? d : Math.max(0, Math.min(this._lastScrollTop, s));
        (D.scrollTop = l), (this._lastScrollTop = l);
      };
      requestAnimationFrame(e),
        this._resizeObserver && this._resizeObserver.disconnect(),
        (this._resizeObserver = new ResizeObserver(() => e())),
        this._resizeObserver.observe(D),
        ["wheel", "touchstart", "pointerdown"].forEach((e) =>
          D.addEventListener(
            e,
            () => {
              this._userScrolled = !0;
            },
            { passive: !0 },
          ),
        );
    }
  }
}
if (!customElements.get("hearthlike-day-card"))
  customElements.define("hearthlike-day-card", HearthlikeDayCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hearthlike-day-card"))
  window.customCards.push({
    type: "hearthlike-day-card",
    name: "HearthLike Day Card",
    description: "Per-person hourly day view inspired by Hearth Display",
  });
class HearthlikeDayCardEditor extends HTMLElement {
  setConfig(e) {
    (this._config = e || {}),
      this.shadowRoot || this.attachShadow({ mode: "open" }),
      this._render();
  }
  set hass(e) {
    (this._hass = e),
      this.shadowRoot?.querySelectorAll("ha-entity-picker").forEach((t) => {
        t.hass = e;
      });
  }
  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: !0,
        composed: !0,
      }),
    );
  }
  _updateColumn(e, t) {
    const n = (this._config.columns || []).slice();
    (n[e] = { ...n[e], ...t }),
      (this._config = { ...this._config, columns: n }),
      this._emitChange();
  }
  _addColumn() {
    const e = (this._config.columns || []).slice(),
      t = ["#378ADD", "#E67E22", "#8E44AD", "#27AE60", "#E74C3C", "#16A085"];
    e.push({ name: "New column", color: t[e.length % t.length], entities: [] }),
      (this._config = { ...this._config, columns: e }),
      this._emitChange(),
      this._render();
  }
  _removeColumn(e) {
    const t = (this._config.columns || []).slice();
    t.splice(e, 1),
      (this._config = { ...this._config, columns: t }),
      this._emitChange(),
      this._render();
  }
  _render() {
    const e = this._config.columns || [],
      t = e
        .map(
          (e, t) =>
            `\n      <div class="hde-row" data-idx="${t}">\n        <div class="hde-row-top">\n          <input class="hde-name" data-field="name" data-idx="${t}" type="text" value="${(e.name || "").replace(/"/g, "&quot;")}" placeholder="Column name" />\n          <input class="hde-color" data-field="color" data-idx="${t}" type="color" value="${e.color || "#378ADD"}" />\n          <button class="hde-remove" data-idx="${t}" title="Remove column">&#10005;</button>\n        </div>\n        <ha-selector class="hde-picker" data-idx="${t}"></ha-selector>\n        <input class="hde-icon" data-field="icon" data-idx="${t}" type="text" placeholder="Icon (optional): mdi:soccer, emoji, image URL, or entity" value="${(e.icon || "").replace(/"/g, "&quot;")}" />\n      </div>`,
        )
        .join("");
    this.shadowRoot || this.attachShadow({ mode: "open" }),
      (this.shadowRoot.innerHTML = `\n      <style>\n        .hde-wrap { display:flex; flex-direction:column; gap:16px; padding:8px 0; }\n        .hde-empty { font-size:13px; color:var(--secondary-text-color); }\n        .hde-row { display:flex; flex-direction:column; gap:6px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }\n        .hde-row-top { display:flex; align-items:center; gap:8px; }\n        .hde-name { flex:1; font:inherit; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }\n        .hde-color { width:36px; height:32px; border:none; background:none; padding:0; cursor:pointer; }\n        .hde-remove { background:none; border:none; color:var(--secondary-text-color); font-size:16px; cursor:pointer; padding:4px 8px; }\n        .hde-remove:hover { color:#e24b4a; }\n        .hde-add { align-self:flex-start; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .hde-icon { box-sizing:border-box; font:inherit; font-size:13px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }\n        .hde-hint { font-size:12px; color:var(--secondary-text-color); }\n      </style>\n      <div class="hde-wrap">\n        <div class="hde-hint">Leave "columns" empty (remove all rows) to auto-show every calendar on the system. Add rows to pick specific calendars, names, and colors.</div>\n        ${e.length ? t : '<div class="hde-empty">No columns configured — the card will auto-discover every calendar.</div>'}\n        <button class="hde-add" id="hde-add">+ Add column</button>\n      </div>\n    `),
      this.shadowRoot.querySelectorAll(".hde-picker").forEach((t) => {
        const n = parseInt(t.getAttribute("data-idx"), 10);
        (t.hass = this._hass),
          // ha-entity-picker has no multi-select; ha-selector renders HA's multi-entity picker.
          (t.selector = { entity: { multiple: !0, domain: "calendar" } }),
          (t.label = "Calendars for this column"),
          (t.value = (e[n] && e[n].entities) || []),
          t.addEventListener("value-changed", (e) => {
            this._updateColumn(n, { entities: e.detail.value || [] });
          });
      }),
      this.shadowRoot.querySelectorAll("input[data-field]").forEach((e) => {
        e.addEventListener("change", (t) => {
          const n = parseInt(e.getAttribute("data-idx"), 10),
            a = e.getAttribute("data-field");
          this._updateColumn(n, { [a]: t.target.value });
        });
      }),
      this.shadowRoot.querySelectorAll(".hde-remove").forEach((e) => {
        e.addEventListener("click", () =>
          this._removeColumn(parseInt(e.getAttribute("data-idx"), 10)),
        );
      }),
      this.shadowRoot.getElementById("hde-add").addEventListener("click", () => this._addColumn());
  }
}
if (!customElements.get("hearthlike-day-card-editor"))
  customElements.define("hearthlike-day-card-editor", HearthlikeDayCardEditor);
