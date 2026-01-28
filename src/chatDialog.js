(function () {
    'use strict';

    async function loadFromGithub(filePath) {
        const baseUrl = 'https://raw.githubusercontent.com/HledamBohaCzAi/Informace/main/';
        const url = baseUrl + encodeURI(filePath);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    }

    const PRIMARY_COLOR = '#deb75b';
    const GREETING = "Dobrý den.\nJsem virtuální asistent hledamboha.cz\nJak vám mohu pomoci?";
    const FILES = [
        {name: "instrukce.md", path: "instrukce.md"},
        {name: "oHledamBoha.md", path: "oHledamBoha.md"},
        {name: "průvodce.md", path: "průvodce.md"},
        {name: "bible.md", path: "bible.md"},
        {name: "kurzy.md", path: "kurzy.md"},
        {name: "články.md", path: "články.md"},
        {name: "videa.md", path: "videa.md"},
        {name: "OMG.md", path: "OMG.md"},
    ]

    const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
    const MODEL = "gpt-4o-mini"//"ft:gpt-4o-mini-2024-07-18:hledamboha:hb-01:CWNAgswG"

    // EmailJS configuration and correlation ID
    const EMAIL_TO = "ai@hledamboha.cz";
    const EMAILJS_PUBLIC_KEY = "3MIudXQ4vR1n9uGIw";
    const EMAILJS_SERVICE_ID = "service_flsh7wj";
    const EMAILJS_TEMPLATE_ID = "template_fk2dlen";

    const SESSION_HISTORY_KEY = 'chat_history_session';
    const LOCAL_HISTORY_KEY = 'chat_history_local';

    function generateCorrelationId() {
        // Simple RFC4122-ish v4 generator
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >> 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    let correlationId = generateCorrelationId();

    // Initialize EmailJS if available
    try {
        if (window.emailjs && typeof window.emailjs.init === 'function' && EMAILJS_PUBLIC_KEY && EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY') {
            window.emailjs.init(EMAILJS_PUBLIC_KEY);
            console.log('EmailJS initialized');
        }
    } catch (e) {
        console.warn('EmailJS init failed or not configured:', e);
    }

    let isOpen = false;
    let isLoading = false;
    let isSystemReady = false;

    let systemPrompt = ""; // will be downloaded and concatenated from GitHub files
    let messages = [
        {role: 'system', content: systemPrompt},
        {role: 'assistant', content: GREETING}
    ];

    // Retry wrapper with exponential backoff for GitHub loads
    async function loadFromGithubWithRetry(filePath, maxRetries = 3, initialDelayMs = 500) {
        let attempt = 0;
        let delay = initialDelayMs;
        // We allow maxRetries additional tries after the initial one
        while (true) {
            try {
                return await loadFromGithub(filePath);
            } catch (err) {
                if (attempt >= maxRetries) {
                    throw err;
                }
                console.warn(`Retrying loadFromGithub for ${filePath} (attempt ${attempt + 1} of ${maxRetries})`, err);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 8000);
                attempt++;
            }
        }
    }

    async function buildSystemPromptFromGithub() {
        console.log("initialized api")
        const parts = [];
        let allSucceeded = true;
        for (const file of FILES) {
            try {
                const text = await loadFromGithubWithRetry(file.path);
                parts.push(text);
            } catch (err) {
                allSucceeded = false;
                console.error('Failed to load from GitHub after retries:', file, err);
            }
        }
        return {prompt: parts.join('\n'), allSucceeded};
    }

    // Kick off background loading of system prompt right away
    (async function initSystemPrompt() {
        try {
            const {prompt, allSucceeded} = await buildSystemPromptFromGithub();
            systemPrompt = prompt;
            // ensure the first message is the system message
            if (messages.length === 0 || messages[0].role !== 'system') {
                messages.unshift({role: 'system', content: systemPrompt});
            } else {
                messages[0].content = systemPrompt;
            }
            // Only mark ready if all files loaded successfully
            isSystemReady = !!allSucceeded;
            // Notify the widget (if mounted) to re-render
            document.dispatchEvent(new CustomEvent('chatWidget:systemReady'));
        } catch (e) {
            console.error('Unexpected error while building system prompt:', e);
        }
    })();

    // Create styles
    const style = document.createElement('style');
    style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&display=swap');
    
    .chat-widget-container * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Size variations */
    .chat-widget-window.chat-size-small {
      width: 400px;
      height: 600px;
    }
    .chat-widget-window.chat-size-medium {
      width: 600px;
      height: 700px;
    }
    .chat-widget-window.chat-size-large {
      width: 800px;
      height: 800px;
    }

    /* Chat button - improved with pulse animation */
    .chat-widget-button {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #c9a041 100%);
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(222, 183, 91, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 4px 20px rgba(222, 183, 91, 0.4);
      }
      50% {
        box-shadow: 0 4px 30px rgba(222, 183, 91, 0.6);
      }
    }

    .chat-widget-button:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 30px rgba(222, 183, 91, 0.5);
      animation: none;
    }

    .chat-widget-button:active {
      transform: scale(0.95);
    }

    .chat-widget-button svg {
      width: 32px;
      height: 32px;
      fill: white;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));
    }

    /* Main chat window */
    .chat-widget-window {
      position: fixed;
      bottom: 7rem;
      right: 2rem;
      width: 400px;
      height: 600px;
      max-width: calc(100vw - 4rem);
      max-height: calc(100vh - 9rem);
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
      display: none;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
    }

    .chat-widget-window.open {
      display: flex;
      animation: slideUpFade 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes slideUpFade {
      from {
        opacity: 0;
        transform: translateY(30px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Header - improved with better spacing and controls */
    .chat-widget-header {
      background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #c9a041 100%);
      color: white;
      padding: 20px;
      font-family: 'Albert Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .chat-widget-header-icon {
      width: 36px;
      height: 36px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .chat-widget-header-icon svg {
      width: 20px;
      height: 20px;
      fill: white;
    }

    .chat-widget-header-text {
      display: flex;
      flex-direction: column;
    }

    .chat-widget-header-title {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.2;
    }

    .chat-widget-header-subtitle {
      font-size: 12px;
      opacity: 0.9;
      margin-top: 2px;
    }

    .chat-widget-header-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1
    }

    /* Size controls - refined */
    .chat-widget-size-controls {
      display: flex;
      gap: 6px;
      border-radius: 6px;
      margin-right: auto
    }

    .chat-size-btn {
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: white;
      font-size: 19px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      padding: 4px 10px;
      transition: all 0.2s ease;
      font-family: 'Albert Sans', sans-serif;
    }

    .chat-size-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .chat-size-btn:active {
      transform: scale(0.95);
    }

    /* New conversation button - improved */
    .chat-new-btn {
      background: rgba(255, 255, 255, 0.95);
      color: #333;
      border: none;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      padding: 6px 12px;
      transition: all 0.2s ease;
      font-family: 'Albert Sans', sans-serif;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .chat-new-btn:hover {
      background: white;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .chat-new-btn:active {
      transform: translateY(0);
    }

    /* Close button - refined */
    .chat-widget-close {
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: white;
      cursor: pointer;
      font-size: 24px;
      line-height: 1;
      padding: 6px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .chat-widget-close:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: rotate(90deg);
    }

    .chat-widget-close:active {
      transform: rotate(90deg) scale(0.9);
    }

    /* Messages container - improved spacing */
    .chat-widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px;
      background: linear-gradient(to bottom, #fafafa 0%, #f5f5f5 100%);
      font-family: 'Albert Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Custom scrollbar */
    .chat-widget-messages::-webkit-scrollbar {
      width: 6px;
    }

    .chat-widget-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .chat-widget-messages::-webkit-scrollbar-thumb {
      background: #ddd;
      border-radius: 3px;
    }

    .chat-widget-messages::-webkit-scrollbar-thumb:hover {
      background: #ccc;
    }

    /* Message bubbles - improved design */
    .chat-message {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      animation: messageSlideIn 0.3s ease-out;
    }

    @keyframes messageSlideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .chat-message.system {
      display: none;
    }

    .chat-message.user {
      align-items: flex-end;
    }

    .chat-message.assistant {
      align-items: flex-start;
    }

    .chat-message-content {
      padding: 14px 18px;
      border-radius: 16px;
      max-width: 85%;
      word-wrap: break-word;
      white-space: pre-wrap;
      font-size: 14.5px;
      line-height: 1.6;
      position: relative;
    }

    .chat-message.user .chat-message-content {
      background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #c9a041 100%);
      color: white;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 8px rgba(222, 183, 91, 0.25);
    }

    .chat-message.assistant .chat-message-content {
      background: white;
      color: #2d2d2d;
      border-bottom-left-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border: 1px solid rgba(0, 0, 0, 0.04);
    }

    /* Markdown content styling */
    .chat-message-content p {
      margin: 0.5em 0;
    }

    .chat-message-content p:first-child {
      margin-top: 0;
    }

    .chat-message-content p:last-child {
      margin-bottom: 0;
    }

    .chat-message-content strong {
      font-weight: 600;
      color: inherit;
    }

    .chat-message-content em {
      font-style: italic;
    }

    .chat-message-content a {
      color: ${PRIMARY_COLOR};
      text-decoration: underline;
      transition: opacity 0.2s;
    }

    .chat-message-content a:hover {
      opacity: 0.8;
    }

    .chat-message.user .chat-message-content a {
      color: white;
      text-decoration: underline;
    }

    .chat-message-content ul,
    .chat-message-content ol {
      margin: 0.75em 0;
      padding-left: 1.25rem;
      list-style-position: outside;
    }

    .chat-message-content li {
      margin: 0.4em 0;
    }

    .chat-message-content ul ul,
    .chat-message-content ol ol,
    .chat-message-content ul ol,
    .chat-message-content ol ul {
      margin: 0.4em 0;
      padding-left: 1.25rem;
    }

    .chat-message-content code {
      background: rgba(0, 0, 0, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }

    .chat-message.user .chat-message-content code {
      background: rgba(255, 255, 255, 0.2);
    }

    .chat-message-content pre {
      background: rgba(0, 0, 0, 0.04);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0.75em 0;
    }

    .chat-message-content pre code {
      background: none;
      padding: 0;
    }

    /* Input container - improved */
    .chat-widget-input-container {
      padding: 16px 20px 20px;
      background: white;
      border-top: 1px solid #e8e8e8;
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }

    .chat-widget-input {
      flex: 1;
      padding: 12px 16px;
      border: 2px solid #e8e8e8;
      border-radius: 12px;
      font-family: 'Albert Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14.5px;
      outline: none;
      transition: all 0.2s ease;
      resize: none;
      min-height: 44px;
      max-height: 168px;
      overflow-y: auto;
      line-height: 1.5;
      background: #fafafa;
    }

    .chat-widget-input:focus {
      border-color: ${PRIMARY_COLOR};
      background: white;
      box-shadow: 0 0 0 3px rgba(222, 183, 91, 0.1);
    }

    .chat-widget-input::placeholder {
      color: #999;
    }

    .chat-widget-send {
      padding: 12px 24px;
      min-height: 44px;
      align-self: flex-end;
      background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #c9a041 100%);
      color: white;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14.5px;
      font-family: 'Albert Sans', sans-serif;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(222, 183, 91, 0.3);
      white-space: nowrap;
    }

    .chat-widget-send:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(222, 183, 91, 0.4);
    }

    .chat-widget-send:active:not(:disabled) {
      transform: translateY(0);
    }

    .chat-widget-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* Loading animation - improved */
    .chat-loading {
      display: flex;
      gap: 6px;
      padding: 16px 18px;
      align-items: center;
    }

    .chat-loading-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${PRIMARY_COLOR};
      animation: bounce 1.4s infinite ease-in-out both;
    }

    .chat-loading-dot:nth-child(1) {
      animation-delay: -0.32s;
    }

    .chat-loading-dot:nth-child(2) {
      animation-delay: -0.16s;
    }

    @keyframes bounce {
      0%, 80%, 100% {
        transform: scale(0.6);
        opacity: 0.5;
      }
      40% {
        transform: scale(1);
        opacity: 1;
      }
    }

    /* Mobile responsiveness */
    @media (max-width: 480px) {
      .chat-widget-button {
        bottom: 5.5rem;
        right: 1.5rem;
        width: 56px;
        height: 56px;
      }

      .chat-widget-button svg {
        width: 28px;
        height: 28px;
      }

      .chat-widget-window {
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        max-height: 100vh;
        max-width: 100vw;
        border-radius: 0;
      }

      .chat-widget-window.chat-size-small,
      .chat-widget-window.chat-size-medium,
      .chat-widget-window.chat-size-large {
        width: 100%;
        height: 100%;
      }

      .chat-widget-header {
        padding: 16px;
      }

      .chat-widget-header-title {
        font-size: 15px;
      }

      .chat-widget-header-subtitle {
        font-size: 11px;
      }

      .chat-widget-size-controls {
        display: none;
      }

      .chat-new-btn {
        font-size: 11px;
        padding: 5px 10px;
      }

      .chat-widget-messages {
        padding: 16px 14px;
      }

      .chat-message-content {
        max-width: 90%;
        font-size: 14px;
      }

      .chat-widget-input-container {
        padding: 12px 14px 16px;
      }
    }
  `;
    document.head.appendChild(style);

    // Create HTML structure
    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.innerHTML = `
    <button class="chat-widget-button" id="chatWidgetButton" style="display: none;" aria-label="Otevřít chat">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
      </svg>
    </button>

    <div class="chat-widget-window chat-size-small" id="chatWidgetWindow" role="dialog" aria-labelledby="chatWidgetTitle">
      <div class="chat-widget-header">
<!--        <div class="chat-widget-header-left">-->
<!--          <div class="chat-widget-header-text">-->
<!--            <div class="chat-widget-header-title" id="chatWidgetTitle">Virtuální asistent</div>-->
<!--          </div>-->
<!--        </div>-->
        <div class="chat-widget-header-controls">
          <div class="chat-widget-size-controls">
            <button class="chat-size-btn" data-size="small" aria-label="Malá velikost">S</button>
            <button class="chat-size-btn" data-size="medium" aria-label="Střední velikost">M</button>
            <button class="chat-size-btn" data-size="large" aria-label="Velká velikost">L</button>
          </div>
          <button class="chat-new-btn" id="chatNewConversationBtn" style="display:none;" aria-label="Nová konverzace">
            ✨ Nový chat
          </button>
          <button class="chat-widget-close" id="chatWidgetClose" aria-label="Zavřít">&times;</button>
        </div>
      </div>

      <div class="chat-widget-messages" id="chatWidgetMessages" role="log" aria-live="polite"></div>

      <div class="chat-widget-input-container">
        <textarea
          class="chat-widget-input"
          id="chatWidgetInput"
          placeholder="Napište zprávu..."
          rows="1"
          aria-label="Zpráva"
        ></textarea>
        <button class="chat-widget-send" id="chatWidgetSend" aria-label="Odeslat zprávu">Odeslat</button>
      </div>
    </div>
  `;

    function mountWidget() {
        document.body.appendChild(container);

        // Get elements
        const button = document.getElementById('chatWidgetButton');
        const chatWindow = document.getElementById('chatWidgetWindow');

        // Show the chat button only when resources (system prompt) are fully loaded
        if (isSystemReady) {
            button.style.display = 'flex';
        } else {
            button.style.display = 'none';
        }
        const closeBtn = document.getElementById('chatWidgetClose');
        const messagesContainer = document.getElementById('chatWidgetMessages');
        const input = document.getElementById('chatWidgetInput');
        const sendBtn = document.getElementById('chatWidgetSend');
        const sizeButtons = container.querySelectorAll('.chat-size-btn');
        const newBtn = document.getElementById('chatNewConversationBtn');

        // Disable send until system prompt is ready
        sendBtn.disabled = !isSystemReady;

        // Restore chat history from localStorage if available
        const storedHistory = loadChatHistoryFromLocal();
        if (storedHistory && storedHistory.length > 0) {
            messages = [
                { role: 'system', content: systemPrompt },
                ...storedHistory
            ];
        }

        // Wire new conversation button
        if (newBtn) {
            newBtn.addEventListener('click', startNewConversation);
        }

        // Functions
        function toggleWindow() {
            isOpen = !isOpen;
            chatWindow.classList.toggle('open', isOpen);
            if (isOpen) {
                input.focus();
                renderMessages();
            }
        }

        function autoResize() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 168) + 'px';
        }

        function renderMessages() {
            updateNewConversationVisibility();
            messagesContainer.innerHTML = '';
            messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.className = `chat-message ${msg.role}`;

                let contentHtml;
                if (msg.role === 'assistant') {
                    // Render assistant messages as Markdown
                    contentHtml = marked.parse(msg.content);
                } else {
                    // Escape user/system messages to prevent injection
                    contentHtml = escapeHtml(msg.content);
                }

                msgDiv.innerHTML = `<div class="chat-message-content">${contentHtml}</div>`;
                messagesContainer.appendChild(msgDiv);
            });

            if (isLoading) {
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'chat-message assistant';
                loadingDiv.innerHTML = `
          <div class="chat-loading">
            <div class="chat-loading-dot"></div>
            <div class="chat-loading-dot"></div>
            <div class="chat-loading-dot"></div>
          </div>
        `;
                messagesContainer.appendChild(loadingDiv);
            }

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatTranscript(msgs) {
            try {
                return msgs.filter(m => m.role !== 'system')
                    .map(m => {
                        const role = m.role || 'unknown';
                        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                        return `[${role}]\n${content}`;
                    }).join('\n\n');
            } catch (e) {
                console.warn('Failed to format transcript:', e);
                return msgs.map(m => `[${m.role}]`).join('\n');
            }
        }

        // Chat history persistence helpers
        function getStorableHistory() {
            // Store only user and assistant messages, exclude the system prompt
            return messages.filter(m => m.role === 'user' || m.role === 'assistant');
        }

        function saveChatHistory() {
            try {
                const history = getStorableHistory();
                const serialized = JSON.stringify(history);
                try { sessionStorage.setItem(SESSION_HISTORY_KEY, serialized); } catch (_) {}
                try { localStorage.setItem(LOCAL_HISTORY_KEY, serialized); } catch (_) {}
            } catch (e) {
                console.warn('Failed to save chat history:', e);
            }
        }

        function loadChatHistoryFromLocal() {
            try {
                const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return null;
                // Keep only valid roles
                return parsed.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
            } catch (e) {
                console.warn('Failed to load chat history:', e);
                return null;
            }
        }

        function clearChatHistory() {
            try { sessionStorage.removeItem(SESSION_HISTORY_KEY); } catch (_) {}
            try { localStorage.removeItem(LOCAL_HISTORY_KEY); } catch (_) {}
        }

        function hasHistory() {
            return getStorableHistory().length > 0 || !!localStorage.getItem(LOCAL_HISTORY_KEY);
        }

        function updateNewConversationVisibility() {
            if (!newBtn) return;
            newBtn.style.display = hasHistory() ? 'inline-block' : 'none';
        }

        function startNewConversation() {
            clearChatHistory();
            correlationId = generateCorrelationId();
            // Reset messages to system + greeting only
            messages = [
                { role: 'system', content: systemPrompt },
                { role: 'assistant', content: GREETING }
            ];
            renderMessages();
        }

        async function sendTranscriptEmail() {
            // Retry sending the transcript email with exponential backoff
            try {
                if (!window.emailjs || !EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
                    return;
                }

                const transcript = formatTranscript(messages);
                const subject = `Konverzace s AI ${correlationId}`;
                const params = {
                    to_email: EMAIL_TO,
                    subject: subject,
                    message: transcript,
                    correlation_id: correlationId
                };

                const maxAttempts = 5; // total tries
                const baseDelayMs = 100; // initial backoff delay
                let attempt = 0;

                while (attempt < maxAttempts) {
                    try {
                        attempt += 1;
                        if (attempt > 1) {
                            const jitter = Math.floor(Math.random() * 200);
                            const delay = baseDelayMs * Math.pow(2, attempt - 2) + jitter;
                            await new Promise(res => setTimeout(res, delay));
                        }

                        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params);
                        console.log(`Transcript email sent (attempt ${attempt})`);
                        return; // success
                    } catch (innerErr) {
                        // If this was the last attempt, rethrow to outer catch
                        if (attempt >= maxAttempts) {
                            throw innerErr;
                        }
                        console.warn(`Transcript email send failed (attempt ${attempt}), will retry...`, innerErr);
                    }
                }
            } catch (e) {
                console.warn('Failed to send transcript email after retries:', e);
            }
        }

        async function sendMessage() {
            const message = input.value.trim();
            if (!message || isLoading) return;
            if (!isSystemReady) {
                // Prevent sending until system prompt (knowledge base) is loaded
                return;
            }

            messages.push({role: 'user', content: message});
            input.value = '';
            input.style.height = 'auto';
            isLoading = true;
            sendBtn.disabled = true;
            renderMessages();

            try {
                const payload = {
                    model: MODEL,
                    messages: messages
                };

                const response = await fetch(OPENAI_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getOpenAiApiKey()}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
                }

                const data = await response.json();
                const assistantContent = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
                    ? data.choices[0].message.content
                    : (data && data.content ? data.content : 'Omlouváme se, nepodařilo se přečíst odpověď od OpenAI.');
                messages.push({role: 'assistant', content: assistantContent});
                // send transcript via EmailJS (non-blocking)
                try {
                    sendTranscriptEmail();
                } catch (e) {
                    console.warn('Email send invocation failed:', e);
                }
            } catch (error) {
                console.error('Error:', error);
                messages.push({
                    role: 'assistant',
                    content: 'Omlouváme se, ale došlo k chybě. Zkuste prosím znovu načíst stránku.'
                });
            } finally {
                isLoading = false;
                sendBtn.disabled = false;
                // Persist chat history after receiving a response (or error), excluding system message
                saveChatHistory();
                renderMessages();
            }
        }

        // Event listeners
        button.addEventListener('click', toggleWindow);
        closeBtn.addEventListener('click', toggleWindow);
        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('input', autoResize);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Re-render, enable send, and show the chat button when system prompt gets ready
        document.addEventListener('chatWidget:systemReady', () => {
            sendBtn.disabled = false;
            button.style.display = 'flex';
            renderMessages();
        });

        sizeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const size = btn.getAttribute('data-size');
                chatWindow.classList.remove('chat-size-small', 'chat-size-medium', 'chat-size-large');
                chatWindow.classList.add(`chat-size-${size}`);
            });
        });
    }

    if (document.body) {
        mountWidget();
    } else {
        window.addEventListener('DOMContentLoaded', mountWidget);
    }

})();