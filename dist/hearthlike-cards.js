// Bundled build of www/hearthlike-cards/*.js — regenerate with dist/build.sh before tagging a release.

// ---- www/hearthlike-cards/hearthlike-calendar-card.js ----
{
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

}

// ---- www/hearthlike-cards/hearthlike-dashboard-card.js ----
{
// hearthlike-dashboard-card.js
//
// All-in-one family wall display for a panel-mode view. One card that fills the screen with:
//   1. a header: weather temperature on the left, clock on the right
//   2. a row of people badges (photo, presence indicator, name)
//   3. the hearthlike-calendar-card (Day / Weekly / Monthly + add-event button), filling the rest
//   4. a row of quick toggle buttons (lights, switches, ...)
// Every section is optional; leave its key out and it is not drawn.
//
// It replaces the usual stack of third-party cards (grid-layout, stack-in-card, mushroom,
// simple-clock-card, card-mod): nothing besides the HearthLike bundle needs to be installed.
//
// type: custom:hearthlike-dashboard-card
// weather: weather.home            # entity; shows its temperature and condition icon
// clock:
//   military: false               # true for 24-hour time
//   seconds: false
// people:
//   - entity: person.riley
//     name: Riley                   # optional, defaults to the entity's friendly name
//     color: "#b82d3d"             # ring and name colour
// calendar:                        # passed straight to hearthlike-calendar-card
//   day: { columns: [...] }
//   week: { calendars: [...] }
//   month: { calendars: [...] }
//   fab: { calendars: [...] }
// buttons:
//   - entity: light.family_room
//     name: Family Room            # optional
//     icon: mdi:lightbulb          # optional
//     show_state: false            # optional, default false
//
// style: |                        # optional custom CSS, applied inside the card (wins over the built-in rules)
//   .avatar { border-width: 5px; }
//   .clock { color: orange; }
//
// Styling: the card's colours and sizes follow the active theme and can be changed three ways:
//   - the --hearthlike-* CSS variables (from a theme, card-mod, or `style`): height, background, text-color,
//     header-font-size, header-padding, people-gap, people-padding, avatar-size, avatar-font-size, ring-width,
//     name-font-size, button-background, button-color, button-active-color, button-icon-size, button-padding
//   - the `style:` option above, using the class names .header .weather .clock .people .person .avatar .badge
//     .pname .cal .buttons .btn (.on/.off/.unavailable) .bname .bstate
//   - ::part() selectors, for a stylesheet in the same tree as the card (root, header, weather, clock, people, person, avatar, badge, person-name,
//     calendar, buttons, button, button-on/off/unavailable, button-icon, button-name, button-state)
//
// Use it on a view with `panel: true` so it can take the full height.
// Everything above can be set from the dashboard's visual editor (General / People / Calendar / Buttons tabs).

class HearthlikeDashboardCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('hearthlike-dashboard-card-editor');
  }

  static getStubConfig(hass) {
    const first = (domain) => Object.keys((hass && hass.states) || {}).find((id) => id.startsWith(domain + '.'));
    const weather = first('weather');
    return {
      ...(weather ? { weather } : {}),
      clock: { military: false },
      people: [],
      buttons: [],
      calendar: { day: { columns: [] }, week: { calendars: [] }, month: { calendars: [] }, fab: { calendars: [] } },
    };
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._calendar) this._calendar.hass = hass;
    this._update();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 10;
  }

  connectedCallback() {
    if (this._config && !this._built) this._build();
    this._startClock();
  }

  disconnectedCallback() {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- structure (built once per setConfig; the calendar card is never rebuilt on state changes) ----

  _build() {
    const c = this._config;
    this._built = true;
    this._sig = {};
    this._calendar = null;
    this.shadowRoot.innerHTML = `
      <style>
        /* Every size and colour below can be overridden with the --hearthlike-* variables (set them from a theme,
           card-mod, or the card's own "style" option), or restyle anything with "style". See the README. */
        :host { display: block; height: var(--hearthlike-height, calc(100dvh - var(--header-height, 56px))); }
        .root { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;
                background: var(--hearthlike-background, var(--primary-background-color));
                color: var(--hearthlike-text-color, var(--primary-text-color)); }
        .header { display: flex; align-items: center; justify-content: space-between; flex: none;
                  font-size: var(--hearthlike-header-font-size, clamp(24px, 5vmin, 48px));
                  padding: var(--hearthlike-header-padding, clamp(4px, 0.8vmin, 12px) clamp(14px, 2.5vmin, 32px)); }
        .weather { display: flex; align-items: center; gap: 0.25em; font-weight: 500; line-height: 1.2; }
        .weather ha-icon { --mdc-icon-size: 1em; display: flex; }
        .clock { margin-left: auto; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
        .people { display: flex; justify-content: space-evenly; align-items: flex-start; flex: none;
                  gap: var(--hearthlike-people-gap, 8px);
                  padding: var(--hearthlike-people-padding, clamp(6px, 1vmin, 16px) clamp(12px, 4vmin, 80px)); }
        .person { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; flex: 0 1 auto; }
        .avatar { position: relative; flex: none; box-sizing: border-box; border-radius: 50%;
                  width: var(--hearthlike-avatar-size, clamp(56px, 11vmin, 104px));
                  height: var(--hearthlike-avatar-size, clamp(56px, 11vmin, 104px));
                  border: var(--hearthlike-ring-width, 3px) solid var(--ring, var(--primary-color));
                  background: var(--secondary-background-color); display: flex; align-items: center; justify-content: center;
                  font-size: var(--hearthlike-avatar-font-size, clamp(22px, 4.5vmin, 40px)); font-weight: 600; line-height: 1; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .badge { position: absolute; top: -2px; right: -2px; width: 22px; height: 22px; border-radius: 50%;
                 display: flex; align-items: center; justify-content: center; color: #fff;
                 background: var(--badge, var(--secondary-text-color)); }
        .badge ha-icon { --mdc-icon-size: 14px; display: flex; }
        .pname { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;
                 font-size: var(--hearthlike-name-font-size, clamp(14px, 2.2vmin, 22px)); font-weight: 500;
                 color: var(--ring, var(--primary-text-color)); }
        .cal { position: relative; flex: 1; min-height: 0; }
        .cal > * { position: absolute; inset: 0; display: block; }
        .buttons { display: flex; align-items: stretch; flex: none; gap: 1px; overflow-x: auto; }
        .btn { flex: 1 0 64px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px;
               padding: var(--hearthlike-button-padding, 12px 4px); cursor: pointer; border: 0; font: inherit; min-width: 0;
               background: var(--hearthlike-button-background, var(--card-background-color, var(--secondary-background-color)));
               color: var(--hearthlike-button-color, var(--primary-text-color)); }
        .btn:active { filter: brightness(1.2); }
        .btn ha-icon { --mdc-icon-size: var(--hearthlike-button-icon-size, 27px); display: flex; }
        .btn.on ha-icon { color: var(--hearthlike-button-active-color, var(--state-light-active-color, #ffc107)); }
        .btn.off, .btn.unavailable { color: var(--secondary-text-color); }
        .btn.unavailable { opacity: 0.6; }
        .bname { font-size: 14px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bstate { font-size: 12px; color: var(--secondary-text-color); text-transform: capitalize; }
      </style>
      <style id="user-style"></style>
      <div class="root" part="root">
        ${c.weather || c.clock ? `<div class="header" part="header">${c.weather ? '<div class="weather" part="weather"></div>' : ''}${c.clock ? '<div class="clock" part="clock"></div>' : ''}</div>` : ''}
        ${Array.isArray(c.people) && c.people.length ? '<div class="people" part="people"></div>' : ''}
        <div class="cal" part="calendar"></div>
        ${Array.isArray(c.buttons) && c.buttons.length ? '<div class="buttons" part="buttons"></div>' : ''}
      </div>`;
    // Custom CSS from the card config, appended after the built-in rules so it wins.
    this.shadowRoot.getElementById('user-style').textContent = typeof c.style === 'string' ? c.style : '';
    const root = this.shadowRoot;
    this._elWeather = root.querySelector('.weather');
    this._elClock = root.querySelector('.clock');
    this._elPeople = root.querySelector('.people');
    this._elButtons = root.querySelector('.buttons');
    if (this._elButtons) {
      this._elButtons.addEventListener('click', (e) => {
        const b = e.target.closest('.btn');
        if (!b || !this._hass) return;
        this._hass.callService('homeassistant', 'toggle', { entity_id: b.dataset.entity });
      });
    }
    if (c.calendar) this._mountCalendar(root.querySelector('.cal'));
    this._startClock();
    this._update();
  }

  _mountCalendar(host) {
    const tag = 'hearthlike-calendar-card';
    const make = () => {
      const cal = document.createElement(tag);
      cal.setConfig({ type: 'custom:' + tag, ...this._config.calendar });
      if (this._hass) cal.hass = this._hass;
      host.appendChild(cal);
      this._calendar = cal;
    };
    if (customElements.get(tag)) make();
    else customElements.whenDefined(tag).then(() => { if (!this._calendar) make(); });
  }

  // ---- clock ----

  _startClock() {
    if (!this._elClock || this._clockTimer) return;
    this._tick();
    this._clockTimer = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    if (!this._elClock) return;
    const k = this._config.clock || {};
    const text = new Date().toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit', second: k.seconds ? '2-digit' : undefined, hour12: !k.military,
    });
    if (this._elClock.textContent !== text) this._elClock.textContent = text;
  }

  // ---- state-driven sections (re-rendered only when what they show changes) ----

  _update() {
    if (!this._built || !this._hass) return;
    this._updateWeather();
    this._updatePeople();
    this._updateButtons();
  }

  _set(key, el, html) {
    if (this._sig[key] === html) return;
    this._sig[key] = html;
    el.innerHTML = html;
  }

  _updateWeather() {
    if (!this._elWeather) return;
    const id = this._config.weather;
    const st = id && this._hass.states[id];
    if (!st) { this._set('weather', this._elWeather, ''); return; }
    const icons = {
      'clear-night': 'weather-night', cloudy: 'weather-cloudy', exceptional: 'alert-circle-outline', fog: 'weather-fog',
      hail: 'weather-hail', lightning: 'weather-lightning', 'lightning-rainy': 'weather-lightning-rainy',
      partlycloudy: 'weather-partly-cloudy', pouring: 'weather-pouring', rainy: 'weather-rainy', snowy: 'weather-snowy',
      'snowy-rainy': 'weather-snowy-rainy', sunny: 'weather-sunny', windy: 'weather-windy', 'windy-variant': 'weather-windy-variant',
    };
    const t = st.attributes.temperature;
    const unit = st.attributes.temperature_unit || (this._hass.config.unit_system || {}).temperature || '';
    const temp = t == null || isNaN(Number(t)) ? '' : Math.round(Number(t)) + unit;
    this._set('weather', this._elWeather,
      `<ha-icon icon="mdi:${icons[st.state] || 'weather-cloudy'}"></ha-icon><span>${this._esc(temp)}</span>`);
  }

  _updatePeople() {
    if (!this._elPeople) return;
    const html = this._config.people.filter((p) => p.entity).map((p) => {
      const st = this._hass.states[p.entity];
      const name = p.name || (st && st.attributes.friendly_name) || p.entity;
      const pic = st && st.attributes.entity_picture;
      const state = st ? st.state : 'unknown';
      let badge = '';
      if (state === 'home') badge = '<span class="badge" part="badge" style="--badge:var(--success-color, #43a047)"><ha-icon icon="mdi:home"></ha-icon></span>';
      else if (state === 'not_home') badge = '<span class="badge" part="badge" style="--badge:var(--warning-color, #f57c00)"><ha-icon icon="mdi:home-export-outline"></ha-icon></span>';
      else if (state !== 'unknown' && state !== 'unavailable') badge = '<span class="badge" part="badge" style="--badge:var(--info-color, #039be5)"><ha-icon icon="mdi:map-marker"></ha-icon></span>';
      const face = pic ? `<img src="${this._esc(pic)}" alt="">` : this._esc(String(name).slice(0, 1).toUpperCase());
      const ring = p.color ? `--ring:${this._esc(p.color)};` : '';
      return `<div class="person" part="person" style="${ring}"><div class="avatar" part="avatar">${face}${badge}</div><div class="pname" part="person-name">${this._esc(name)}</div></div>`;
    }).join('');
    this._set('people', this._elPeople, html);
  }

  _updateButtons() {
    if (!this._elButtons) return;
    const html = this._config.buttons.filter((b) => b.entity).map((b) => {
      const st = this._hass.states[b.entity];
      const state = st ? st.state : 'unavailable';
      const name = b.name || (st && st.attributes.friendly_name) || b.entity;
      const domain = String(b.entity).split('.')[0];
      const fallback = { light: 'mdi:lightbulb', switch: 'mdi:toggle-switch', input_boolean: 'mdi:toggle-switch', fan: 'mdi:fan' }[domain] || 'mdi:gesture-tap';
      const icon = state === 'unavailable' ? 'mdi:help-circle-outline' : (b.icon || (st && st.attributes.icon) || fallback);
      const cls = state === 'on' ? 'on' : state === 'unavailable' ? 'unavailable' : 'off';
      return `<button class="btn ${cls}" part="button button-${cls}" data-entity="${this._esc(b.entity)}"><ha-icon icon="${this._esc(icon)}" part="button-icon"></ha-icon>`
        + `<span class="bname" part="button-name">${this._esc(name)}</span>${b.show_state ? `<span class="bstate" part="button-state">${this._esc(state)}</span>` : ''}</button>`;
    }).join('');
    this._set('buttons', this._elButtons, html);
  }
}
if (!customElements.get('hearthlike-dashboard-card')) customElements.define('hearthlike-dashboard-card', HearthlikeDashboardCard);

class HearthlikeDashboardCardEditor extends HTMLElement {
  setConfig(config) {
    const next = config || {};
    // HA echoes our own config-changed back through setConfig; skip it so typing keeps its focus.
    if (this._built && JSON.stringify(next) === JSON.stringify(this._config)) return;
    this._config = next;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._activeTab = this._activeTab || 'general';
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._calEditor) this._calEditor.hass = hass;
    this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach((el) => { el.hass = hass; });
  }

  connectedCallback() {
    if (this._config) this._render();
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Set or (when value is empty) remove a top-level key.
  _setKey(key, value) {
    const cfg = { ...this._config };
    if (value === '' || value == null) delete cfg[key];
    else cfg[key] = value;
    this._config = cfg;
    this._emit();
  }

  _setItem(key, idx, field, value) {
    const list = (this._config[key] || []).map((it) => ({ ...it }));
    if (value === '' || value === false || value == null) delete list[idx][field];
    else list[idx][field] = value;
    this._config = { ...this._config, [key]: list };
    this._emit();
  }

  _addItem(key, item) {
    this._config = { ...this._config, [key]: [...(this._config[key] || []), item] };
    this._emit();
    this._renderList(key);
  }

  _removeItem(key, idx) {
    const list = (this._config[key] || []).slice();
    list.splice(idx, 1);
    this._config = { ...this._config, [key]: list };
    this._emit();
    this._renderList(key);
  }

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        .tab-bar { display: flex; margin-bottom: 12px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
        .tab { flex: 1; text-align: center; padding: 8px 0; cursor: pointer; font-weight: 500; color: var(--secondary-text-color);
               border-bottom: 2px solid transparent; user-select: none; }
        .tab.active { color: var(--primary-color); border-bottom-color: var(--primary-color); }
        .pane { display: none; }
        .pane.active { display: block; }
        .wrap { display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
        .hint { font-size: 12px; color: var(--secondary-text-color); }
        .empty { font-size: 13px; color: var(--secondary-text-color); }
        .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px; border: 1px solid var(--divider-color); border-radius: 8px; }
        .row ha-entity-picker { flex: 1 1 100%; min-width: 0; }
        .row input[type=text] { flex: 1 1 120px; min-width: 0; font: inherit; padding: 8px; border-radius: 6px;
                                border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
        .row input[type=color] { width: 40px; height: 36px; padding: 0; border: 1px solid var(--divider-color); border-radius: 6px; background: none; }
        .row label.chk { display: flex; align-items: center; gap: 4px; font-size: 14px; color: var(--primary-text-color); }
        .remove { margin-left: auto; background: none; border: none; color: var(--secondary-text-color); font-size: 16px; cursor: pointer; padding: 4px 8px; }
        .remove:hover { color: #e24b4a; }
        .add { align-self: flex-start; font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 6px;
               border: 1px solid var(--divider-color); background: none; color: var(--primary-color, #14b8a6); cursor: pointer; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        textarea { font: 13px/1.4 monospace; padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); resize: vertical; box-sizing: border-box; width: 100%; }
        .field label.chk { display: flex; align-items: center; gap: 6px; font-size: 14px; }
      </style>
      <div class="tab-bar">
        <div class="tab" data-tab="general">General</div>
        <div class="tab" data-tab="people">People</div>
        <div class="tab" data-tab="calendar">Calendar</div>
        <div class="tab" data-tab="buttons">Buttons</div>
      </div>
      <div class="pane" data-pane="general"></div>
      <div class="pane" data-pane="people"></div>
      <div class="pane" data-pane="calendar"></div>
      <div class="pane" data-pane="buttons"></div>`;
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => {
      el.addEventListener('click', () => this._setTab(el.dataset.tab));
    });
    const mountCal = () => {
      this._calEditor = document.createElement('hearthlike-calendar-card-editor');
      this._calEditor.addEventListener('config-changed', (ev) => {
        ev.stopPropagation();
        const cal = { ...ev.detail.config };
        delete cal.type;
        this._config = { ...this._config, calendar: cal };
        this._emit();
      });
      this.shadowRoot.querySelector('[data-pane="calendar"]').appendChild(this._calEditor);
      if (this._hass) this._calEditor.hass = this._hass;
      this._calEditor.setConfig({ type: 'custom:hearthlike-calendar-card', ...(this._config.calendar || {}) });
    };
    if (customElements.get('hearthlike-calendar-card-editor')) mountCal();
    else customElements.whenDefined('hearthlike-calendar-card-editor').then(mountCal);
  }

  // Pickers are configured before they are attached: ha-entity-picker renders from this.hass
  // as soon as it connects, so setting it afterwards can leave an empty, dead picker.
  _picker(domains, label, value, onChange) {
    const el = document.createElement('ha-entity-picker');
    el.hass = this._hass;
    if (domains) el.includeDomains = domains;
    el.label = label;
    el.value = value || '';
    el.allowCustomEntity = true;
    el.addEventListener('value-changed', (ev) => onChange(ev.detail.value || ''));
    return el;
  }

  _renderGeneral() {
    const pane = this.shadowRoot.querySelector('[data-pane="general"]');
    const clock = this._config.clock;
    pane.innerHTML = `
      <div class="wrap">
        <div class="field">
          <div id="weather-slot"></div>
          <div class="hint">Shows its temperature and condition icon in the header. Leave empty to hide the weather.</div>
        </div>
        <div class="field">
          <label class="chk"><input type="checkbox" id="clock-on" ${clock ? 'checked' : ''}> Show clock</label>
          <label class="chk"><input type="checkbox" id="clock-mil" ${clock && clock.military ? 'checked' : ''} ${clock ? '' : 'disabled'}> 24-hour time</label>
          <label class="chk"><input type="checkbox" id="clock-sec" ${clock && clock.seconds ? 'checked' : ''} ${clock ? '' : 'disabled'}> Show seconds</label>
        </div>
        <div class="field">
          <label for="css">Custom CSS (optional)</label>
          <textarea id="css" rows="6" spellcheck="false" placeholder=".avatar { border-width: 5px; }&#10;.clock { color: orange; }">${this._esc(this._config.style || '')}</textarea>
          <div class="hint">Applied inside the card. Classes: .header .weather .clock .people .person .avatar .badge .pname .buttons .btn .bname. Variables: --hearthlike-avatar-size, --hearthlike-ring-width, --hearthlike-background and more (see the README).</div>
        </div>
        <div class="hint">Use this card on a view set to Panel mode so it can fill the screen.</div>
      </div>`;
    pane.querySelector('#css').addEventListener('input', (ev) => this._setKey('style', ev.target.value.trim() ? ev.target.value : ''));
    pane.querySelector('#weather-slot').replaceWith(this._picker(['weather'], 'Weather entity', this._config.weather, (v) => this._setKey('weather', v)));
    const setClock = () => {
      const on = pane.querySelector('#clock-on').checked;
      const clockCfg = on ? {
        military: pane.querySelector('#clock-mil').checked,
        seconds: pane.querySelector('#clock-sec').checked,
      } : '';
      pane.querySelector('#clock-mil').disabled = !on;
      pane.querySelector('#clock-sec').disabled = !on;
      this._setKey('clock', clockCfg);
    };
    pane.querySelectorAll('input[type=checkbox]').forEach((el) => el.addEventListener('change', setClock));
  }

  _renderList(key) {
    const pane = this.shadowRoot.querySelector(`[data-pane="${key}"]`);
    const items = this._config[key] || [];
    const people = key === 'people';
    const rows = items.map((it, idx) => `
      <div class="row" data-idx="${idx}">
        <div class="picker-slot" data-idx="${idx}"></div>
        <input type="text" class="f-name" data-idx="${idx}" placeholder="Name (optional)" value="${this._esc(it.name || '')}">
        ${people
          ? `<input type="color" class="f-color" data-idx="${idx}" title="Ring and name colour" value="${this._esc(/^#[0-9a-f]{6}$/i.test(it.color || '') ? it.color : '#378add')}">`
          : `<input type="text" class="f-icon" data-idx="${idx}" placeholder="Icon, e.g. mdi:lightbulb" value="${this._esc(it.icon || '')}">
             <label class="chk"><input type="checkbox" class="f-state" data-idx="${idx}" ${it.show_state ? 'checked' : ''}> Show state</label>`}
        <button class="remove" data-idx="${idx}" title="Remove">&#10005;</button>
      </div>`).join('');
    pane.innerHTML = `
      <div class="wrap">
        <div class="hint">${people
          ? 'Badges shown under the header: photo, home/away indicator and name.'
          : 'Tiles along the bottom. Tapping one toggles the entity (lights, switches, ...).'}</div>
        ${items.length ? rows : `<div class="empty">${people ? 'No people yet.' : 'No buttons yet.'}</div>`}
        <button class="add">+ Add ${people ? 'person' : 'button'}</button>
      </div>`;
    pane.querySelectorAll('.picker-slot').forEach((slot) => {
      const idx = Number(slot.dataset.idx);
      slot.replaceWith(this._picker(people ? ['person'] : null, people ? 'Person' : 'Entity', items[idx].entity,
        (v) => this._setItem(key, idx, 'entity', v)));
    });
    pane.querySelectorAll('.f-name').forEach((el) => el.addEventListener('input', () => this._setItem(key, Number(el.dataset.idx), 'name', el.value.trim())));
    pane.querySelectorAll('.f-color').forEach((el) => el.addEventListener('input', () => this._setItem(key, Number(el.dataset.idx), 'color', el.value)));
    pane.querySelectorAll('.f-icon').forEach((el) => el.addEventListener('input', () => this._setItem(key, Number(el.dataset.idx), 'icon', el.value.trim())));
    pane.querySelectorAll('.f-state').forEach((el) => el.addEventListener('change', () => this._setItem(key, Number(el.dataset.idx), 'show_state', el.checked)));
    pane.querySelectorAll('.remove').forEach((el) => el.addEventListener('click', () => this._removeItem(key, Number(el.dataset.idx))));
    pane.querySelector('.add').addEventListener('click', () => this._addItem(key, { entity: '' }));
  }

  _render() {
    this._ensureBuilt();
    this._renderGeneral();
    this._renderList('people');
    this._renderList('buttons');
    if (this._calEditor) this._calEditor.setConfig({ type: 'custom:hearthlike-calendar-card', ...(this._config.calendar || {}) });
    this._setTab(this._activeTab);
  }

  _setTab(tab) {
    this._activeTab = tab;
    this.shadowRoot.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    this.shadowRoot.querySelectorAll('.pane').forEach((el) => el.classList.toggle('active', el.dataset.pane === tab));
  }
}
if (!customElements.get('hearthlike-dashboard-card-editor')) customElements.define('hearthlike-dashboard-card-editor', HearthlikeDashboardCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'hearthlike-dashboard-card'))
  window.customCards.push({
    type: 'hearthlike-dashboard-card',
    name: 'HearthLike Dashboard Card',
    description: 'All-in-one family wall display for a panel view: weather and clock, people badges, the calendar, and quick toggle buttons.',
  });

}

// ---- www/hearthlike-cards/hearthlike-day-card.js ----
{
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
        this._maybeFetch(), this._render();
      }, 3e4)));
  }
  async _maybeFetch() {
    if (
      (window.__hearthlikeCalendarUpdatedAt &&
        window.__hearthlikeCalendarUpdatedAt !== this._lastCalendarUpdateSeen &&
        ((this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt),
        (this._events = null)),
      !this._hass || !this._config)
    )
      return;
    const e = this._dateKey(this._selectedDate);
    if (this._fetchedKey === e && this._events) return;
    this._fetchedKey = e;
    const t = new Date(this._selectedDate),
      n = new Date(this._selectedDate);
    n.setDate(n.getDate() + 1);
    const a = Array.from(new Set(this._getColumns().flatMap((e) => e.entities))),
      i = {};
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
          i[e] = [];
        }
      }),
    ),
      this._dateKey(this._selectedDate) === e && ((this._events = i), this._render());
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
            })()}px;background:${e.color}">\n        ${this._esc(e.title)}\n      </div>`
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
                  `\n          <div class="event${t ? " past" : ""}" data-idx="${a}" style="top:${e.top}px;height:${e.height}px;left:calc(${e.leftPct}% + ${n}px);width:calc(${e.widthPct}% - ${2 * n}px);background:${e.color}">\n            <div class="event-title">${this._esc(e.title)}</div>\n            <div class="event-time">${this._formatTime(e.startMin)} – ${this._formatTime(e.endMin)}</div>\n          </div>`
                );
              })
              .join("")}</div>`,
        )
        .join("");
    let b = "";
    if (this._pinnedToday && h >= 60 * a && h <= 60 * i) {
      b = `<div class="now-line" style="top:${((h - 60 * a) / 60) * o}px"><span class="now-dot"></span></div>`;
    }
    (this.shadowRoot.innerHTML = `\n      <style>\n        :host { display:block; height:100%; }\n        ha-card { height:100%; min-height:200px; box-sizing:border-box; padding:12px 16px 12px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; }\n        .topbar { flex:none; display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:6px; }\n        .nav { background:none; border:none; color:var(--secondary-text-color); font-size:clamp(16px, 1.8vmin, 26px); line-height:1; cursor:pointer; padding:4px 8px; }\n        .nav:hover { color:var(--primary-text-color); }\n        .date-block { display:flex; align-items:center; gap:10px; }\n        .date-label { font-size:clamp(16px, 1.8vmin, 26px); font-weight:500; color:var(--primary-text-color); }\n        .today-btn { font-size:clamp(9px, 1vmin, 13px); padding:2px 10px; border-radius:12px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .headers-row { flex:none; display:flex; margin-bottom:4px; align-items:center; }\n        .headers-row .spacer { width:52px; flex:none; }\n        .headers-flex { flex:1; display:flex; gap:15px; }\n        .col-header { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px; padding:2px 8px; }\n        .allday-row { flex:none; display:flex; margin-bottom:6px; }\n        .allday-row .spacer { width:52px; flex:none; }\n        .allday-label { display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }\n        .allday-flex { flex:1; position:relative; }\n        .allday-box { position:absolute; border-radius:3px; box-sizing:border-box; font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.25; padding:clamp(4px, 0.5vmin, 6px); white-space:normal; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; text-overflow:ellipsis; color:#fff; }\n        .dot { width:8px; height:8px; border-radius:50%; flex:none; }\n        .col-name { font-size:clamp(11px, 1.3vmin, 16px); font-weight:500; color:var(--primary-text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n        .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }\n        .grid-wrap { display:flex; position:relative; }\n        .hour-col { position:relative; width:52px; flex:none; }\n        .hour-label { position:absolute; right:8px; transform:translateY(4px); font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }\n        .cols-wrap { position:relative; flex:1; display:flex; gap:15px; border-top:1px solid rgba(255,255,255,0.14); }\n        .hour-lines { position:absolute; left:0; right:0; top:0; bottom:0; pointer-events:none; z-index:0; }\n        .hline { position:absolute; left:0; right:0; border-top:1px solid rgba(255,255,255,0.14); }\n        .col-body { position:relative; flex:1; min-width:0; z-index:1; }\n        .event { position:absolute; border-radius:3px; padding:clamp(4px, 0.5vmin, 6px); box-sizing:border-box; overflow:hidden; }\n        .event-title { font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.25; color:#fff; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; white-space:normal; overflow:hidden; text-overflow:ellipsis; }\n        .event-time { font-size:clamp(11.9px, 1.3vmin, 17px); font-weight:500; color:rgba(255,255,255,0.85); margin-bottom:2px; }\n        .now-line { position:absolute; left:0; right:0; height:0; border-top:2px solid #e24b4a; z-index:5; }\n        .now-dot { position:absolute; left:-4px; top:-4px; width:8px; height:8px; border-radius:50%; background:#e24b4a; }\n        .day-content { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }\n        .day-content.past-day { opacity:0.3; }\n        .event.past { filter:brightness(0.5); }\n        .event, .allday-box { cursor:pointer; }\n        .hd-content { padding:20px 24px 24px; color:var(--primary-text-color); font-size:14px; }\n        .hd-row { display:flex; align-items:center; gap:8px; margin:0 0 8px; }\n        .hd-row ha-icon { color:var(--primary-text-color); flex:none; width:20px; height:22px; }\n        .hd-info { font-size:14px; }\n        .hd-info a { color:var(--primary-text-color); text-decoration:none; }\n        .hd-desc { font-size:14px; color:var(--primary-text-color); white-space:normal; border-top:1px solid var(--divider-color); padding-top:16px; margin-top:16px; }\n        .hd-actions { display:flex; gap:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--divider-color); }\n        .hd-btn { display:flex; align-items:center; gap:6px; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .hd-btn ha-icon { width:18px; height:18px; }\n        .hd-btn-danger { color:#e24b4a; border-color:#e24b4a; }\n        .hd-error { color:#e24b4a; font-size:13px; min-height:16px; margin-top:8px; }\n        .hd-confirm-label { font-size:15px; color:var(--primary-text-color); margin-bottom:4px; }\n        .af-content { display:flex; flex-direction:column; gap:14px; padding:20px 24px 4px; min-width:280px; color:var(--primary-text-color); }\n        .af-row { display:flex; gap:12px; }\n        .af-row .af-field { flex:1; }\n        .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }\n        .af-label { color:var(--secondary-text-color); }\n        .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }\n        .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }\n        .af-error { color:#e24b4a; font-size:13px; min-height:16px; }\n        .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; flex-wrap:wrap; }\n        .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }\n        .af-btn-text { background:none; color:var(--primary-color, #378ADD); }\n        .af-btn-filled { background:var(--primary-color, #378ADD); color:#fff; }\n        .af-btn-danger { background:#e24b4a; color:#fff; }\n      </style>\n      <ha-card>\n        <div class="topbar">\n          <button class="nav" id="prev">&#8249;</button>\n          <div class="date-block">\n            <div class="date-label">${s}</div>\n            ${this._pinnedToday ? "" : '<button class="today-btn" id="today">Today</button>'}\n          </div>\n          <button class="nav" id="next">&#8250;</button>\n        </div>\n        <div class="day-content${l ? " past-day" : ""}">\n          <div class="headers-row">\n            <div class="spacer"></div>\n            <div class="headers-flex">${u}</div>\n          </div>\n          ${x}\n          <div class="grid-scroll">\n            <div class="grid-wrap">\n              <div class="hour-col" style="height:${r}px">${v}</div>\n              <div class="cols-wrap" style="height:${r}px">\n                <div class="hour-lines">${g}</div>\n                ${y}\n                ${b}\n              </div>\n            </div>\n          </div>\n        </div>\n      </ha-card>\n    `),
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
            `\n      <div class="hde-row" data-idx="${t}">\n        <div class="hde-row-top">\n          <input class="hde-name" data-field="name" data-idx="${t}" type="text" value="${(e.name || "").replace(/"/g, "&quot;")}" placeholder="Column name" />\n          <input class="hde-color" data-field="color" data-idx="${t}" type="color" value="${e.color || "#378ADD"}" />\n          <button class="hde-remove" data-idx="${t}" title="Remove column">&#10005;</button>\n        </div>\n        <ha-entity-picker\n          class="hde-picker"\n          data-idx="${t}"\n          allow-custom-entity\n        ></ha-entity-picker>\n      </div>`,
        )
        .join("");
    this.shadowRoot || this.attachShadow({ mode: "open" }),
      (this.shadowRoot.innerHTML = `\n      <style>\n        .hde-wrap { display:flex; flex-direction:column; gap:16px; padding:8px 0; }\n        .hde-empty { font-size:13px; color:var(--secondary-text-color); }\n        .hde-row { display:flex; flex-direction:column; gap:6px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }\n        .hde-row-top { display:flex; align-items:center; gap:8px; }\n        .hde-name { flex:1; font:inherit; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }\n        .hde-color { width:36px; height:32px; border:none; background:none; padding:0; cursor:pointer; }\n        .hde-remove { background:none; border:none; color:var(--secondary-text-color); font-size:16px; cursor:pointer; padding:4px 8px; }\n        .hde-remove:hover { color:#e24b4a; }\n        .hde-add { align-self:flex-start; font:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:6px; border:1px solid var(--divider-color); background:none; color:var(--primary-color, #378ADD); cursor:pointer; }\n        .hde-hint { font-size:12px; color:var(--secondary-text-color); }\n      </style>\n      <div class="hde-wrap">\n        <div class="hde-hint">Leave "columns" empty (remove all rows) to auto-show every calendar on the system. Add rows to pick specific calendars, names, and colors.</div>\n        ${e.length ? t : '<div class="hde-empty">No columns configured — the card will auto-discover every calendar.</div>'}\n        <button class="hde-add" id="hde-add">+ Add column</button>\n      </div>\n    `),
      this.shadowRoot.querySelectorAll(".hde-picker").forEach((t) => {
        const n = parseInt(t.getAttribute("data-idx"), 10);
        (t.hass = this._hass),
          (t.includeDomains = ["calendar"]),
          (t.label = "Calendars for this column"),
          (t.multiple = !0),
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

}

// ---- www/hearthlike-cards/hearthlike-fab-card.js ----
{
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
        '\n      <style>\n        :host {\n          position: relative;\n          display: block;\n          width: 100%;\n          height: 100%;\n          pointer-events: none;\n        }\n        .fab {\n          position: absolute;\n          right: 20px;\n          bottom: 20px;\n          width: 60px;\n          height: 60px;\n          border-radius: 50%;\n          border: none;\n          background: var(--hearthlike-fab-color, #14b8a6);\n          color: #fff;\n          font-size: 30px;\n          line-height: 1;\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          cursor: pointer;\n          box-shadow: 0 4px 12px rgba(0,0,0,0.35);\n          pointer-events: auto;\n          z-index: 10;\n        }\n        .fab:active { transform: scale(0.95); }\n        ha-dialog { pointer-events: auto; }\n        .af-content { display:flex; flex-direction:column; gap:14px; padding:8px 24px 4px; min-width:280px; color:var(--primary-text-color); }\n        .af-row { display:flex; gap:12px; }\n        .af-row .af-field { flex:1; }\n        .af-field { display:flex; flex-direction:column; gap:4px; font-size:13px; }\n        .af-label { color:var(--secondary-text-color); }\n        .af-input { font:inherit; font-size:15px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color, #1c1c1c); color:var(--primary-text-color); }\n        .af-checkrow { display:flex; align-items:center; gap:8px; font-size:14px; }\n        .af-error { color:#e24b4a; font-size:13px; min-height:16px; }\n        .af-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 0 4px; }\n        .af-btn { font:inherit; font-size:14px; font-weight:600; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; }\n        .af-btn-text { background:none; color:var(--primary-color, #14b8a6); }\n        .af-btn-filled { background:var(--hearthlike-fab-color, #14b8a6); color:#fff; }\n      </style>\n      <button class="fab" id="fab-btn" aria-label="Add event">+</button>\n    '),
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

}

// ---- www/hearthlike-cards/hearthlike-month-card.js ----
{
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
      this._maybeFetch();
      this._render();
    }, 30000);
  }
  async _maybeFetch() {
    if (
      window.__hearthlikeCalendarUpdatedAt &&
      window.__hearthlikeCalendarUpdatedAt !== this._lastCalendarUpdateSeen
    ) {
      this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt;
      this._events = null;
    }
    if (!this._hass || !this._config) return;
    const key = this._dateKey(this._selectedMonthStart);
    if (this._fetchedKey === key && this._events) return;
    this._fetchedKey = key;
    const days = this._buildMonthDays(this._selectedMonthStart);
    const start = days[0];
    const end = new Date(days[days.length - 1]);
    end.setDate(end.getDate() + 1);
    const results = {};
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
          results[cal.entity] = [];
        }
      })
    );
    if (this._dateKey(this._selectedMonthStart) === key) {
      this._events = results;
      this._render();
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
            <div class="mevent-title">${this._esc(e.title)}</div>
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
        .day-cell.today { background:rgba(255,255,255,0.05); }
        .day-cell.other-month { opacity:0.35; }
        .day-cell.past-day:not(.other-month) { filter:brightness(0.6); }
        .day-num { flex:none; font-size:clamp(11px, 1.3vmin, 16px); font-weight:400; color:var(--primary-text-color); }
        .day-num.today-num { color:var(--primary-color, #378ADD); }
        .day-events { flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:clamp(4px, 0.42vmin, 6px); scrollbar-width:thin; }
        .mevent { flex:none; border-radius:3px; padding:clamp(4px, 0.5vmin, 6px); box-sizing:border-box; cursor:pointer; overflow:hidden; }
        .mevent-meta { font-size:clamp(11.9px, 1.3vmin, 17px); font-weight:500; color:rgba(255,255,255,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
        .mevent-title { font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; color:#fff; line-height:1.2; white-space:normal; overflow-wrap:break-word; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; }
        .mevent.past { filter:brightness(0.55); }
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
      </div>`
      )
      .join('');
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .hde-wrap { display:flex; flex-direction:column; gap:10px; padding:8px 0; }
        .hde-empty { font-size:13px; color:var(--secondary-text-color); }
        .hde-row { display:flex; align-items:center; gap:8px; }
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

}

// ---- www/hearthlike-cards/hearthlike-week-card.js ----
{
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
      this._maybeFetch();
      this._render();
    }, 30000);
  }

  async _maybeFetch() {
    if (
      window.__hearthlikeCalendarUpdatedAt &&
      window.__hearthlikeCalendarUpdatedAt !== this._lastCalendarUpdateSeen
    ) {
      this._lastCalendarUpdateSeen = window.__hearthlikeCalendarUpdatedAt;
      this._events = null;
    }
    if (!this._hass || !this._config) return;
    const key = this._dateKey(this._selectedWeekStart);
    if (this._fetchedKey === key && this._events) return;
    this._fetchedKey = key;
    const start = new Date(this._selectedWeekStart);
    const end = new Date(this._selectedWeekStart);
    end.setDate(end.getDate() + 7);
    const results = {};
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
          results[cal.entity] = [];
        }
      })
    );
    if (this._dateKey(this._selectedWeekStart) === key) {
      this._events = results;
      this._render();
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
    this._render();
    this._maybeFetch();
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

  _render() {
    if (!this._config || !this.shadowRoot) return;
    // While an event-detail dialog is open, skip the periodic/data-driven
    // re-render entirely rather than let a background tick or fetch nuke the
    // dialog out from under the viewer mid-read.
    if (this._dialogOpen) return;
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
    // All-day lane height/gap scale gently with viewport size (like the
    // font-size clamps below) so a 2-line all-day title still has room to
    // breathe on a small tablet or a big wall display, instead of being a
    // fixed pixel size that only looks right at one screen size.
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const laneHeight = Math.max(64, Math.min(92, Math.round(vmin * 6.9)));
    const laneGap = Math.max(4, Math.min(7, Math.round(vmin * 0.42)));
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
        ${this._esc(it.title)}
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
            <div class="event-title">${this._esc(e.title)}</div>
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
        ha-card { height:100%; min-height:200px; box-sizing:border-box; padding:12px 16px 12px; overflow:hidden; display:flex; flex-direction:column; background:transparent; box-shadow:none; }
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
        .col-header.today { background:rgba(255,255,255,0.05); }
        .day-name { font-size:clamp(19px, 2.4vmin, 29px); font-weight:600; letter-spacing:0.03em; text-transform:uppercase; color:var(--secondary-text-color); }
        .day-num { font-size:clamp(27px, 3.5vmin, 43px); font-weight:500; color:var(--primary-text-color); }
        .allday-row { flex:none; display:flex; margin-bottom:6px; }
        .allday-row .spacer { width:52px; flex:none; }
        .allday-label { display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }
        .allday-flex { flex:1; position:relative; }
        .allday-box { position:absolute; border-radius:3px; box-sizing:border-box; font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.25; padding:clamp(4px, 0.5vmin, 6px); white-space:normal; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; text-overflow:ellipsis; color:#fff; }
        .allday-box.past-day { opacity:0.3; }
        .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
        .grid-wrap { display:flex; position:relative; }
        .hour-col { position:relative; width:52px; flex:none; }
        .hour-label { position:absolute; right:8px; transform:translateY(4px); font-size:clamp(11px, 1.3vmin, 16px); font-weight:800; color:var(--secondary-text-color); }
        .cols-wrap { position:relative; flex:1; display:flex; gap:15px; border-top:1px solid rgba(255,255,255,0.14); }
        .hour-lines { position:absolute; left:0; right:0; top:0; bottom:0; pointer-events:none; z-index:0; }
        .hline { position:absolute; left:0; right:0; border-top:1px solid rgba(255,255,255,0.14); }
        .col-body { position:relative; flex:1; min-width:0; z-index:1; }
        .col-body.today { background:rgba(255,255,255,0.03); border-radius:6px; }
        .event { position:absolute; border-radius:3px; padding:clamp(4px, 0.5vmin, 6px); box-sizing:border-box; overflow:hidden; }
        .event-title { font-size:clamp(14px, 1.5vmin, 20px); font-weight:800; line-height:1.2; color:#fff; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; white-space:normal; overflow:hidden; text-overflow:ellipsis; }
        .event-time { font-size:clamp(11.9px, 1.3vmin, 17px); font-weight:500; color:rgba(255,255,255,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
        .now-line { position:absolute; left:0; right:0; height:0; border-top:2px solid #e24b4a; z-index:5; }
        .now-dot { position:absolute; left:-4px; top:-4px; width:8px; height:8px; border-radius:50%; background:#e24b4a; }
        .col-header.past-day { opacity:0.3; }
        .col-body.past-day { filter:brightness(0.3); }
        .event.past { filter:brightness(0.5); }
        .event, .allday-box { cursor:pointer; }
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
  description: 'Sunday-start weekly hourly grid view, inspired by Hearth Display',
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
      </div>`
      )
      .join('');

    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .hde-wrap { display:flex; flex-direction:column; gap:10px; padding:8px 0; }
        .hde-empty { font-size:13px; color:var(--secondary-text-color); }
        .hde-row { display:flex; align-items:center; gap:8px; }
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

if (!customElements.get('hearthlike-week-card-editor')) customElements.define('hearthlike-week-card-editor', HearthlikeWeekCardEditor);

}
