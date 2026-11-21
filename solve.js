// Fast drop-in for csv-reader 1.0.0: returns exactly its answer for every
// input {text, header} -> {columns, rows, errors}, but reads the text with
// indexOf-driven segment scanning and one slice per field segment instead of
// the reference's character-at-a-time concatenation. A record with no quote
// and no CR but its line ending takes a plainer path still: one slice of
// the whole line, split on commas in native code.
//
// The reading policy is csv-reader's own, matched case for case:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is
//     no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; junk after the closing quote is appended as it
//     stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character and the rest is re-read unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is literal; fields are never
//     trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     padded (short_row, with fields) or cut (long_row, with extra) to the
//     first record's width;
//   - errors are {code, line, row} in the order met, line the record's
//     starting line (counting every LF, CRLF and lone CR inside quotes),
//     row its index in rows, null for the header.

// Field endings, as small integers so a parsed field is a cheap object.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  let text = input.text;
  if (typeof text !== 'string') text = String(text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The first CR at or after pos, or -1. Kept monotonic as pos advances
  // (the one reset, an unterminated quote, recomputes it), so checking a
  // field for a CR never rescans text a previous field already passed.
  // The first quote at or after pos is kept the same way, for the plain
  // record path below.
  let nextCR = text.indexOf('\r', pos);
  let nextQuote = text.indexOf('"', pos);

  // The record being read: where its errors are addressed.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters from pos up to the next comma or line
  // break, on top of `prefix` ('' normally, '"' after an unterminated
  // quote, or a quoted value before its junk). Stray CRs are dropped,
  // each with its error, in order. Returns {value, ended, added}, where
  // added counts the characters kept from the text itself (not prefix).
  function readUnquoted(prefix) {
    let added = 0;
    let parts = null; // segment list, only built once a stray CR splits
    let seg = pos;
    for (;;) {
      const iComma = text.indexOf(',', seg);
      const iNl = text.indexOf('\n', seg);
      let end = n;
      let delim = END;
      if (iComma !== -1) { end = iComma; delim = COMMA; }
      if (iNl !== -1 && iNl < end) { end = iNl; delim = LINE_BREAK; }
      if (nextCR !== -1 && nextCR < seg) nextCR = text.indexOf('\r', seg);
      if (nextCR !== -1 && nextCR < end) {
        if (delim === LINE_BREAK && nextCR === end - 1) {
          // CRLF: the record's line break, the CR is not part of the field.
          const s = text.slice(seg, nextCR);
          added += s.length;
          const value = parts ? (parts.push(s), parts.join('')) : prefix + s;
          pos = end + 1;
          line += 1;
          nextCR = text.indexOf('\r', pos);
          return { value, ended: LINE_BREAK, added };
        }
        // A CR not followed by LF: dropped, with its error, in place.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = prefix ? [prefix] : [];
        const s = text.slice(seg, nextCR);
        if (s) parts.push(s);
        added += s.length;
        pos = nextCR + 1;
        nextCR = text.indexOf('\r', pos);
        seg = pos;
        continue;
      }
      const s = text.slice(seg, end);
      added += s.length;
      const value = parts ? (s && parts.push(s), parts.join('')) : prefix + s;
      if (delim === COMMA) {
        pos = end + 1;
      } else if (delim === LINE_BREAK) {
        pos = end + 1;
        line += 1;
        if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
      } else {
        pos = n;
      }
      return { value, ended: delim, added };
    }
  }

  // What follows a quoted field's closing quote: a comma, a line break,
  // the end of the text, or junk appended as it stands.
  function afterClose(value) {
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return { value, ended: COMMA }; }
    if (c === 10) { pos += 1; line += 1; return { value, ended: LINE_BREAK }; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      nextCR = text.indexOf('\r', pos);
      return { value, ended: LINE_BREAK };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote first: a quote followed by another quote is
    // a doubled quote inside the field, never the closing one.
    let q = text.indexOf('"', open + 1);
    let doubled = false;
    while (q !== -1 && q + 1 < n && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted, on the line the field began.
      pos = open + 1;
      line = openLine;
      nextCR = text.indexOf('\r', pos);
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const closing = q;
    const hasCR = nextCR !== -1 && nextCR < closing;
    let hasNL = false;
    if (doubled || hasCR) {
      // Slow content below decides newlines segment by segment anyway.
      hasNL = true;
    } else {
      const iNl = text.indexOf('\n', open + 1);
      hasNL = iNl !== -1 && iNl < closing;
    }
    if (!doubled && !hasCR && !hasNL) {
      const value = text.slice(open + 1, closing);
      pos = closing + 1;
      return afterClose(value);
    }
    // Content with doubled quotes and/or line breaks: walk its special
    // characters, slicing the plain runs between them. CRLF and a lone
    // CR each become one LF and count one line, as does each LF.
    const parts = [];
    let seg = open + 1;
    let cur = seg;
    while (cur < closing) {
      let iQ = text.indexOf('"', cur);
      if (iQ >= closing) iQ = -1;
      if (nextCR !== -1 && nextCR < cur) nextCR = text.indexOf('\r', cur);
      const iR = nextCR !== -1 && nextCR < closing ? nextCR : -1;
      let iL = text.indexOf('\n', cur);
      if (iL >= closing) iL = -1;
      let idx = closing;
      let kind = 0;
      if (iQ !== -1 && iQ < idx) { idx = iQ; kind = 34; }
      if (iR !== -1 && iR < idx) { idx = iR; kind = 13; }
      if (iL !== -1 && iL < idx) { idx = iL; kind = 10; }
      if (kind === 0) break;
      if (kind === 34) {
        parts.push(text.slice(seg, idx), '"');
        cur = idx + 2;
        seg = cur;
      } else if (kind === 13) {
        parts.push(text.slice(seg, idx), '\n');
        line += 1;
        cur = idx + 1 < n && text.charCodeAt(idx + 1) === 10 ? idx + 2 : idx + 1;
        seg = cur;
        nextCR = text.indexOf('\r', cur);
      } else {
        parts.push(text.slice(seg, idx + 1));
        line += 1;
        cur = idx + 1;
        seg = cur;
      }
    }
    if (seg < closing) parts.push(text.slice(seg, closing));
    const value = parts.join('');
    pos = closing + 1;
    if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
    return afterClose(value);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        nextCR = text.indexOf('\r', pos);
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
    if (nextQuote !== -1 && nextQuote < pos) nextQuote = text.indexOf('"', pos);

    // Plain record path: the line up to its break holds no quote, and no
    // CR but a CRLF's at its very end. Such a record can hold no error:
    // its fields are the line split on commas, exactly as the unquoted
    // reader would read them one by one.
    let fields = null;
    {
      const iNl = text.indexOf('\n', pos);
      const contentEnd = iNl === -1 ? n : iNl;
      const noQuote = nextQuote === -1 || nextQuote >= contentEnd;
      let sliceEnd = -1;
      if (noQuote) {
        if (nextCR === -1 || nextCR > contentEnd) sliceEnd = contentEnd;
        else if (iNl !== -1 && nextCR === contentEnd - 1) sliceEnd = contentEnd - 1;
      }
      if (sliceEnd !== -1) {
        const lineText = text.slice(pos, sliceEnd);
        pos = iNl === -1 ? n : iNl + 1;
        if (iNl !== -1) line += 1;
        if (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', pos);
        if (lineText === '') continue; // a CRLF line, already skipped above
        fields = lineText.split(',');
      }
    }

    let quoted = false;
    if (fields === null) {
      fields = [];
      let field;
      do {
        quoted = pos < n && text.charCodeAt(pos) === 34;
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);

      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
