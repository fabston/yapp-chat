/*
 * The message box: a text box that shows the emotes you've typed as their pictures (an <input> can only hold text).
 * It's an editable element with an <input>'s interface for what the chat uses of one (value, selectionStart and
 * selectionEnd, setSelectionRange, setRangeText, placeholder, maxLength, disabled), so lib/chat.js works on it as on
 * an input. Its text is what's in it, a picture counting as its emote's name; an emote's name becomes its picture once
 * it's whole and you've typed on (a space after it), or the box is left.
 */

import { el } from './ui.js';

const isText = (node) => node.nodeType === Node.TEXT_NODE;
/** How much of the text a node of the box holds: a text's letters, a picture's name. */
const lengthOf = (node) => (isText(node) ? node.data.length : node.alt?.length || 0);

/** A message box; `emotes()` gives the emotes that show as pictures now (Map name → { url }). */
export function emoteBox(emotes) {
  const box = el('div', 'input emote-box');
  box.contentEditable = 'plaintext-only';
  box.setAttribute('role', 'textbox');
  box.enterKeyHint = 'send';
  let max = Infinity;
  let kept = [0, 0]; // the selection, as places in the text: the live one while the box has it, remembered after

  /** What's in it, as text, on one line. */
  const read = () => [...box.childNodes].map((n) => (isText(n) ? n.data : n.alt || '')).join('').replace(/\s*\n\s*/g, ' ');

  /** How far into the text a place in the box is (a node and an offset in it, as a selection gives them). */
  const offsetOf = (node, at) => {
    let before = 0;
    for (const [i, child] of [...box.childNodes].entries()) {
      if (node === box && i === at) return before;
      if (child === node) return before + (isText(node) ? at : at ? lengthOf(child) : 0);
      before += lengthOf(child);
    }
    return before;
  };

  /** The place in the box that far into the text: [node, offset] (not inside a picture: before or after it). */
  const placeOf = (offset) => {
    let left = offset;
    for (const [i, child] of [...box.childNodes].entries()) {
      const length = lengthOf(child);
      if (isText(child) && left <= length) return [child, left];
      if (!isText(child) && left < length) return [box, left ? i + 1 : i];
      left -= length;
    }
    return [box, box.childNodes.length];
  };

  const focused = () => document.activeElement === box;
  /** The selection in the box now, as places in the text, or what it was when it left. */
  const selection = () => {
    const s = getSelection();
    if (focused() && s.rangeCount && box.contains(s.anchorNode)) {
      const r = s.getRangeAt(0);
      kept = [offsetOf(r.startContainer, r.startOffset), offsetOf(r.endContainer, r.endOffset)];
    }
    return kept;
  };
  /** Put the selection there (shown once the box has the focus). */
  const select = (start, end = start) => {
    kept = [start, end];
    if (!focused()) return;
    const range = document.createRange();
    range.setStart(...placeOf(start));
    range.setEnd(...placeOf(end));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };

  /**
   * Show `text` with the selection at [start, end]: each word that's an emote's name as its picture, but the one
   * you're typing (the caret in it or at its end, the box having the focus; `whole`: none is, the text was put there
   * at once). The box is only made again when that changes what's in it, so typing plain text leaves it to the
   * browser (its undo, a keyboard composing a letter).
   */
  const draw = (text, [start, end] = kept, whole = false) => {
    const known = emotes();
    const parts = []; // text, or { name, url }
    let at = 0;
    for (const word of text.split(/(\s+)/)) {
      const typing = !whole && focused() && start === end && start > at && start <= at + word.length;
      const emote = word && !typing && known.get(word);
      if (emote) parts.push({ name: word, url: emote.url });
      else if (typeof parts.at(-1) === 'string') parts[parts.length - 1] += word;
      else if (word) parts.push(word);
      at += word.length;
    }
    const now = [...box.childNodes].filter((n) => isText(n) || n.alt).map((n) => (isText(n) ? n.data : { name: n.alt }));
    const same = now.length === parts.length && box.childNodes.length === now.length && parts.every((p, i) => (typeof p === 'string' ? p === now[i] : p.name === now[i].name));
    if (!same) {
      box.replaceChildren(
        ...parts.map((part) => {
          if (typeof part === 'string') return document.createTextNode(part);
          const img = el('img', 'box-emote');
          img.src = part.url;
          img.alt = part.name;
          img.draggable = false;
          return img;
        }),
      );
    }
    select(start, end);
  };

  let composing = false; // a keyboard putting a letter together: the box is left alone until it's done
  box.addEventListener('compositionstart', () => (composing = true));
  box.addEventListener('compositionend', () => {
    composing = false;
    draw(read().slice(0, max), selection());
  });
  // Before the chat's own listeners (it's the first): what was typed, shown as it should be.
  box.addEventListener('input', () => !composing && draw(read().slice(0, max), selection()));
  box.addEventListener('focus', () => select(...kept));
  // Left: the last word too, if it's an emote.
  box.addEventListener('blur', () => draw(read()));
  document.addEventListener('selectionchange', function remember() {
    if (!box.isConnected) return document.removeEventListener('selectionchange', remember);
    selection();
  });
  // Enter sends (as in an input in a form): the keyboard's "new line", which a list of suggestions takes first.
  box.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertParagraph' && e.inputType !== 'insertLineBreak') return;
    e.preventDefault();
    box.closest('form')?.requestSubmit();
  });
  // Pasted: its text on one line, where the selection is (the browser's own way with line breaks varies).
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const [start, end] = selection();
    box.setRangeText((e.clipboardData?.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '), start, end);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Copied or cut: the text, emotes by their names.
  for (const type of ['copy', 'cut']) {
    box.addEventListener(type, (e) => {
      const [start, end] = selection();
      if (start === end) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', read().slice(start, end));
      if (type === 'cut') {
        box.setRangeText('', start, end);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  Object.defineProperties(box, {
    value: {
      get: read,
      set(text) {
        const now = String(text ?? '');
        draw(now, [now.length, now.length], true); // the caret at its end, as an input's
      },
    },
    selectionStart: { get: () => selection()[0] },
    selectionEnd: { get: () => selection()[1] },
    placeholder: {
      get: () => box.dataset.placeholder || '',
      set: (text) => (box.dataset.placeholder = text),
    },
    maxLength: {
      get: () => max,
      set: (n) => (max = n),
    },
    disabled: {
      get: () => box.contentEditable === 'false',
      set: (off) => (box.contentEditable = off ? 'false' : 'plaintext-only'),
    },
  });
  box.setSelectionRange = select;
  /** As an input's: `text` in place of [start, end), the caret after it. */
  box.setRangeText = (text, start, end) => {
    const value = read();
    draw(value.slice(0, start) + text + value.slice(end), [start + text.length, start + text.length]);
  };
  return box;
}
