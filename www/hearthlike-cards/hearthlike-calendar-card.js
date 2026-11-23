// hearthlike-calendar-card.js
//
// Combines hearthlike-day-card, hearthlike-week-card, hearthlike-month-card, and the
// floating "+" add-event button into a single custom card with its own
// internal Day/Weekly/Monthly tab bar, replacing both the third-party
// `custom:tabbed-card` wrapper AND the separate `hearthlike-fab-card`.
//
// Why this exists: hearthlike-day-card, hearthlike-week-card, and hearthlike-month-card
// each already ship a fully working getConfigElement()-based visual editor
// (HearthlikeDayCardEditor / HearthlikeWeekCardEditor / HearthlikeMonthCardEditor), but
// those editors were unreachable through Home Assistant's dashboard GUI
// because the cards were nested inside tabs[N].card of a third-party
// tabbed-card. tabbed-card's own "Edit" dialog only offers a blank Config
// tab plus a raw YAML code editor for the *entire* tabs array - it does not
// delegate to each nested card's own editor. Consolidating all three views
// into one first-party card removes that wrapper entirely, so this card's
// own getConfigElement() is what HA's "Edit" action actually reaches.
//
// The "+" FAB used to be a wholly separate card (hearthlike-fab-card) sharing
// the same view_layout grid-area as this card, purely so it could float on
// top of whichever tab was showing. That worked visually, but in Home
// Assistant's dashboard edit mode both cards' invisible "Edit" overlays
// occupy the exact same screen region, so clicking "Edit" was ambiguous -
// whichever card happened to be later in the view's card list intercepted
// the click, sometimes opening the wrong card's editor entirely. Folding
// the FAB directly into this card removes the overlap (and the second
// card) altogether: there is now only one card, one "Edit" affordance, and
// one place to configure everything.
//
// Internally the Day/Weekly/Monthly panes still don't reimplement any
// rendering logic - they simply instantiate the existing <hearthlike-day-card>,
// <hearthlike-week-card>, and <hearthlike-month-card> elements (already registered
// as custom elements by their own scripts, which must also be loaded as
// Lovelace resources) as children, forward hass/config to each, and
// show/hide them based on which tab is active. The add-event dialog logic
// below is a direct copy of hearthlike-fab-card's implementation, just wired up
// to this card's own config/hass instead of a standalone element.
//
// Config shape (deliberately keeps day's per-person "columns" schema
// separate from week/month's flat per-calendar "calendars" schema, since
// those are genuinely different color models - Day colors by person
// column, Week/Month color by individual calendar entity - not a
// duplication to be merged):
//
// type: custom:hearthlike-calendar-card
// day:
//   hour_start: 0
//   hour_end: 24
//   px_per_hour: 64
//   visible_hours: 10
//   columns: [{ name, color, entities: [...] }, ...]
//   calendar_colors: {...}
// week:
//   hour_start: 0
//   hour_end: 24
//   px_per_hour: 64
//   calendars: [{ entity, color }, ...]
// month:
//   calendars: [{ entity, color }, ...]
// fab:
//   calendars: ['calendar.family', ...]   // restricts the Add Event dropdown;
//                                          // omit/empty to auto-discover every
//                                          // calendar known to HA.

class HearthlikeCalendarCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('hearthlike-calendar-card-editor');
  }

  static getStubConfig() {
    return {
      day: { columns: [] },
      week: { calendars: [] },
      month: { calendars: [] },
      fab: { calendars: [] },
    };
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._activeTab = this._activeTab || 'day';
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._dayCard) this._dayCard.hass = hass;
    if (this._weekCard) this._weekCard.hass = hass;
    if (this._monthCard) this._monthCard.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    if (this._config) this._render();
  }

  // ---- Add Event FAB + dialog (ported from hearthlike-fab-card.js) ----

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _pad(n) {
    return String(n).padStart(2, '0');
  }

  _todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate());
  }

  _nowTimeStr() {
    const d = new Date();
    let mins = d.getMinutes() < 30 ? 30 : 0;
    let hour = d.getHours() + (d.getMinutes() < 30 ? 0 : 1);
    if (hour > 23) hour = 23;
    return this._pad(hour) + ':' + this._pad(mins);
  }

  _addOneDay(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate());
  }

  _calendarEntities() {
    if (!this._hass) return [];
    const fabConfig = this._config.fab || {};
    const configured = Array.isArray(fabConfig.calendars) && fabConfig.calendars.length ? fabConfig.calendars : null;
    if (configured) {
      return configured
        .map((c) => (typeof c === 'string' ? c : (c && (c.entity || c.entity_id))))
        .filter((id) => id && this._hass.states[id])
        .map((id) => ({
          id,
          name: (this._hass.states[id].attributes && this._hass.states[id].attributes.friendly_name) || id,
        }));
    }
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith('calendar.'))
      .map((id) => ({
        id,
        name: (this._hass.states[id].attributes && this._hass.states[id].attributes.friendly_name) || id,
      }));
  }

  _closeAddDialog() {
    const existing = this.shadowRoot.querySelector('ha-dialog.hearthlike-add-dialog');
    if (existing) existing.remove();
    this._dialogOpen = false;
  }

  _openAddDialog() {
    if (this._dialogOpen) return;
    this._closeAddDialog();
    const cals = this._calendarEntities();
    const today = this._todayStr();
    const defaultStart = this._nowTimeStr();
    const [sh, sm] = defaultStart.split(':').map(Number);
    let eh = sh + 1;
    if (eh > 23) eh = 23;
    const defaultEnd = this._pad(eh) + ':' + this._pad(sm);

    const dlg = document.createElement('ha-dialog');
    dlg.className = 'hearthlike-add-dialog';
    dlg.innerHTML = `
      <ha-dialog-header slot="heading">
        <span slot="title">Add Event</span>
      </ha-dialog-header>
      <div class="af-content">
        <label class="af-field">
          <span class="af-label">Calendar</span>
          <select class="af-input" id="af-cal">
            ${cals.map((c) => `<option value="${this._esc(c.id)}">${this._esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="af-field">
          <span class="af-label">Title</span>
          <input class="af-input" id="af-title" type="text" placeholder="Event title" />
        </label>
        <label class="af-checkrow">
          <input type="checkbox" id="af-allday" />
          <span>All day</span>
        </label>
        <div class="af-row">
          <label class="af-field">
            <span class="af-label">Start date</span>
            <input class="af-input" id="af-start-date" type="date" value="${today}" />
          </label>
          <label class="af-field" id="af-start-time-wrap">
            <span class="af-label">Start time</span>
            <input class="af-input" id="af-start-time" type="time" value="${defaultStart}" />
          </label>
        </div>
        <div class="af-row">
          <label class="af-field">
            <span class="af-label">End date</span>
            <input class="af-input" id="af-end-date" type="date" value="${today}" />
          </label>
          <label class="af-field" id="af-end-time-wrap">
            <span class="af-label">End time</span>
            <input class="af-input" id="af-end-time" type="time" value="${defaultEnd}" />
          </label>
        </div>
        <label class="af-field">
          <span class="af-label">Description</span>
          <textarea class="af-input" id="af-desc" rows="2"></textarea>
        </label>
        <div class="af-error" id="af-error"></div>
        <div class="af-actions">
          <button class="af-btn af-btn-text" id="af-cancel">Cancel</button>
          <button class="af-btn af-btn-filled" id="af-save">Add</button>
        </div>
      </div>
    `;
    this.shadowRoot.appendChild(dlg);
    dlg.open = true;
    this._dialogOpen = true;

    dlg.addEventListener('closed', () => {
      dlg.remove();
      this._dialogOpen = false;
    });

    const alldayEl = dlg.querySelector('#af-allday');
    const startTimeWrap = dlg.querySelector('#af-start-time-wrap');
    const endTimeWrap = dlg.querySelector('#af-end-time-wrap');
    const syncAllDay = () => {
      const isAllDay = alldayEl.checked;
      startTimeWrap.style.display = isAllDay ? 'none' : '';
      endTimeWrap.style.display = isAllDay ? 'none' : '';
    };
    alldayEl.addEventListener('change', syncAllDay);
    syncAllDay();

    dlg.querySelector('#af-cancel').addEventListener('click', () => this._closeAddDialog());
    dlg.querySelector('#af-save').addEventListener('click', () => this._submitAddDialog(dlg));
  }

  async _submitAddDialog(dlg) {
    const errorEl = dlg.querySelector('#af-error');
    errorEl.textContent = '';
    const entityId = dlg.querySelector('#af-cal').value;
    const title = dlg.querySelector('#af-title').value.trim();
    const isAllDay = dlg.querySelector('#af-allday').checked;
    const startDate = dlg.querySelector('#af-start-date').value;
    const endDate = dlg.querySelector('#af-end-date').value;
    const startTime = dlg.querySelector('#af-start-time').value;
    const endTime = dlg.querySelector('#af-end-time').value;
    const description = dlg.querySelector('#af-desc').value;

    if (!entityId) {
      errorEl.textContent = 'No calendar available.';
      return;
    }
    if (!title) {
      errorEl.textContent = 'Title is required.';
      return;
    }

    const serviceData = { entity_id: entityId, summary: title };
    if (description) serviceData.description = description;

    if (isAllDay) {
      if (!startDate) {
        errorEl.textContent = 'Start date is required.';
        return;
      }
      const effectiveEnd = endDate && endDate > startDate ? this._addOneDay(endDate) : this._addOneDay(startDate);
      serviceData.start_date = startDate;
      serviceData.end_date = effectiveEnd;
    } else {
      if (!startDate || !startTime || !endDate || !endTime) {
        errorEl.textContent = 'Start and end date/time are required.';
        return;
      }
      const startDT = startDate + 'T' + startTime + ':00';
      let endDT = endDate + 'T' + endTime + ':00';
      if (endDT <= startDT) {
        errorEl.textContent = 'End must be after start.';
        return;
      }
      serviceData.start_date_time = startDT;
      serviceData.end_date_time = endDT;
    }

    try {
      await this._hass.callService('calendar', 'create_event', serviceData);
      this._closeAddDialog();
      window.__hearthlikeCalendarUpdatedAt = Date.now();
      window.dispatchEvent(new CustomEvent('hearthlike-calendar-updated'));
    } catch (e) {
      errorEl.textContent = 'Failed to create event: ' + (e && e.message ? e.message : 'unknown error');
    }
  }

  // ---- Tab bar + panes ----

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card {
          position: relative;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: transparent;
          box-shadow: none;
          border: none;
        }
        .tab-bar {
          display: flex;
          flex: 0 0 auto;
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        }
        .tab {
          flex: 1;
          text-align: center;
          padding: clamp(8px, 1.2vmin, 14px) 0;
          font-size: clamp(11px, 1.3vmin, 15px);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--secondary-text-color, rgba(255, 255, 255, 0.55));
          cursor: pointer;
          border-bottom: 2px solid transparent;
          user-select: none;
        }
        .tab.active {
          color: var(--primary-text-color, #fff);
          border-bottom-color: var(--primary-color, #03a9f4);
        }
        .panes {
          position: relative;
          flex: 1 1 auto;
          min-height: 0;
        }
        .pane {
          position: absolute;
          inset: 0;
          display: none;
          overflow: hidden;
        }
        .pane.active { display: block; }
        .pane > * { height: 100%; }
        .fab {
          position: absolute;
          right: 20px;
          bottom: 20px;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          border: none;
          background: var(--hearthlike-fab-color, #14b8a6);
          color: #fff;
          font-size: 30px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          z-index: 10;
        }
        .fab:active { transform: scale(0.95); }
        ha-dialog { pointer-events: auto; }
        .af-content { display:flex; flex-direction:column; gap:14px; padding:8px 24px 4px; min-width:280px; color:var(--primary-text-color); }
        .af-row { display:flex; gap:12px; }
        .af-row .af-field { flex:1; }
        .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }
        .af-label { color:var(--secondary-text-color); }
        .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }
        .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }
        .af-error { color:#e24b4a; font-size:13px; min-height:16px; }
        .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; }
        .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }
        .af-btn-text { background:none; color:var(--primary-color, #14b8a6); }
        .af-btn-filled { background:var(--hearthlike-fab-color, #14b8a6); color:#fff; }
      </style>
      <ha-card>
        <div class="tab-bar">
          <div class="tab" data-tab="day">Day</div>
          <div class="tab" data-tab="week">Weekly</div>
          <div class="tab" data-tab="month">Monthly</div>
        </div>
        <div class="panes">
          <div class="pane" data-pane="day"></div>
          <div class="pane" data-pane="week"></div>
          <div class="pane" data-pane="month"></div>
        </div>
        <button class="fab" id="fab-btn" aria-label="Add event">+</button>
      </ha-card>
    `;
    this._dayCard = document.createElement('hearthlike-day-card');
    this._weekCard = document.createElement('hearthlike-week-card');
    this._monthCard = document.createElement('hearthlike-month-card');
    this.shadowRoot.querySelector('[data-pane="day"]').appendChild(this._dayCard);
    this.shadowRoot.querySelector('[data-pane="week"]').appendChild(this._weekCard);
    this.shadowRoot.querySelector('[data-pane="month"]').appendChild(this._monthCard);
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', () => this._setActiveTab(el.dataset.tab));
    });
    this.shadowRoot.getElementById('fab-btn').addEventListener('click', () => this._openAddDialog());
  }

  _render() {
    // The pane cards come from their own scripts and may not be registered yet
    // (resources load independently), so wait for all three before building.
    const paneTags = ['hearthlike-day-card', 'hearthlike-week-card', 'hearthlike-month-card'];
    if (!paneTags.every((tag) => customElements.get(tag))) {
      Promise.all(paneTags.map((tag) => customElements.whenDefined(tag))).then(() => this._render());
      return;
    }
    this._ensureBuilt();
    const day = this._config.day || {};
    const week = this._config.week || {};
    const month = this._config.month || {};
    this._dayCard.setConfig({ type: 'custom:hearthlike-day-card', ...day });
    this._weekCard.setConfig({ type: 'custom:hearthlike-week-card', ...week });
    this._monthCard.setConfig({ type: 'custom:hearthlike-month-card', ...month });
    if (this._hass) {
      this._dayCard.hass = this._hass;
      this._weekCard.hass = this._hass;
      this._monthCard.hass = this._hass;
    }
    this._setActiveTab(this._activeTab);
  }

  _setActiveTab(tab) {
    this._activeTab = tab;
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    this.shadowRoot.querySelectorAll('.pane').forEach((el) => {
      el.classList.toggle('active', el.dataset.pane === tab);
    });
  }
}
if (!customElements.get('hearthlike-calendar-card')) customElements.define('hearthlike-calendar-card', HearthlikeCalendarCard);

class HearthlikeCalendarCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._activeTab = this._activeTab || 'day';
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._dayEditor) this._dayEditor.hass = hass;
    if (this._weekEditor) this._weekEditor.hass = hass;
    if (this._monthEditor) this._monthEditor.hass = hass;
    this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach((el) => {
      el.hass = hass;
    });
  }

  connectedCallback() {
    if (this._config) this._render();
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _updateFabCalendar(idx, entity) {
    const calendars = ((this._config.fab && this._config.fab.calendars) || []).slice();
    calendars[idx] = entity;
    this._config = { ...this._config, fab: { ...this._config.fab, calendars } };
    this._emitChange();
  }

  _addFabCalendar() {
    const calendars = ((this._config.fab && this._config.fab.calendars) || []).slice();
    calendars.push('');
    this._config = { ...this._config, fab: { ...this._config.fab, calendars } };
    this._emitChange();
    this._renderFabPane();
  }

  _removeFabCalendar(idx) {
    const calendars = ((this._config.fab && this._config.fab.calendars) || []).slice();
    calendars.splice(idx, 1);
    this._config = { ...this._config, fab: { ...this._config.fab, calendars } };
    this._emitChange();
    this._renderFabPane();
  }

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        .tab-bar {
          display: flex;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        }
        .tab {
          flex: 1;
          text-align: center;
          padding: 8px 0;
          cursor: pointer;
          font-weight: 500;
          color: var(--secondary-text-color);
          border-bottom: 2px solid transparent;
          user-select: none;
        }
        .tab.active {
          color: var(--primary-color);
          border-bottom-color: var(--primary-color);
        }
        .pane { display: none; }
        .pane.active { display: block; }
        .fde-wrap { display:flex; flex-direction:column; gap:10px; padding:8px 0; }
        .fde-empty { font-size:13px; color:var(--secondary-text-color); }
        .fde-row { display:flex; align-items:center; gap:8px; }
        .fde-row ha-entity-picker { flex:1; }
        .fde-remove { background:none; border:none; color:var(--secondary-text-color); font-size:16px; cursor:pointer; padding:4px 8px; }
        .fde-remove:hover { color:#e24b4a; }
        .fde-add { align-self:flex-start; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #14b8a6); cursor:pointer; }
        .fde-hint { font-size:12px; color:var(--secondary-text-color); }
      </style>
      <div class="tab-bar">
        <div class="tab" data-tab="day">Day</div>
        <div class="tab" data-tab="week">Weekly</div>
        <div class="tab" data-tab="month">Monthly</div>
        <div class="tab" data-tab="fab">Add Event</div>
      </div>
      <div class="pane" data-pane="day"></div>
      <div class="pane" data-pane="week"></div>
      <div class="pane" data-pane="month"></div>
      <div class="pane" data-pane="fab"></div>
    `;
    this._dayEditor = document.createElement('hearthlike-day-card-editor');
    this._weekEditor = document.createElement('hearthlike-week-card-editor');
    this._monthEditor = document.createElement('hearthlike-month-card-editor');
    this.shadowRoot.querySelector('[data-pane="day"]').appendChild(this._dayEditor);
    this.shadowRoot.querySelector('[data-pane="week"]').appendChild(this._weekEditor);
    this.shadowRoot.querySelector('[data-pane="month"]').appendChild(this._monthEditor);
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', () => this._setActiveTab(el.dataset.tab));
    });
    this._dayEditor.addEventListener('config-changed', (ev) => {
      ev.stopPropagation();
      this._updateSection('day', ev.detail.config);
    });
    this._weekEditor.addEventListener('config-changed', (ev) => {
      ev.stopPropagation();
      this._updateSection('week', ev.detail.config);
    });
    this._monthEditor.addEventListener('config-changed', (ev) => {
      ev.stopPropagation();
      this._updateSection('month', ev.detail.config);
    });
  }

  _renderFabPane() {
    const pane = this.shadowRoot.querySelector('[data-pane="fab"]');
    const calendars = (this._config.fab && this._config.fab.calendars) || [];
    const rowsHtml = calendars
      .map(
        (entity, idx) => `
      <div class="fde-row" data-idx="${idx}">
        <ha-entity-picker class="fde-picker" data-idx="${idx}" allow-custom-entity></ha-entity-picker>
        <button class="fde-remove" data-idx="${idx}" title="Remove calendar">&#10005;</button>
      </div>`
      )
      .join('');
    pane.innerHTML = `
      <div class="fde-wrap">
        <div class="fde-hint">Leave this list empty to let the Add Event button offer every calendar known to Home Assistant. Add rows to restrict it to specific calendars.</div>
        ${calendars.length ? rowsHtml : '<div class="fde-empty">No calendars configured — Add Event will auto-discover every calendar.</div>'}
        <button class="fde-add" id="fde-add">+ Add calendar</button>
      </div>
    `;
    pane.querySelectorAll('.fde-picker').forEach((picker) => {
      const idx = parseInt(picker.getAttribute('data-idx'), 10);
      picker.hass = this._hass;
      picker.includeDomains = ['calendar'];
      picker.label = 'Calendar';
      picker.value = calendars[idx] || '';
      picker.addEventListener('value-changed', (ev) => {
        this._updateFabCalendar(idx, ev.detail.value || '');
      });
    });
    pane.querySelectorAll('.fde-remove').forEach((btn) => {
      btn.addEventListener('click', () => this._removeFabCalendar(parseInt(btn.getAttribute('data-idx'), 10)));
    });
    pane.querySelector('#fde-add').addEventListener('click', () => this._addFabCalendar());
  }

  _updateSection(section, subConfig) {
    const clean = { ...subConfig };
    delete clean.type;
    this._config = { ...this._config, [section]: clean };
    this._emitChange();
  }

  _render() {
    this._ensureBuilt();
    const day = { type: 'custom:hearthlike-day-card', ...(this._config.day || {}) };
    const week = { type: 'custom:hearthlike-week-card', ...(this._config.week || {}) };
    const month = { type: 'custom:hearthlike-month-card', ...(this._config.month || {}) };
    this._dayEditor.setConfig(day);
    this._weekEditor.setConfig(week);
    this._monthEditor.setConfig(month);
    if (this._hass) {
      this._dayEditor.hass = this._hass;
      this._weekEditor.hass = this._hass;
      this._monthEditor.hass = this._hass;
    }
    this._renderFabPane();
    this._setActiveTab(this._activeTab);
  }

  _setActiveTab(tab) {
    this._activeTab = tab;
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    this.shadowRoot.querySelectorAll('.pane').forEach((el) => {
      el.classList.toggle('active', el.dataset.pane === tab);
    });
  }
}
if (!customElements.get('hearthlike-calendar-card-editor')) customElements.define('hearthlike-calendar-card-editor', HearthlikeCalendarCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'hearthlike-calendar-card'))
  window.customCards.push({
  type: 'hearthlike-calendar-card',
  name: 'HearthLike Calendar Card',
  description: 'Combined Day / Weekly / Monthly calendar view with a built-in tab bar, Add Event button, and a single visual editor.',
});
