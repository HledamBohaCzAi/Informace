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

    // Create HTML structure (styles are in external CSS)
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

        // Scroll/hover state for chat button visibility
        let lastScrollY = window.scrollY || window.pageYOffset || 0;
        let isPinnedShown = false; // set to true on hover; cleared on next downward scroll
        const SCROLL_THRESHOLD = 10;

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
        function onButtonClick(e) {
            if (button.__suppressNextClick) {
                e.preventDefault();
                e.stopPropagation();
                button.__suppressNextClick = false;
                return;
            }
            toggleWindow();
        }
        button.addEventListener('click', onButtonClick);
        closeBtn.addEventListener('click', toggleWindow);
        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('input', autoResize);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Drag logic: allow vertical dragging on right side (desktop + mobile)
        (function enableVerticalDrag(btn){
            const DRAG_STORAGE_KEY = 'chatWidgetButtonTopPx';
            const SAFE_MARGIN = 12; // px
            const CLICK_SUPPRESS_DISTANCE = 6; // px
            let dragging = false;
            let startPointerY = 0;
            let startTop = 0;
            let moved = false;

            function clampTop(top) {
                const h = window.innerHeight || document.documentElement.clientHeight;
                const btnH = btn.offsetHeight || 64;
                const maxTop = Math.max(SAFE_MARGIN, h - btnH - SAFE_MARGIN);
                return Math.min(Math.max(top, SAFE_MARGIN), maxTop);
            }

            function applyTop(top) {
                const t = clampTop(top);
                btn.style.top = t + 'px';
                btn.style.bottom = '';
                return t;
            }

            // Restore stored top position if available
            try {
                const stored = localStorage.getItem(DRAG_STORAGE_KEY);
                if (stored !== null && !isNaN(parseFloat(stored))) {
                    applyTop(parseFloat(stored));
                }
            } catch(_) {}

            function onPointerDown(e){
                // Only primary button / touch
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                dragging = true;
                moved = false;
                startPointerY = e.clientY;
                // compute current top; if not set, convert from bottom to top
                const rect = btn.getBoundingClientRect();
                startTop = rect.top;
                // Make sure it's positioned by top so movement works consistently
                applyTop(startTop);
                // Visual: pause transitions/animations during drag for snappy feel
                btn.classList.remove('hidden');
                btn.style.transition = 'none';
                btn.style.animation = 'none';
                try { btn.setPointerCapture(e.pointerId); } catch(_) {}
                e.preventDefault();
            }

            function onPointerMove(e){
                if (!dragging) return;
                const dy = e.clientY - startPointerY;
                if (Math.abs(dy) > CLICK_SUPPRESS_DISTANCE) {
                    moved = true;
                }
                applyTop(startTop + dy);
                e.preventDefault();
            }

            function endDrag(e){
                if (!dragging) return;
                dragging = false;
                // restore transition
                btn.style.transition = '';
                btn.style.animation = '';
                // Persist position
                const rect = btn.getBoundingClientRect();
                const finalTop = clampTop(rect.top);
                try { localStorage.setItem(DRAG_STORAGE_KEY, String(finalTop)); } catch(_) {}
                if (moved) {
                    btn.__suppressNextClick = true;
                }
                e && e.preventDefault && e.preventDefault();
            }

            btn.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove, {passive:false});
            window.addEventListener('pointerup', endDrag, {passive:false});
            window.addEventListener('pointercancel', endDrag, {passive:false});

            // Re-clamp on resize
            window.addEventListener('resize', () => {
                const styleTop = parseFloat((btn.style.top || '').replace('px',''));
                if (!isNaN(styleTop)) {
                    applyTop(styleTop);
                }
            });
        })(button);

        // Show on hover and pin until next scroll down
        button.addEventListener('mouseenter', () => {
            isPinnedShown = true;
            button.classList.remove('hidden');
        });

        // Hide/show on scroll based on direction
        window.addEventListener('scroll', () => {
            const currentY = window.scrollY || window.pageYOffset || 0;
            const delta = currentY - lastScrollY;

            if (Math.abs(delta) >= SCROLL_THRESHOLD) {
                if (delta > 0) {
                    // scrolling down
                    if (isPinnedShown) {
                        isPinnedShown = false; // unpin on first scroll down
                    }
                    button.classList.add('hidden');
                } else {
                    // scrolling up
                    button.classList.remove('hidden');
                }
                lastScrollY = currentY;
            }
        }, { passive: true });

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
