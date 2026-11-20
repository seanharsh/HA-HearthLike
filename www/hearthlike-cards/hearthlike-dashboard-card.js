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
//   - entity: person.abby
//     name: Abby                   # optional, defaults to the entity's friendly name
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
// Use it on a view with `panel: true` so it can take the full height.

class HearthlikeDashboardCard extends HTMLElement {
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
        :host { display: block; height: calc(100dvh - var(--header-height, 56px)); }
        .root { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;
                background: var(--primary-background-color); color: var(--primary-text-color); }
        .header { display: flex; align-items: center; justify-content: space-between; flex: none;
                  padding: clamp(4px, 0.8vmin, 12px) clamp(14px, 2.5vmin, 32px); }
        .weather { display: flex; align-items: center; gap: 12px; font-size: clamp(24px, 5vmin, 48px); font-weight: 500; }
        .weather ha-icon { --mdc-icon-size: clamp(24px, 5vmin, 48px); }
        .clock { font-size: clamp(24px, 5vmin, 48px); font-weight: 700; font-variant-numeric: tabular-nums; }
        .people { display: flex; justify-content: space-around; flex: none; gap: 8px;
                  padding: clamp(6px, 1vmin, 16px) clamp(20px, 6.9vmin, 80px); }
        .person { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
        .avatar { position: relative; width: clamp(56px, 11vmin, 104px); height: clamp(56px, 11vmin, 104px);
                  border-radius: 50%; border: 3px solid var(--ring, var(--primary-color)); box-sizing: border-box;
                  background: var(--secondary-background-color); display: flex; align-items: center; justify-content: center;
                  font-size: clamp(22px, 4.5vmin, 40px); font-weight: 600; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .badge { position: absolute; top: -2px; right: -2px; width: 22px; height: 22px; border-radius: 50%;
                 display: flex; align-items: center; justify-content: center; color: #fff;
                 background: var(--badge, var(--secondary-text-color)); }
        .badge ha-icon { --mdc-icon-size: 14px; }
        .pname { font-size: clamp(14px, 2.2vmin, 22px); font-weight: 500; color: var(--ring, var(--primary-text-color)); }
        .cal { position: relative; flex: 1; min-height: 0; }
        .cal > * { position: absolute; inset: 0; }
        .buttons { display: flex; flex: none; gap: 1px; }
        .btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
               padding: 12px 4px; cursor: pointer; background: var(--card-background-color, var(--secondary-background-color));
               border: 0; color: var(--primary-text-color); font: inherit; min-width: 0; }
        .btn:active { filter: brightness(1.2); }
        .btn ha-icon { --mdc-icon-size: 27px; }
        .btn.on ha-icon { color: var(--state-light-active-color, #ffc107); }
        .btn.off, .btn.unavailable { color: var(--secondary-text-color); }
        .btn.unavailable { opacity: 0.6; }
        .bname { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .bstate { font-size: 12px; color: var(--secondary-text-color); text-transform: capitalize; }
      </style>
      <div class="root">
        ${c.weather || c.clock ? '<div class="header"><div class="weather"></div><div class="clock"></div></div>' : ''}
        ${Array.isArray(c.people) && c.people.length ? '<div class="people"></div>' : ''}
        <div class="cal"></div>
        ${Array.isArray(c.buttons) && c.buttons.length ? '<div class="buttons"></div>' : ''}
      </div>`;
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
    const html = this._config.people.map((p) => {
      const st = this._hass.states[p.entity];
      const name = p.name || (st && st.attributes.friendly_name) || p.entity;
      const pic = st && st.attributes.entity_picture;
      const state = st ? st.state : 'unknown';
      let badge = '';
      if (state === 'home') badge = '<span class="badge" style="--badge:var(--success-color, #43a047)"><ha-icon icon="mdi:home"></ha-icon></span>';
      else if (state === 'not_home') badge = '<span class="badge" style="--badge:var(--warning-color, #f57c00)"><ha-icon icon="mdi:home-export-outline"></ha-icon></span>';
      else if (state !== 'unknown' && state !== 'unavailable') badge = '<span class="badge" style="--badge:var(--info-color, #039be5)"><ha-icon icon="mdi:map-marker"></ha-icon></span>';
      const face = pic ? `<img src="${this._esc(pic)}" alt="">` : this._esc(String(name).slice(0, 1).toUpperCase());
      const ring = p.color ? `--ring:${this._esc(p.color)};` : '';
      return `<div class="person" style="${ring}"><div class="avatar">${face}${badge}</div><div class="pname">${this._esc(name)}</div></div>`;
    }).join('');
    this._set('people', this._elPeople, html);
  }

  _updateButtons() {
    if (!this._elButtons) return;
    const html = this._config.buttons.map((b) => {
      const st = this._hass.states[b.entity];
      const state = st ? st.state : 'unavailable';
      const name = b.name || (st && st.attributes.friendly_name) || b.entity;
      const domain = String(b.entity).split('.')[0];
      const fallback = { light: 'mdi:lightbulb', switch: 'mdi:toggle-switch', input_boolean: 'mdi:toggle-switch', fan: 'mdi:fan' }[domain] || 'mdi:gesture-tap';
      const icon = state === 'unavailable' ? 'mdi:help-circle-outline' : (b.icon || (st && st.attributes.icon) || fallback);
      const cls = state === 'on' ? 'on' : state === 'unavailable' ? 'unavailable' : 'off';
      return `<button class="btn ${cls}" data-entity="${this._esc(b.entity)}"><ha-icon icon="${this._esc(icon)}"></ha-icon>`
        + `<span class="bname">${this._esc(name)}</span>${b.show_state ? `<span class="bstate">${this._esc(state)}</span>` : ''}</button>`;
    }).join('');
    this._set('buttons', this._elButtons, html);
  }
}
if (!customElements.get('hearthlike-dashboard-card')) customElements.define('hearthlike-dashboard-card', HearthlikeDashboardCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'hearthlike-dashboard-card'))
  window.customCards.push({
    type: 'hearthlike-dashboard-card',
    name: 'HearthLike Dashboard Card',
    description: 'All-in-one family wall display for a panel view: weather and clock, people badges, the calendar, and quick toggle buttons.',
  });
