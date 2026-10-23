/**
 * Element names HTML knows, current and obsolete, lowercase. Markdown passes these on as HTML
 * (sanitized); any other tag, like the `<example>` of a prompt, is shown as written.
 */
const HTML_TAGS = new Set(
  `a abbr acronym address area article aside audio b base basefont bdi bdo big blink blockquote
  body br button canvas caption center cite code col colgroup data datalist dd del details dfn
  dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2
  h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map
  mark marquee menu meta meter nav nobr noembed noframes noscript object ol optgroup option output
  p param picture plaintext pre progress q rb rp rt rtc ruby s samp script search section select
  slot small source span strike strong style sub summary sup svg math table tbody td template
  textarea tfoot th thead time title tr track tt u ul var video wbr xmp`.split(/\s+/),
);

export function isHtmlTag(name: string): boolean {
  return HTML_TAGS.has(name.toLowerCase());
}
