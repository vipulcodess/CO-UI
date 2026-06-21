// CO-UI Extension Logic

document.addEventListener('DOMContentLoaded', () => {
  const btnInspect = document.getElementById('btn-inspect');
  const btnGenerate = document.getElementById('btn-generate');
  const btnCopy = document.getElementById('btn-copy');
  const inputSelector = document.getElementById('input-selector');
  const inputQuery = document.getElementById('input-query');
  const previewSection = document.getElementById('preview-section');
  const outputText = document.getElementById('output-text');

  let isInspectMode = false;

  // Toggle Inspect Mode
  btnInspect.addEventListener('click', async () => {
    isInspectMode = !isInspectMode;
    if (isInspectMode) {
      btnInspect.classList.add('active');
      btnInspect.querySelector('span').textContent = 'Cancel';
      
      // Inject the element selector script on the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        resetInspectMode();
        return;
      }
      
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: startInspector
      });
    } else {
      resetInspectMode();
      // Remove inspector from tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: stopInspector
        });
      }
    }
  });

  function resetInspectMode() {
    isInspectMode = false;
    btnInspect.classList.remove('active');
    btnInspect.querySelector('span').textContent = 'Inspect Page';
  }

  // Listen for elements picked from page
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'elementSelected') {
      const data = message.data;
      
      // Generate a nice descriptive selector description
      let selectorStr = '';
      if (data.id) {
        selectorStr += `#${data.id}`;
      } else if (data.classes) {
        selectorStr += `${data.tagName.toLowerCase()}.${data.classes.split(' ').join('.')}`;
      } else {
        selectorStr += data.tagName.toLowerCase();
      }
      
      // Add custom selector path if helper is detailed
      if (data.path) {
        selectorStr = data.path;
      }

      if (data.innerText) {
        selectorStr += ` (containing text: "${data.innerText}")`;
      }

      inputSelector.value = selectorStr;
      resetInspectMode();
      inputSelector.focus();
    }
  });

  // Generate Prompt
  btnGenerate.addEventListener('click', () => {
    const selector = inputSelector.value.trim();
    const query = inputQuery.value.trim();

    if (!query) {
      alert('Please enter a change query first!');
      inputQuery.focus();
      return;
    }

    const compiledPrompt = compilePrompt(selector, query);
    outputText.textContent = compiledPrompt;
    previewSection.classList.remove('hidden');
    
    // Smooth scroll down to output
    setTimeout(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
    }, 50);
  });

  // Copy Prompt to Clipboard
  btnCopy.addEventListener('click', () => {
    const textToCopy = outputText.textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
      btnCopy.classList.add('copied');
      btnCopy.querySelector('span').textContent = 'Copied!';
      
      setTimeout(() => {
        btnCopy.classList.remove('copied');
        btnCopy.querySelector('span').textContent = 'Copy';
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // Prompt Compiler
  function compilePrompt(selector, query) {
    let selectorBlock = '';
    if (selector) {
      selectorBlock = `\n- TARGET SELECTOR DETAILS: ${selector}`;
    }

    return `[AGENTIC UI/UX DIRECTIVE]
Apply the following design changes to the workspace code:${selectorBlock}
- DESIRED VISUAL CHANGE: ${query}

Locate the corresponding source file/component in the workspace and generate a precise patch resolving this directive.`;
  }
});

// The following functions run in the context of the user's active page tab.
function startInspector() {
  // Prevent duplicate execution
  if (window.couiInspectorActive) return;
  window.couiInspectorActive = true;

  // Insert style block for highlighting
  const style = document.createElement('style');
  style.id = 'coui-inspector-style';
  style.innerHTML = `
    .coui-highlighted {
      outline: 2px dashed #06b6d4 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);

  let hoveredEl = null;

  function onMouseOver(e) {
    if (hoveredEl) hoveredEl.classList.remove('coui-highlighted');
    hoveredEl = e.target;
    if (hoveredEl) hoveredEl.classList.add('coui-highlighted');
  }

  function onMouseOut(e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('coui-highlighted');
      hoveredEl = null;
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    
    // Generate CSS selector path
    const getCssPath = (element) => {
      if (!(element instanceof Element)) return '';
      const path = [];
      while (element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.nodeName.toLowerCase();
        if (element.id) {
          selector += '#' + element.id;
          path.unshift(selector);
          break;
        } else {
          let sib = element, sibCount = 1;
          while (sib = sib.previousElementSibling) {
            if (sib.nodeName.toLowerCase() == element.nodeName.toLowerCase()) {
              sibCount++;
            }
          }
          if (sibCount > 1) {
            selector += `:nth-of-type(${sibCount})`;
          }
        }
        path.unshift(selector);
        element = element.parentNode;
      }
      return path.join(' > ');
    };

    const elementData = {
      tagName: el.tagName,
      id: el.id || '',
      classes: el.className && typeof el.className === 'string' ? el.className.trim() : '',
      innerText: el.innerText ? el.innerText.trim().slice(0, 40) : '',
      path: getCssPath(el)
    };

    chrome.runtime.sendMessage({
      action: 'elementSelected',
      data: elementData
    });

    cleanup();
  }

  function cleanup() {
    window.couiInspectorActive = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    
    const styleEl = document.getElementById('coui-inspector-style');
    if (styleEl) styleEl.remove();

    if (hoveredEl) {
      hoveredEl.classList.remove('coui-highlighted');
    }
  }

  // Register listeners
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);

  // Store cleanup function globally to call from stopInspector
  window.couiCleanup = cleanup;
}

function stopInspector() {
  if (window.couiCleanup) {
    window.couiCleanup();
  }
}
