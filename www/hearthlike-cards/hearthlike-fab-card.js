class HearthlikeFabCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }
  setConfig(e) {
    (this._config = e || {}),
      this.shadowRoot || this.attachShadow({ mode: "open" }),
      (this._dialogOpen = !1),
      this._render();
  }
  set hass(e) {
    this._hass = e;
  }
  getCardSize() {
    return 0;
  }
  _esc(e) {
    return String(null == e ? "" : e).replace(
      /[&<>"']/g,
      (e) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[e],
    );
  }
  _pad(e) {
    return String(e).padStart(2, "0");
  }
  _todayStr() {
    const e = new Date();
    return e.getFullYear() + "-" + this._pad(e.getMonth() + 1) + "-" + this._pad(e.getDate());
  }
  _nowTimeStr() {
    const e = new Date();
    let t = e.getMinutes() < 30 ? 30 : 0,
      a = e.getHours() + (e.getMinutes() < 30 ? 0 : 1);
    return a > 23 && (a = 23), this._pad(a) + ":" + this._pad(t);
  }
  _addOneDay(e) {
    const t = new Date(e + "T00:00:00");
    return (
      t.setDate(t.getDate() + 1),
      t.getFullYear() + "-" + this._pad(t.getMonth() + 1) + "-" + this._pad(t.getDate())
    );
  }
  _calendarEntities() {
    if (!this._hass) return [];
    const e = this._config && Array.isArray(this._config.calendars) ? this._config.calendars : null;
    return e
      ? e
          .map((e) => ("string" == typeof e ? e : e && (e.entity || e.entity_id)))
          .filter((e) => e && this._hass.states[e])
          .map((e) => ({
            id: e,
            name:
              (this._hass.states[e].attributes && this._hass.states[e].attributes.friendly_name) ||
              e,
          }))
      : Object.keys(this._hass.states)
          .filter((e) => e.startsWith("calendar."))
          .map((e) => ({
            id: e,
            name:
              (this._hass.states[e].attributes && this._hass.states[e].attributes.friendly_name) ||
              e,
          }));
  }
  _closeAddDialog() {
    const e = this.shadowRoot.querySelector("ha-dialog.hearthlike-add-dialog");
    e && e.remove(), (this._dialogOpen = !1);
  }
  _openAddDialog() {
    if (this._dialogOpen) return;
    this._closeAddDialog();
    const e = this._calendarEntities(),
      t = this._todayStr(),
      a = this._nowTimeStr(),
      [n, s] = a.split(":").map(Number);
    let i = n + 1;
    i > 23 && (i = 23);
    const r = this._pad(i) + ":" + this._pad(s),
      l = document.createElement("ha-dialog");
    (l.className = "hearthlike-add-dialog"),
      (l.innerHTML = `\n      <ha-dialog-header slot="heading">\n        <span slot="title">Add Event</span>\n      </ha-dialog-header>\n      <div class="af-content">\n        <label class="af-field">\n          <span class="af-label">Calendar</span>\n          <select class="af-input" id="af-cal">\n            ${e.map((e) => `<option value="${this._esc(e.id)}">${this._esc(e.name)}</option>`).join("")}\n          </select>\n        </label>\n        <label class="af-field">\n          <span class="af-label">Title</span>\n          <input class="af-input" id="af-title" type="text" placeholder="Event title" />\n        </label>\n        <label class="af-checkrow">\n          <input type="checkbox" id="af-allday" />\n          <span>All day</span>\n        </label>\n        <div class="af-row">\n          <label class="af-field">\n            <span class="af-label">Start date</span>\n            <input class="af-input" id="af-start-date" type="date" value="${t}" />\n          </label>\n          <label class="af-field" id="af-start-time-wrap">\n            <span class="af-label">Start time</span>\n            <input class="af-input" id="af-start-time" type="time" value="${a}" />\n          </label>\n        </div>\n        <div class="af-row">\n          <label class="af-field">\n            <span class="af-label">End date</span>\n            <input class="af-input" id="af-end-date" type="date" value="${t}" />\n          </label>\n          <label class="af-field" id="af-end-time-wrap">\n            <span class="af-label">End time</span>\n            <input class="af-input" id="af-end-time" type="time" value="${r}" />\n          </label>\n        </div>\n        <label class="af-field">\n          <span class="af-label">Description</span>\n          <textarea class="af-input" id="af-desc" rows="2"></textarea>\n        </label>\n        <div class="af-error" id="af-error"></div>\n        <div class="af-actions">\n          <button class="af-btn af-btn-text" id="af-cancel">Cancel</button>\n          <button class="af-btn af-btn-filled" id="af-save">Add</button>\n        </div>\n      </div>\n    `),
      this.shadowRoot.appendChild(l),
      (l.open = !0),
      (this._dialogOpen = !0),
      l.addEventListener("closed", () => {
        l.remove(), (this._dialogOpen = !1);
      });
    const d = l.querySelector("#af-allday"),
      o = l.querySelector("#af-start-time-wrap"),
      c = l.querySelector("#af-end-time-wrap"),
      p = () => {
        const e = d.checked;
        (o.style.display = e ? "none" : ""), (c.style.display = e ? "none" : "");
      };
    d.addEventListener("change", p),
      p(),
      l.querySelector("#af-cancel").addEventListener("click", () => this._closeAddDialog()),
      l.querySelector("#af-save").addEventListener("click", () => this._submitAddDialog(l));
  }
  async _submitAddDialog(e) {
    const t = e.querySelector("#af-error");
    t.textContent = "";
    const a = e.querySelector("#af-cal").value,
      n = e.querySelector("#af-title").value.trim(),
      s = e.querySelector("#af-allday").checked,
      i = e.querySelector("#af-start-date").value,
      r = e.querySelector("#af-end-date").value,
      l = e.querySelector("#af-start-time").value,
      d = e.querySelector("#af-end-time").value,
      o = e.querySelector("#af-desc").value;
    if (!a) return void (t.textContent = "No calendar available.");
    if (!n) return void (t.textContent = "Title is required.");
    const c = { entity_id: a, summary: n };
    if ((o && (c.description = o), s)) {
      if (!i) return void (t.textContent = "Start date is required.");
      const e = r && r > i ? this._addOneDay(r) : this._addOneDay(i);
      (c.start_date = i), (c.end_date = e);
    } else {
      if (!(i && l && r && d))
        return void (t.textContent = "Start and end date/time are required.");
      const e = i + "T" + l + ":00";
      let a = r + "T" + d + ":00";
      if (a <= e) return void (t.textContent = "End must be after start.");
      (c.start_date_time = e), (c.end_date_time = a);
    }
    try {
      await this._hass.callService("calendar", "create_event", c),
        this._closeAddDialog(),
        (window.__hearthlikeCalendarUpdatedAt = Date.now()),
        window.dispatchEvent(new CustomEvent("hearthlike-calendar-updated"));
    } catch (e) {
      t.textContent = "Failed to create event: " + (e && e.message ? e.message : "unknown error");
    }
  }
  _render() {
    this.shadowRoot &&
      ((this.shadowRoot.innerHTML =
        '\n      <style>\n        :host {\n          position: relative;\n          display: block;\n          width: 100%;\n          height: 100%;\n          pointer-events: none;\n        }\n        .fab {\n          position: absolute;\n          right: 20px;\n          bottom: 20px;\n          width: 60px;\n          height: 60px;\n          border-radius: 50%;\n          border: none;\n          background: var(--hearthlike-fab-color, var(--primary-color, #14b8a6));\n          color: var(--hearthlike-fab-icon-color, var(--text-primary-color, #fff));\n          font-size: 30px;\n          line-height: 1;\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          cursor: pointer;\n          box-shadow: 0 4px 12px rgba(0,0,0,0.35);\n          pointer-events: auto;\n          z-index: 10;\n        }\n        .fab:active { transform: scale(0.95); }\n        ha-dialog { pointer-events: auto; }\n        .af-content { display:flex; flex-direction:column; gap:14px; padding:8px 24px 4px; min-width:280px; color:var(--primary-text-color); }\n        .af-row { display:flex; gap:12px; }\n        .af-row .af-field { flex:1; }\n        .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }\n        .af-label { color:var(--secondary-text-color); }\n        .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }\n        .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }\n        .af-error { color:#e24b4a; font-size:13px; min-height:16px; }\n        .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; }\n        .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }\n        .af-btn-text { background:none; color:var(--primary-color, #14b8a6); }\n        .af-btn-filled { background:var(--hearthlike-fab-color, var(--primary-color, #14b8a6)); color:var(--hearthlike-fab-icon-color, var(--text-primary-color, #fff)); }\n      </style>\n      <button class="fab" id="fab-btn" aria-label="Add event"><svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>\n    '),
      this.shadowRoot
        .getElementById("fab-btn")
        .addEventListener("click", () => this._openAddDialog()));
  }
}
if (!customElements.get("hearthlike-fab-card"))
  customElements.define("hearthlike-fab-card", HearthlikeFabCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hearthlike-fab-card"))
  window.customCards.push({
    type: "hearthlike-fab-card",
    name: "HearthLike Add-Event FAB",
    description: "Floating add-event button, inspired by Hearth Display",
  });
