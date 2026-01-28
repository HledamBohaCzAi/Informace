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

    .chat-widget-window.chat-size-small {
      width: 380px;
      height: 550px;
    }
    .chat-widget-window.chat-size-medium {
      width: 760px; /* 2x width */
      height: 825px; /* 1.5x height */
    }
    .chat-widget-window.chat-size-large {
      width: 1140px; /* 3x width */
      height: 1100px; /* 2x height */
    }
    .chat-widget-size-controls {
      display: flex;
      gap: 6px;
    }
    .chat-size-btn {
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      font-size: 12px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
      padding: 2px 6px;
    }
    .chat-size-btn:hover {
      background: rgba(255,255,255,0.4);
    }
    .chat-new-btn {
      background: rgba(255,255,255,0.9);
      color: #333;
      border: none;
      font-size: 12px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
      padding: 2px 8px;
      margin-left: 8px;
    }
    .chat-new-btn:hover {
      background: #fff;
    }

    .chat-widget-button {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${PRIMARY_COLOR};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .chat-widget-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(0,0,0,0.2);
    }

    .chat-widget-button svg {
      width: 28px;
      height: 28px;
      fill: white;
    }

    .chat-widget-window {
      position: fixed;
      bottom: 6rem;
      right: 2rem;
      width: 380px;
      height: 550px;
      /* Ensure the window never exceeds the viewport on small screens */
      max-width: calc(100vw - 4rem); /* accounts for right: 2rem + safe 2rem on the left */
      max-height: calc(100vh - 8rem); /* accounts for bottom: 6rem + safe 2rem for breathing space */
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      display: none;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
    }

    .chat-widget-window.open {
      display: flex;
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .chat-widget-header {
      background: ${PRIMARY_COLOR};
      color: white;
      padding: 18px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chat-widget-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 24px;
      line-height: 1;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.9;
      transition: opacity 0.2s;
    }

    .chat-widget-close:hover {
      opacity: 1;
    }

    .chat-widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f8f9fa;
      font-family: 'Albert Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .chat-message {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
    }

    .chat-message.system {
      display: none
    }

    .chat-message.user {
      align-items: flex-end;
    }

    .chat-message.assistant {
      align-items: flex-start;
    }

    .chat-message-content {
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 80%;
      word-wrap: break-word;
      white-space: pre-wrap;
      font-size: 14px;
      line-height: 1.5;
    }

    .chat-message.user .chat-message-content {
      background: ${PRIMARY_COLOR};
      color: white;
    }

    .chat-message.assistant .chat-message-content {
      background: white;
      color: #333;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }

    /* Ensure Markdown lists render nicely inside the chat bubble */
    .chat-message-content ul,
    .chat-message-content ol {
      margin: 0.25em 0 0.75em 0;
      padding-left: 1.1rem; /* add gentle left indent */
      list-style-position: inside; /* keep bullets/numbers inside the bubble */
    }

    .chat-message-content li {
      margin: 0.25em 0; /* comfortable spacing between items */
    }

    /* Indentation for nested lists */
    .chat-message-content ul ul,
    .chat-message-content ol ol,
    .chat-message-content ul ol,
    .chat-message-content ol ul {
      margin: 0.25em 0 0.5em 0;
      padding-left: 1rem;
    }

    .chat-widget-input-container {
      padding: 16px;
      background: white;
      border-top: 1px solid #e9ecef;
      display: flex;
      gap: 8px;
    }

    .chat-widget-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      resize: none;
      min-height: 40px;
      max-height: 168px;
      overflow-y: auto;
      line-height: 1.5;
    }

    .chat-widget-input:focus {
      border-color: ${PRIMARY_COLOR};
    }

    .chat-widget-send {
      padding: 10px 20px;
      max-height: 40px;
      align-self: end;
      background: ${PRIMARY_COLOR};
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: opacity 0.2s;
    }

    .chat-widget-send:hover:not(:disabled) {
      opacity: 0.9;
    }

    .chat-widget-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .chat-loading {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
    }

    .chat-loading-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #adb5bd;
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
        transform: scale(0);
      }
      40% {
        transform: scale(1);
      }
    }

    @media (max-width: 480px) {
      .chat-widget-window {
        left: 10px;
        right: 10px;
        width: auto;
        bottom: 80px;
        /* On very small screens, ensure header stays visible */
        max-height: calc(100vh - 100px);
        max-width: calc(100vw - 20px);
      }
    }
  `;
    document.head.appendChild(style);

    // Create HTML structure
    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.innerHTML = `
    <button class="chat-widget-button" id="chatWidgetButton" style="display: none;">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c-1.1 0-2-.9-2-2zm0 14H6l-2 2V4h16v12z"/>
      </svg>
    </button>

  <div class="chat-widget-window chat-size-small" id="chatWidgetWindow">
    <div class="chat-widget-header">
      <span>Chat</span>
      <div class="chat-widget-size-controls">
        <button class="chat-size-btn" data-size="small">S</button>
        <button class="chat-size-btn" data-size="medium">M</button>
        <button class="chat-size-btn" data-size="large">L</button>
        <button class="chat-new-btn" id="chatNewConversationBtn" style="display:none;">Nová konverzace</button>
      </div>
      <button class="chat-widget-close" id="chatWidgetClose">&times;</button>
    </div>

      <div class="chat-widget-messages" id="chatWidgetMessages"></div>

      <div class="chat-widget-input-container">
        <textarea
          class="chat-widget-input"
          id="chatWidgetInput"
          placeholder="Napište zprávu..."
          rows="1"
        ></textarea>
        <button class="chat-widget-send" id="chatWidgetSend">Odeslat</button>
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
