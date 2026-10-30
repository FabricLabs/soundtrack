'use strict';

/**
 * Escape text for HTML element content and quoted attribute values.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml (value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = escapeHtml;
