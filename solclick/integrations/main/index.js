import { validateSolanaAddress } from './validator.js';
import './style.css';

const CA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

function createBuyButton(ca) {
  const button = document.createElement('button');
  button.innerText = 'Buy';
  button.className =
    'ml-2 px-2 py-0.5 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 transition-all';
  button.setAttribute('data-ca', ca);
  return button;
}

function injectButtons() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = node.nodeValue.match(CA_REGEX);
    if (!matches) continue;

    const parent = document.createElement('span');
    const segments = node.nodeValue.split(CA_REGEX);

    segments.forEach((segment, i) => {
      parent.appendChild(document.createTextNode(segment));

      if (i < matches.length) {
        const ca = matches[i];
        const result = validateSolanaAddress(ca);
        if (result.isValid) {
          const caSpan = document.createElement('span');
          caSpan.textContent = ca;
          caSpan.className = 'font-mono font-semibold text-gray-900';
          parent.appendChild(caSpan);
          parent.appendChild(createBuyButton(ca));
        } else {
          parent.appendChild(document.createTextNode(ca));
        }
      }
    });

    node.parentNode.replaceChild(parent, node);
  }
}

injectButtons();
