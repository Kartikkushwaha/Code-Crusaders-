// DOM helpers for the contentEditable editor: map plain-text sentences back to
// live text nodes so suggestions can be applied (and claims located) in place.

function buildIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const map = []; // map[i] = { node, offset } for each char of `text`
  let text = "";
  let lastWasSpace = true;
  let node;
  while ((node = walker.nextNode())) {
    const v = node.nodeValue;
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      const isSpace = /\s/.test(ch) || ch === " ";
      if (isSpace) {
        if (lastWasSpace) continue;
        text += " ";
        map.push({ node, offset: i });
        lastWasSpace = true;
      } else {
        text += ch;
        map.push({ node, offset: i });
        lastWasSpace = false;
      }
    }
    // Block boundaries: separate adjacent blocks with a space so words don't merge.
    const parentBlock = node.parentElement?.closest("p,li,h1,h2,h3,div,blockquote");
    const next = walker.nextNode();
    if (next) {
      const nextBlock = next.parentElement?.closest("p,li,h1,h2,h3,div,blockquote");
      if (nextBlock !== parentBlock && !lastWasSpace) {
        text += " ";
        map.push({ node, offset: v.length });
        lastWasSpace = true;
      }
      walker.previousNode();
    }
  }
  return { text, map };
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

function rangeFor(root, sentence, fragment) {
  const { text, map } = buildIndex(root);
  const sent = norm(sentence);
  const frag = norm(fragment);
  let start = -1;
  const sIdx = sent ? text.indexOf(sent) : -1;
  if (sIdx >= 0) {
    const inner = text.slice(sIdx, sIdx + sent.length).indexOf(frag);
    if (inner >= 0) start = sIdx + inner;
  }
  if (start < 0) start = text.indexOf(frag); // fallback: sentence already edited
  if (start < 0 || !frag) return null;
  const end = start + frag.length; // exclusive
  const a = map[start];
  const b = map[end - 1];
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset + 1);
  return range;
}

/** Replace `fragment` (inside `sentence`) with `replacement`. Returns true if applied. */
export function replaceInEditor(root, sentence, fragment, replacement) {
  if (!root) return false;
  const trailingSpace = fragment.endsWith(" ");
  const range = rangeFor(root, sentence, trailingSpace ? fragment.trimEnd() : fragment);
  if (!range) return false;
  if (trailingSpace) {
    // swallow the following space too
    const n = range.endContainer;
    if (n.nodeType === 3 && n.nodeValue[range.endOffset] === " ") range.setEnd(n, range.endOffset + 1);
  }
  range.deleteContents();
  if (replacement) range.insertNode(document.createTextNode(replacement));
  root.normalize();
  return true;
}

/** Select and scroll to a fragment so the user can see the flagged claim. */
export function locateInEditor(root, sentence, fragment) {
  if (!root) return false;
  const range = rangeFor(root, sentence, fragment || sentence) || rangeFor(root, "", sentence);
  if (!range) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const el = range.startContainer.parentElement;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.classList.add("flash-locate");
  setTimeout(() => el?.classList.remove("flash-locate"), 1400);
  return true;
}

/** Plain text with one line per block, used by the audit engine. */
export function editorPlainText(root) {
  if (!root) return "";
  const blocks = root.querySelectorAll("h1,h2,h3,p,li,blockquote,div");
  if (!blocks.length) return root.innerText || root.textContent || "";
  const lines = [];
  const leafBlocks = [...blocks].filter((b) => !b.querySelector("h1,h2,h3,p,li,blockquote,div"));
  leafBlocks.forEach((b) => lines.push((b.textContent || "").replace(/\s+/g, " ").trim()));
  // Loose text directly inside the root (e.g. typed before any block exists)
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3 && n.nodeValue.trim()) lines.push(n.nodeValue.trim());
  });
  return lines.filter(Boolean).join("\n");
}

/** Escape text for safe insertion as HTML. */
export const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Sanitize pasted/loaded HTML down to the formatting the editor supports.
 * Keeps: h1-h3, p, ul, ol, li, b/strong, i/em, u, br, and text-align styles.
 */
export function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const allowed = new Set(["H1", "H2", "H3", "P", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "BR", "DIV", "SPAN"]);
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) {
          if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "IMG", "SVG"].includes(child.tagName)) {
            child.remove();
            return;
          }
          walk(child);
          child.replaceWith(...child.childNodes);
          return;
        }
        const align = child.style?.textAlign;
        [...child.attributes].forEach((a) => child.removeAttribute(a.name));
        if (align) child.style.textAlign = align;
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
