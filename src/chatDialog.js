(function(){
  'use strict';
  // Backward-compatible loader that keeps the same single-script usage.
  // It injects the split CSS and loads the new runtime from ./chat/index.js

  function getCurrentScriptDir() {
    // Robust way to find the directory URL of this script
    var script = document.currentScript;
    if (!script) {
      var scripts = document.getElementsByTagName('script');
      script = scripts[scripts.length - 1];
    }
    var src = (script && script.src) ? script.src : '';
    // Remove query/hash and the filename
    src = src.split('#')[0].split('?')[0];
    return src.replace(/[^\/\\]*$/, '');
  }

  function injectCss(href) {
    // Avoid duplicate insertion if already present
    var links = document.querySelectorAll('link[rel="stylesheet"][href]');
    for (var i=0; i<links.length; i++) {
      if (links[i].href === href) return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    s.onload = onload || null;
    s.onerror = function(err){ console.error('Failed to load script:', src, err); };
    document.head.appendChild(s);
  }

  var baseDir = getCurrentScriptDir();
  var cssUrl = baseDir + 'chat/chatWidget.css';
  var jsUrl  = baseDir + 'chat/index.js';

  injectCss(cssUrl);
  loadScript(jsUrl);
})();