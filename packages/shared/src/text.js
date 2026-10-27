/**
 * Text clean-up shared by the API (Sakha's saved answers) and the web app
 * (the same answer while it streams in).
 */

const ADDRESS = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;

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
