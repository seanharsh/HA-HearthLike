// hearthlike-icon-field.js
//
// The icon input used by the card editors: Home Assistant's icon picker (search MDI and installed icon sets, or
// type any other value), plus a row of tappable emoji with the ones that suit the calendar's name first.
//
// Properties: hass, value, label, entities (calendar entity ids) and hint (a column name) to rank the emoji,
// emoji (false hides the row). Fires "icon-changed" with { value }.

// [emoji, words it stands for]. A word matches the start of a word in the calendar's names.
const HEARTHLIKE_EMOJI = [
  ['👨‍👩‍👧', 'family'],
  ['🎂', 'birthday anniversary'],
  ['🏫', 'school class teacher'],
  ['💼', 'work office job meeting'],
  ['⚽', 'soccer'],
  ['🩺', 'doctor medical health clinic appointment'],
  ['🎵', 'music piano choir chorus band concert orchestra'],
  ['✈️', 'travel trip flight vacation'],
  ['🗑️', 'trash garbage recycl waste'],
  ['🏒', 'hockey'],
  ['🏀', 'basketball'],
  ['⚾', 'baseball softball'],
  ['🏈', 'football'],
  ['🏊', 'swim pool'],
  ['🤸', 'gymnastics tumbling cheer'],
  ['💃', 'dance ballet'],
  ['🏋️', 'gym workout fitness sport practice'],
  ['🎨', 'art craft'],
  ['📚', 'study library reading homework book'],
  ['🧒', 'kid child'],
  ['🦷', 'dentist dental orthodont'],
  ['🐾', 'pet dog cat vet'],
  ['🚗', 'car drive carpool'],
  ['🍽️', 'dinner meal food menu lunch'],
  ['🛒', 'grocery shopping'],
  ['🧹', 'chore clean'],
  ['🌳', 'yard garden outdoor camp'],
  ['⛪', 'church worship'],
  ['💰', 'bill pay money budget'],
  ['🎉', 'party holiday event celebrat'],
  ['⭐', 'favorite important'],
];
const HEARTHLIKE_EMOJI_SHOWN = 8;

class HearthlikeIconField extends HTMLElement {
  connectedCallback() {
    // Properties set before this element was defined sit on the instance; hand them to the setters.
    for (const key of ['hass', 'value', 'label', 'entities', 'hint', 'emoji']) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const v = this[key];
        delete this[key];
        this[key] = v;
      }
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._picker) {
      this._picker.hass = hass;
      this._renderEmoji();
    } else this._render();
  }

  set value(v) {
    this._value = v || '';
    if (this._picker) this._picker.value = this._value;
    this._renderEmoji();
  }

  get value() {
    return this._value || '';
  }

  set label(v) {
    this._label = v;
    if (this._picker) this._picker.label = v;
  }

  set entities(v) {
    this._entities = Array.isArray(v) ? v : [];
    this._renderEmoji();
  }

  set hint(v) {
    this._hint = v || '';
    this._renderEmoji();
  }

  set emoji(v) {
    this._noEmoji = v === false;
    this._renderEmoji();
  }

  _render() {
    if (!this.isConnected) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; }
          .emoji { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:4px; }
          .emoji:empty { display:none; }
          button { font:inherit; cursor:pointer; border-radius:6px; border:1px solid transparent; background:none; color:var(--primary-text-color); }
          .pick { font-size:20px; line-height:1; padding:5px; }
          .pick:hover { border-color:var(--divider-color); }
          .pick.selected { border-color:var(--primary-color); background:color-mix(in srgb, var(--primary-color) 15%, transparent); }
          .more { font-size:13px; padding:6px 8px; color:var(--primary-color); }
        </style>
        <div class="picker"></div>
        <div class="emoji"></div>`;
      this.shadowRoot.querySelector('.emoji').addEventListener('click', (ev) => {
        const button = ev.target.closest('button');
        if (!button) return;
        if (button.classList.contains('more')) {
          this._all = !this._all;
          this._renderEmoji();
        } else {
          // Tapping the selected emoji again clears the icon.
          this._pick(button.dataset.emoji === this.value ? '' : button.dataset.emoji);
        }
      });
    }
    // HA pickers need hass before they can render.
    if (!this._picker && this._hass) {
      const picker = document.createElement('ha-selector');
      picker.hass = this._hass;
      picker.selector = { icon: {} };
      picker.label = this._label || 'Icon (optional)';
      picker.required = false;
      picker.value = this.value;
      picker.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        this._pick(ev.detail.value || '');
      });
      this.shadowRoot.querySelector('.picker').appendChild(picker);
      this._picker = picker;
    }
    this._renderEmoji();
  }

  _pick(value) {
    if (value === this.value) return;
    this.value = value;
    this.dispatchEvent(new CustomEvent('icon-changed', { detail: { value } }));
  }

  // Emoji suiting the column name come first, then those suiting the calendars' names, then the rest.
  _rankedEmoji() {
    const calendars = (this._entities || []).map((id) => {
      const st = this._hass && this._hass.states && this._hass.states[id];
      return id + ' ' + ((st && st.attributes && st.attributes.friendly_name) || '');
    }).join(' ');
    const suits = (text) => {
      const clean = String(text || '').replace(/[._]/g, ' ');
      return ([, words]) => words.split(' ').some((w) => new RegExp('\\b' + w, 'i').test(clean));
    };
    return [...new Set([
      ...HEARTHLIKE_EMOJI.filter(suits(this._hint)),
      ...HEARTHLIKE_EMOJI.filter(suits(calendars)),
      ...HEARTHLIKE_EMOJI,
    ])];
  }

  _renderEmoji() {
    const row = this.shadowRoot && this.shadowRoot.querySelector('.emoji');
    if (!row) return;
    if (this._noEmoji) {
      row.innerHTML = '';
      return;
    }
    const ranked = this._rankedEmoji();
    row.innerHTML = (this._all ? ranked : ranked.slice(0, HEARTHLIKE_EMOJI_SHOWN))
      .map(([emoji, words]) => {
        const name = words.split(' ')[0];
        const selected = emoji === this.value;
        return `<button type="button" class="pick${selected ? ' selected' : ''}" data-emoji="${emoji}" title="${name}" aria-label="${name}" aria-pressed="${selected}">${emoji}</button>`;
      })
      .join('') + `<button type="button" class="more">${this._all ? 'Fewer' : 'More…'}</button>`;
  }
}
if (!customElements.get('hearthlike-icon-field')) customElements.define('hearthlike-icon-field', HearthlikeIconField);
