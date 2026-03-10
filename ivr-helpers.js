/**
 * ivr-helpers.js
 * Custom Handlebars helpers for IVR/Autocall scripting.
 *
 * Two supported export patterns:
 *   Pattern A (object): module.exports = { helperName: fn, ... }
 *   Pattern B (function): module.exports = (Handlebars) => { Handlebars.registerHelper(...) }
 *
 * This file uses Pattern A.
 */

module.exports = {

  /**
   * Render a dollar amount with Polly-friendly spoken formatting.
   * {{speakCurrency balance}} → "two hundred forty-seven dollars and fifty cents"
   * (Uses SSML say-as for Polly. Wrap template in <speak> tags to activate.)
   */
  speakCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    return `<say-as interpret-as="currency" language="en-US">$${num.toFixed(2)}</say-as>`;
  },

  /**
   * Speak a date naturally via SSML.
   * {{speakDate dueDate}} → SSML date pronunciation
   */
  speakDate(dateStr) {
    return `<say-as interpret-as="date" format="mdy">${dateStr}</say-as>`;
  },

  /**
   * Spell out an account/confirmation number digit by digit.
   * {{spellDigits accountNumber}} → "4 5 2 1"
   */
  spellDigits(str) {
    return `<say-as interpret-as="digits">${str}</say-as>`;
  },

  /**
   * Speak a phone number naturally.
   * {{speakPhone callbackNumber}} → spoken phone number
   */
  speakPhone(phone) {
    return `<say-as interpret-as="telephone">${phone}</say-as>`;
  },

  /**
   * Add a Polly pause of N milliseconds.
   * {{pause 500}} → <break time="500ms"/>
   */
  pause(ms) {
    return `<break time="${ms}ms"/>`;
  },

  /**
   * Conditional: render first block if truthy, else second.
   * {{#ifEq status "overdue"}}You owe money{{else}}You're all set{{/ifEq}}
   */
  ifEq(a, b, options) {
    return String(a) === String(b) ? options.fn(this) : options.inverse(this);
  },

  /**
   * Conditional: render block if value is truthy with string comparison.
   * {{#ifNe status "active"}}Your account is not active{{/ifNe}}
   */
  ifNe(a, b, options) {
    return String(a) !== String(b) ? options.fn(this) : options.inverse(this);
  },

  /**
   * Greater than comparison.
   * {{#ifGt missedPayments 0}}You have missed payments.{{/ifGt}}
   */
  ifGt(a, b, options) {
    return Number(a) > Number(b) ? options.fn(this) : options.inverse(this);
  },

  /**
   * Uppercase a string (useful for agent names, emphasis).
   */
  upper(str) {
    return String(str).toUpperCase();
  },

  /**
   * Lowercase a string.
   */
  lower(str) {
    return String(str).toLowerCase();
  },

  /**
   * Trim whitespace.
   */
  trim(str) {
    return String(str).trim();
  },

  /**
   * Format a number as spoken ordinal (1st, 2nd, 3rd...).
   * Useful for menu options: "Press {{ordinal 1}} for billing."
   */
  ordinal(n) {
    const num = parseInt(n, 10);
    const suffix = ['th','st','nd','rd'];
    const v = num % 100;
    return num + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
  },

  /**
   * Choose between two values based on a boolean.
   * {{pick isPremiumMember "valued member" "customer"}}
   */
  pick(condition, trueVal, falseVal) {
    return condition ? trueVal : falseVal;
  },

};
