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
// weather_tap_action:              # optional; what tapping the weather does (default: open the entity's more-info popup)
//   action: more-info              # more-info | navigate | url | call-service | none
//   navigation_path: /lovelace/forecast   # for navigate
//   url_path: https://example.com        # for url
//   service: script.turn_on              # for call-service, with optional service_data: {...}
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
        .root { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow-x: hidden; overflow-y: auto;
                background: var(--hearthlike-background, var(--primary-background-color));
                color: var(--hearthlike-text-color, var(--primary-text-color)); }
        .header { display: flex; align-items: center; justify-content: space-between; flex: none;
                  font-size: var(--hearthlike-header-font-size, clamp(24px, 4.85vmin, 42px)); line-height: 1;
                  padding: var(--hearthlike-header-padding, clamp(4px, 0.8vmin, 7px) 8px clamp(4px, 0.8vmin, 7px) 15px); }
        .weather { display: flex; align-items: center; gap: 0.17em; font-weight: 900; }
        .weather.tappable { cursor: pointer; }
        .weather ha-icon { --mdc-icon-size: 1em; display: flex; }
        .clock { margin-left: auto; font-weight: 900; font-variant-numeric: tabular-nums; }
        .people { display: flex; justify-content: space-evenly; align-items: flex-start; flex: none;
                  gap: var(--hearthlike-people-gap, 8px);
                  padding: var(--hearthlike-people-padding, clamp(6px, 3.45vmin, 30px) min(80px, 5.6vw) clamp(6px, 4.7vmin, 41px)); }
        .person { display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 1.25vmin, 11px); min-width: 0; flex: 1 1 0; }
        .avatar { position: relative; flex: none; box-sizing: border-box; border-radius: 50%;
                  width: var(--hearthlike-avatar-size, clamp(56px, 14vmin, 122px));
                  height: var(--hearthlike-avatar-size, clamp(56px, 14vmin, 122px));
                  border: var(--hearthlike-ring-width, 5px) solid var(--ring, var(--primary-color));
                  background: var(--secondary-background-color); display: flex; align-items: center; justify-content: center;
                  font-size: var(--hearthlike-avatar-font-size, clamp(22px, 5.5vmin, 48px)); font-weight: 600; line-height: 1; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .badge { position: absolute; top: -3px; right: -3px; width: clamp(18px, 3.45vmin, 30px); height: clamp(18px, 3.45vmin, 30px); border-radius: 50%;
                 display: flex; align-items: center; justify-content: center; color: #fff;
                 background: var(--badge, var(--secondary-text-color)); }
        .badge ha-icon { --mdc-icon-size: clamp(12px, 2.3vmin, 20px); display: flex; }
        .pname { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;
                 font-size: var(--hearthlike-name-font-size, clamp(14px, 2.45vmin, 21px)); font-weight: 600; line-height: 0.95; padding-bottom: 1px;
                 color: var(--ring, var(--primary-text-color)); }
        /* On screens too short for everything, the calendar keeps a usable height and the page scrolls. */
        .cal { position: relative; flex: 1 0 var(--hearthlike-calendar-min-height, min(420px, 85dvh)); }
        .cal > * { position: absolute; inset: 0; display: block; }
        .buttons { display: flex; align-items: stretch; flex: none; gap: 1px; overflow-x: auto; }
        .btn { flex: 1 0 64px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px;
               padding: var(--hearthlike-button-padding, clamp(5px, 1.4vmin, 12px) 4px); cursor: pointer; border: 0; font: inherit; min-width: 0;
               background: var(--hearthlike-button-background, var(--card-background-color, var(--secondary-background-color)));
               color: var(--hearthlike-button-color, var(--primary-text-color)); }
        .btn:active { filter: brightness(1.2); }
        .btn ha-icon { --mdc-icon-size: var(--hearthlike-button-icon-size, clamp(20px, 3.1vmin, 27px)); display: flex; }
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
    if (this._elWeather) {
      const act = (c.weather_tap_action && c.weather_tap_action.action) || 'more-info';
      this._elWeather.classList.toggle('tappable', act !== 'none');
      this._elWeather.addEventListener('click', () => this._weatherTap());
    }
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

  // Runs the configured weather tap action; the default opens the weather entity's more-info popup.
  _weatherTap() {
    const a = this._config.weather_tap_action || {};
    const action = a.action || 'more-info';
    if (action === 'none') return;
    if (action === 'more-info') {
      const entityId = a.entity || this._config.weather;
      if (entityId) this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
    } else if (action === 'navigate') {
      if (!a.navigation_path) return;
      history.pushState(null, '', a.navigation_path);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } else if (action === 'url') {
      if (a.url_path) window.open(a.url_path, a.new_tab === false ? '_self' : '_blank');
    } else if (action === 'call-service') {
      const [domain, service] = String(a.service || '').split('.');
      if (domain && service && this._hass) this._hass.callService(domain, service, a.service_data || a.data || {}, a.target);
    }
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
    const html = this._config.people.filter((p) => p && p.entity).map((p) => {
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
    const html = this._config.buttons.filter((b) => b && b.entity).map((b) => {
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
    this.shadowRoot?.querySelectorAll('ha-entity-picker, hearthlike-icon-field').forEach((el) => { el.hass = hass; });
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

  _moveItem(key, idx, delta) {
    const list = (this._config[key] || []).slice();
    const to = idx + delta;
    if (to < 0 || to >= list.length) return;
    [list[idx], list[to]] = [list[to], list[idx]];
    this._config = { ...this._config, [key]: list };
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
        .row ha-entity-picker, .row hearthlike-icon-field { flex: 1 1 100%; min-width: 0; }
        .row input[type=text] { flex: 1 1 120px; min-width: 0; font: inherit; padding: 8px; border-radius: 6px;
                                border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
        .row input[type=color] { width: 40px; height: 36px; padding: 0; border: 1px solid var(--divider-color); border-radius: 6px; background: none; }
        .row label.chk { display: flex; align-items: center; gap: 4px; font-size: 14px; color: var(--primary-text-color); }
        .actions { margin-left: auto; display: flex; align-items: center; }
        .move:disabled { opacity: 0.3; cursor: default; }
        .remove, .move { background: none; border: none; color: var(--secondary-text-color); font-size: 16px; cursor: pointer; padding: 4px 8px; }
        .remove:hover { color: #e24b4a; }
        .add { align-self: flex-start; font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 6px;
               border: 1px solid var(--divider-color); background: none; color: var(--primary-color, #14b8a6); cursor: pointer; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        textarea { font: 13px/1.4 monospace; padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); resize: vertical; box-sizing: border-box; width: 100%; }
        .field label.chk { display: flex; align-items: center; gap: 6px; font-size: 14px; }
        .field select, .field input[type=text] { font: inherit; padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); box-sizing: border-box; width: 100%; }
        .field .bad { border-color: #e24b4a; }
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
    const tap = this._config.weather_tap_action || {};
    pane.innerHTML = `
      <div class="wrap">
        <div class="field">
          <div id="weather-slot"></div>
          <div class="hint">Shows its temperature and condition icon in the header. Leave empty to hide the weather.</div>
        </div>
        <div class="field">
          <label for="wta-action">When the weather is tapped</label>
          <select id="wta-action">
            ${[['more-info', 'Open the entity popup (default)'], ['navigate', 'Go to a dashboard path'], ['url', 'Open a URL'], ['call-service', 'Call a service'], ['none', 'Do nothing']]
              .map(([v, l]) => `<option value="${v}" ${tap.action === v || (!tap.action && v === 'more-info') ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <input type="text" id="wta-path" placeholder="/lovelace/forecast" value="${this._esc(tap.navigation_path || '')}">
          <input type="text" id="wta-url" placeholder="https://example.com" value="${this._esc(tap.url_path || '')}">
          <input type="text" id="wta-service" placeholder="domain.service, e.g. script.turn_on" value="${this._esc(tap.service || '')}">
          <textarea id="wta-data" rows="3" spellcheck="false" placeholder='Service data as JSON, e.g. {"entity_id": "script.example"}'>${this._esc(tap.service_data ? JSON.stringify(tap.service_data) : '')}</textarea>
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
    const setTapVisibility = () => {
      const act = pane.querySelector('#wta-action').value;
      const show = { path: act === 'navigate', url: act === 'url', service: act === 'call-service', data: act === 'call-service' };
      Object.entries(show).forEach(([k, v]) => { pane.querySelector('#wta-' + k).style.display = v ? '' : 'none'; });
    };
    const setTap = () => {
      setTapVisibility();
      const act = pane.querySelector('#wta-action').value;
      let cfg = '';
      if (act === 'none') cfg = { action: 'none' };
      else if (act === 'navigate') cfg = { action: 'navigate', navigation_path: pane.querySelector('#wta-path').value.trim() };
      else if (act === 'url') cfg = { action: 'url', url_path: pane.querySelector('#wta-url').value.trim() };
      else if (act === 'call-service') {
        cfg = { action: 'call-service', service: pane.querySelector('#wta-service').value.trim() };
        const dataEl = pane.querySelector('#wta-data');
        const raw = dataEl.value.trim();
        dataEl.classList.remove('bad');
        if (raw) {
          try { cfg.service_data = JSON.parse(raw); } catch (e) { dataEl.classList.add('bad'); }
        }
      }
      this._setKey('weather_tap_action', cfg);
    };
    pane.querySelector('#wta-action').addEventListener('change', setTap);
    ['#wta-path', '#wta-url', '#wta-service', '#wta-data'].forEach((sel) => pane.querySelector(sel).addEventListener('input', setTap));
    setTapVisibility();
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
          : `<div class="icon-slot" data-idx="${idx}"></div>
             <label class="chk"><input type="checkbox" class="f-state" data-idx="${idx}" ${it.show_state ? 'checked' : ''}> Show state</label>`}
        <span class="actions">
          <button class="move move-up" data-idx="${idx}" title="Move up" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="move move-down" data-idx="${idx}" title="Move down" ${idx === items.length - 1 ? 'disabled' : ''}>&#9660;</button>
          <button class="remove" data-idx="${idx}" title="Remove">&#10005;</button>
        </span>
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
    // Buttons draw icons only, so no emoji row here.
    pane.querySelectorAll('.icon-slot').forEach((slot) => {
      const idx = Number(slot.dataset.idx);
      const field = document.createElement('hearthlike-icon-field');
      field.emoji = false;
      field.label = 'Icon (optional)';
      field.value = items[idx].icon || '';
      field.hass = this._hass;
      field.addEventListener('icon-changed', (ev) => this._setItem(key, idx, 'icon', ev.detail.value));
      slot.replaceWith(field);
    });
    pane.querySelectorAll('.f-state').forEach((el) => el.addEventListener('change', () => this._setItem(key, Number(el.dataset.idx), 'show_state', el.checked)));
    pane.querySelectorAll('.move-up').forEach((el) => el.addEventListener('click', () => this._moveItem(key, Number(el.dataset.idx), -1)));
    pane.querySelectorAll('.move-down').forEach((el) => el.addEventListener('click', () => this._moveItem(key, Number(el.dataset.idx), 1)));
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

// Version banner. dist/build.sh fills in the version from CHANGELOG.md; unbundled or unreleased shows "dev".
console.info(
  '%c HEARTHLIKE-DASHBOARD-CARD %c ' + ('__HEARTHLIKE_VERSION__'.startsWith('__') ? 'dev' : 'v__HEARTHLIKE_VERSION__') + ' ',
  'color:#fff;background:#03a9f4;font-weight:700;',
  'color:#03a9f4;background:#fff;font-weight:700;'
);
