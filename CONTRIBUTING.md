# Contributing to soundtrack.io

Looking to contribute something to soundtrack.io? **Here's how you can help.**

## Key branches

- `master` is the latest, deployed version.

## Pull requests

- Try not to pollute your pull request with unintended changes--keep them simple and small

## Coding standards

### HTML

- Two spaces for indentation, never tabs
- Double quotes only, never single quotes
- Always use proper indentation
- Use tags and elements appropriate for an HTML5 doctype (e.g., self-closing tags)

### CSS

- Adhere to the [Recess CSS property order](http://markdotto.com/2011/11/29/css-property-order/)
- Multiple-line approach (one property and value per line)
- Always a space after a property's colon (.e.g, `display: block;` and not `display:block;`)
- End all lines with a semi-colon
- For multiple, comma-separated selectors, place each selector on it's own line
- Attribute selectors, like `input[type="text"]` should always wrap the attribute's value in double quotes, for consistency and safety (see this [blog post on unquoted attribute values](http://mathiasbynens.be/notes/unquoted-attribute-values) that can lead to XSS attacks).

### JS

- _Always_ semicolons/
- Comma _first_ syntax when > 3 array elements.  See below about preferring legibility.
- 2 spaces (no tabs)
- Legible code above all
  - Use spaces between operators where it improves legibility.
  - Use linebreaks where code is separated into logical components.
- Be respectful of other devs' sanity:
  - Use comments to describe non-intuitive code.
  - If you leave a log event behind, make it _meaningful_.  No "wat lol" log events.
