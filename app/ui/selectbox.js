const html = require('choo/html');

module.exports = function(selected, options, translate, changed, htmlId) {
  function choose(event) {
    if (event.target.value != selected) {
      changed(event.target.value);
    }
  }

  return html`
    <select
      id="${htmlId}"
      class="su-select"
      data-selected="${selected}"
      onchange="${choose}"
    >
      ${options.map(
        value =>
          html`
            <option value="${value}" ${value == selected ? 'selected' : ''}>
              ${translate(value)}
            </option>
          `
      )}
    </select>
  `;
};
