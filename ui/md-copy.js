// A list's numbers and bullets are ::marker boxes, which no browser puts in
// the plain text of a copy, so a copied numbered list pastes as bare lines.
// This rewrites text/plain with each item's marker restored. Taking over the
// copy also drops the browser's text/html, so the selected markup goes with
// it, its numbered lists starting at the number they showed.

var ORC_COPY_INDENT = '\u0001';

function orcItemNumber(li) {
  var list = li.parentElement;
  if (!list || list.tagName !== 'OL') return null;
  var number = list.hasAttribute('start') ? list.start : 1;
  for (var sibling = li.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === 'LI') number++;
  }
  return number;
}

function orcListDepth(li) {
  var depth = 0;
  for (var node = li.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'LI') depth++;
  }
  return depth;
}

function orcRangeRoot(range) {
  var root = range.commonAncestorContainer;
  return root.nodeType === 1 ? root : root.parentElement;
}

// The items a range clones, in the order cloneContents emits them. An item
// that wraps the whole selection is left out, because the clone omits it.
function orcSelectedItems(root, range) {
  return Array.prototype.filter.call(root.querySelectorAll('li'), function (li) {
    return range.intersectsNode(li);
  });
}

function orcCopyContent(selection) {
  var text = document.createElement('div');
  var html = document.createElement('div');
  for (var i = 0; i < selection.rangeCount; i++) {
    var range = selection.getRangeAt(i);
    var root = orcRangeRoot(range);
    var items = orcSelectedItems(root, range);
    var textFragment = range.cloneContents();
    var htmlFragment = range.cloneContents();
    // A selection across sibling items clones them without their list.
    if (root.tagName === 'OL' || root.tagName === 'UL') {
      var list = root.cloneNode(false);
      list.appendChild(htmlFragment);
      htmlFragment = list;
    }
    var textItems = textFragment.querySelectorAll('li');
    var htmlItems = htmlFragment.querySelectorAll('li');
    if (!items.length || textItems.length !== items.length) return null;
    var base = orcListDepth(items[0]);
    items.forEach(function (li, index) {
      var number = orcItemNumber(li);
      var depth = Math.max(0, orcListDepth(li) - base);
      var prefix = new Array(depth + 1).join(ORC_COPY_INDENT) + (number === null ? '- ' : number + '. ');
      textItems[index].insertBefore(document.createTextNode(prefix), textItems[index].firstChild);
      var parent = htmlItems[index].parentElement;
      if (number !== null && parent && parent.tagName === 'OL' && parent.querySelector('li') === htmlItems[index]) {
        parent.start = number;
      }
    });
    text.appendChild(textFragment);
    html.appendChild(htmlFragment);
  }
  // innerText needs a rendered element to place the line breaks between
  // blocks, so the copy is laid out off-screen for the moment it is read.
  text.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;';
  document.body.appendChild(text);
  var plain = text.innerText;
  text.remove();
  return { text: plain.split(ORC_COPY_INDENT).join('  '), html: html.innerHTML };
}

document.addEventListener('copy', function (event) {
  var selection = document.getSelection();
  if (!event.clipboardData || !selection || selection.isCollapsed) return;
  var content = orcCopyContent(selection);
  if (!content) return;
  event.clipboardData.setData('text/plain', content.text);
  event.clipboardData.setData('text/html', content.html);
  event.preventDefault();
});
