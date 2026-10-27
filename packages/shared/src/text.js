/**
 * Text clean-up shared by the API (Sakha's saved answers) and the web app
 * (the same answer while it streams in).
 */

const ADDRESS = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;

// An Indian mobile number, with or without +91 and spacing: +91 63742 48957.
const PHONE = String.raw`(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}`;
const waLink = (number) => `[WhatsApp us](https://wa.me/91${number.replace(/\D/g, '').slice(-10)})`;

/**
 * Show phone numbers as a "WhatsApp us" link instead of as text. A number used
 * as a link's label is relabelled; a number inside a URL is left alone.
 */
export function linkPhones(text) {
  return String(text ?? '')
    .replace(new RegExp(String.raw`\[\s*${PHONE}\s*\]\((https?:[^)\s]+|tel:[^)\s]+)\)`, 'g'), (link) =>
      waLink(/\((?:https?:\/\/wa\.me\/|tel:)?([^)]*)\)/.exec(link)[1])
    )
    .replace(new RegExp(String.raw`(^|[^\w/=+\[])(${PHONE})(?!\d)`, 'g'), (_, before, number) => `${before}${waLink(number)}`);
}

/** Both: no email address or phone number left as plain text. */
export const linkContacts = (text) => linkPhones(linkEmails(text));

/**
 * Show email addresses as a link labelled "email" instead of as text.
 *
 * Both `name@example.com` and `[name@example.com](mailto:name@example.com)`
 * become `[email](mailto:name@example.com)`; a link that already has a word
 * label ("[email Gokul](mailto:…)") is left alone.
 */
export function linkEmails(text) {
  return String(text ?? '')
    .replace(new RegExp(String.raw`\[[^\]]*@[^\]]*\]\(mailto:(${ADDRESS})\)`, 'g'), '[email](mailto:$1)')
    .replace(new RegExp(String.raw`(^|[^\w.+\-:(\[/])(${ADDRESS})`, 'g'), '$1[email](mailto:$2)');
}
