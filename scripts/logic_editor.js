// logic_editor.js

// Global variable to hold the active recognition instance and button state
let sttRecognitionInstance = null;
let sttOriginalButtonInnerHTML = '';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams((window.location.hash).substring(1));
    const markdownInput = document.querySelector('.markdown-input');
    const preview = document.querySelector('.markdown-preview.markdown-body');
    const toolbar = document.querySelector('.editor-toolbar');
    const responseElement = document.getElementById('response');

    if (!markdownInput || !preview) {
        displayError("GEN-002");
        return; 
    }
    
    let edit = false;

    if (params.has('load') && params.get('load') === 'true') {
        edit = true;
        const id = params.get('entry');
        // const section = params.get('section'); // Not used yet

        if (!id) {
            displayError("GLC-001"); 
            return;
        }
        
        try {
            const load = await GetLoadout(id); // Get metadata first
            if (!load) { // GetLoadout handles its own errors (GL-002)
                 if (markdownInput) markdownInput.innerHTML = "Error loading entry metadata.";
                 if (preview) preview.innerHTML = marked.parse("Error loading entry metadata.");
                return;
            }
            document.title = `Edit Loadout - ${load.title || "Untitled Entry"}`;
            const content = await GetLoadoutContent(id, ''); // Then content

            if (content === null) { // GetLoadoutContent handles its own errors
                if (markdownInput) markdownInput.innerHTML = "Error loading content.";
                if (preview) preview.innerHTML = marked.parse("Error loading content.");
                return;
            }

            const title = load.title || "Untitled Entry";

            if (markdownInput) markdownInput.innerHTML = content || "";
            if (preview && typeof marked !== 'undefined') preview.innerHTML = marked.parse(content || "");
            else if (preview) preview.innerHTML = "Markdown preview library not loaded.";


            const saveButton = document.querySelector('.save-button');
            if (saveButton) {
                const newSaveButton = saveButton.cloneNode(true);
                saveButton.parentNode.replaceChild(newSaveButton, saveButton);

                newSaveButton.addEventListener('click', async (event) => {
                    event.preventDefault();
                    const currentContent = markdownInput ? markdownInput.innerText : "";

                    if (!title || title.trim() === "" || !currentContent || currentContent.trim() === "") {
                        displayError("SL-003");
                        return;
                    }

                    if (responseElement) {
                        responseElement.style.display = 'block';
                        responseElement.innerText = 'Updating...';
                        responseElement.style.backgroundColor = '#e3f2fd';
                    }
                    
                    const success = await updateLoadoutContent(id, currentContent);
                    if (success) {
                         if (responseElement) responseElement.innerText = '✅ Updated successfully!';
                         setTimeout(() => { window.location.href = 'index.html'; }, 1500);
                    } else {
                        if (responseElement) responseElement.innerText = '❌ Update failed.';
                    }
                });
            } else {
                displayError("GEN-002"); // Save button missing
            }
        } catch (err) {
            displayError("GEN-001");
            if (markdownInput) markdownInput.innerHTML = "Error setting up editor.";
            if (preview && typeof marked !== 'undefined') preview.innerHTML = marked.parse("Error setting up editor.");
            else if (preview) preview.innerHTML = "Markdown preview library not loaded.";
        }
    }
    
    if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
        marked.setOptions({
            pedantic: false, gfm: true, breaks: false, sanitize: false, 
            smartLists: true, smartypants: false, xhtml: false,
            highlight: function (code, lang) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language, ignoreIllegals: true }).value;
            }
        });
    } else {
        console.warn("Marked.js or Highlight.js not loaded.");
    }

    function updatePreview() {
        if (markdownInput && preview) {
            const markdownText = markdownInput.innerText;
            if (typeof marked !== 'undefined') {
                preview.innerHTML = marked.parse(markdownText);
            } else {
                preview.innerHTML = "Markdown library not loaded. Cannot render preview.";
            }
        }
    }

    if (markdownInput) {
        markdownInput.addEventListener('input', updatePreview);
        updatePreview();
    }

    // ... (getMarkdownSelection, insertTextAtCursor, surroundSelection, prefixLine remain the same)
    function getMarkdownSelection(inputElement) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (inputElement.contains(range.commonAncestorContainer)) {
                return {
                    text: selection.toString(),
                    range: range
                };
            }
        }
        return { text: '', range: null };
    }

    function insertTextAtCursor(text, selectPlaceholder = false, placeholder = "text") {
        if (!markdownInput) { displayError("GEN-002"); return; }
        const sel = window.getSelection();
        if (sel.rangeCount) {
            let range = sel.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);

            if (selectPlaceholder && text.includes(placeholder)) {
                const placeholderIndex = text.indexOf(placeholder);
                range.setStart(textNode, placeholderIndex);
                range.setEnd(textNode, placeholderIndex + placeholder.length);
            } else {
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
            }
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            markdownInput.innerText += text; 
        }
        markdownInput.focus();
        updatePreview();
    }

    function surroundSelection(prefix, suffix = prefix, defaultText = "text", isBlock = false) {
        if (!markdownInput) { displayError("GEN-002"); return; }
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            let selectedText = range.toString();
            let modifiedText;

            if (isBlock && !selectedText && prefix.startsWith('\n')) { 
                    modifiedText = prefix + defaultText + suffix;
            } else if (isBlock && selectedText && !selectedText.startsWith('\n')) {
                selectedText = '\n' + selectedText;
                if (!selectedText.endsWith('\n')) selectedText += '\n';
                modifiedText = prefix.trim() + selectedText + suffix.trim();
            }
            else if (selectedText) {
                modifiedText = prefix + selectedText + suffix;
            } else {
                modifiedText = prefix + defaultText + suffix;
            }

            range.deleteContents();
            const textNode = document.createTextNode(modifiedText);
            range.insertNode(textNode);

            if (!selectedText) {
                const startOffset = modifiedText.indexOf(defaultText);
                if (startOffset !== -1) {
                    range.setStart(textNode, startOffset);
                    range.setEnd(textNode, startOffset + defaultText.length);
                }
            } else {
                if (isBlock) {
                    range.setStartAfter(textNode);
                    range.setEndAfter(textNode);
                } else { 
                    const startOffset = prefix.length;
                    const endOffset = startOffset + selectedText.length;
                    range.setStart(textNode, startOffset);
                    range.setEnd(textNode, endOffset);
                }
            }
            sel.removeAllRanges();
            sel.addRange(range);

        } else { 
            insertTextAtCursor(prefix + defaultText + suffix, true, defaultText);
        }
        markdownInput.focus();
        updatePreview();
    }

    function prefixLine(prefix, defaultText = "text") {
        if (!markdownInput) { displayError("GEN-002"); return; }
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const selectedText = range.toString();
            let textToInsert;

            if (selectedText) {
                const lines = selectedText.split('\n');
                textToInsert = lines.map(line => line.trim() === '' ? prefix.trim() : prefix + line).join('\n');
            } else {
                textToInsert = prefix + defaultText;
            }
            range.deleteContents();
            const textNode = document.createTextNode(textToInsert);
            range.insertNode(textNode);

            if (!selectedText) {
                const defaultTextIndex = textToInsert.indexOf(defaultText);
                if (defaultTextIndex !== -1) {
                    range.setStart(textNode, defaultTextIndex);
                    range.setEnd(textNode, defaultTextIndex + defaultText.length);
                }
            } else {
                    range.setStart(textNode, 0);
                    range.setEnd(textNode, textToInsert.length);
            }
            sel.removeAllRanges();
            sel.addRange(range);

        } else {
                insertTextAtCursor(prefix + defaultText, true, defaultText);
        }
        markdownInput.focus();
        updatePreview();
    }

    const commands = {
        'bold': () => surroundSelection('**'),
        'italic': () => surroundSelection('*'),
        'strike': () => surroundSelection('~~'),
        'h1': () => prefixLine('# ', 'Heading 1'),
        'h2': () => prefixLine('## ', 'Heading 2'),
        'h3': () => prefixLine('### ', 'Heading 3'),
        // ... other commands
        'ul': () => prefixLine('- ', 'List item'),
        'ol': () => prefixLine('1. ', 'List item'),
        'task': () => prefixLine('- [ ] ', 'Task item'),
        'quote': () => prefixLine('> ', 'Quote'),
        'hr': () => insertTextAtCursor('\n---\n'),
        'link': () => {
            const url = prompt("Enter URL:", "https://");
            if (url) surroundSelection('[', `](${url})`, 'link text');
        },
        'image': () => {
            const url = prompt("Enter image URL:", "https://");
            if (url) {
                const alt = prompt("Enter alt text:", "image");
                insertTextAtCursor(`![${alt || 'image'}](${url})`);
            }
        },
        'code-inline': () => surroundSelection('`', '`', 'code'),
        'code-block': () => {
            const lang = prompt("Enter language (e.g., python, js) or leave blank:", "");
            surroundSelection(`\n\`\`\`${lang}\n`, '\n```\n', 'code goes here', true);
        },
        'table': () => {
            const tableMd = "\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |\n";
            insertTextAtCursor(tableMd);
        },
        'save': () => { 
            if (typeof ConfigInfoPage === 'function') ConfigInfoPage('overlayBackground', 'toggle');
            else console.warn("ConfigInfoPage function not found for save command.");
        },
        STT: () => {
            const sttButton = toolbar ? toolbar.querySelector('button[data-cmd="STT"]') : null;

            if (sttRecognitionInstance) { // If recognition is active, stop it
                sttRecognitionInstance.stop();
                // onend handler will reset the button and instance
                return;
            }

            const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognitionAPI) {
                displayError("STT-001"); // STT not supported
                return;
            }

            sttRecognitionInstance = new SpeechRecognitionAPI();
            sttRecognitionInstance.lang = navigator.language || 'en-US';
            sttRecognitionInstance.interimResults = true;
            sttRecognitionInstance.continuous = true; // Keep listening for longer phrases/pauses
            sttRecognitionInstance.maxAlternatives = 1;

            let currentFullTranscriptSegment = ""; // Accumulates final parts of current utterance
            let activeSpeechDOMNode = null;    // The DOM text node we're updating
            let sttInitialRange = null;        // Cursor position when STT started

            // Store original button content if not already stored
            if (sttButton && !sttOriginalButtonInnerHTML) {
                sttOriginalButtonInnerHTML = sttButton.innerHTML;
            }
            if (sttButton) {
                sttButton.innerHTML = '🎙️ Listening... (Stop)';
                sttButton.classList.add('stt-active'); // For styling
            }

            sttRecognitionInstance.onstart = () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    sttInitialRange = selection.getRangeAt(0).cloneRange();
                } else { // Fallback if no selection (e.g., input not focused)
                    sttInitialRange = document.createRange();
                    sttInitialRange.selectNodeContents(markdownInput);
                    sttInitialRange.collapse(false); // To end of content
                }
                currentFullTranscriptSegment = "";
                activeSpeechDOMNode = null;
            };

            sttRecognitionInstance.onresult = (event) => {
                let interimTranscript = '';
                let justFinalizedThisUtterance = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcriptPart = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        justFinalizedThisUtterance += transcriptPart;
                    } else {
                        interimTranscript += transcriptPart;
                    }
                }

                currentFullTranscriptSegment += justFinalizedThisUtterance;
                const textToDisplay = currentFullTranscriptSegment + interimTranscript;

                const selection = window.getSelection();
                if (!selection || !markdownInput) return;
                
                let targetRange;

                if (activeSpeechDOMNode && activeSpeechDOMNode.parentNode === markdownInput) {
                    // Update existing node
                    activeSpeechDOMNode.nodeValue = textToDisplay;
                    targetRange = document.createRange();
                    targetRange.setStart(activeSpeechDOMNode, activeSpeechDOMNode.length); // Move to end of this node
                    targetRange.collapse(true);
                } else {
                    // Create new node at initial/current cursor position
                    targetRange = (sttInitialRange && markdownInput.contains(sttInitialRange.commonAncestorContainer)) 
                                  ? sttInitialRange.cloneRange() 
                                  : selection.getRangeAt(0).cloneRange();
                    
                    targetRange.deleteContents(); // Clear selection or prepare cursor

                    activeSpeechDOMNode = document.createTextNode(textToDisplay);
                    targetRange.insertNode(activeSpeechDOMNode);
                    
                    // After inserting, sttInitialRange is "used up" for this node placement.
                    // Future updates within this speech segment will modify activeSpeechDOMNode directly.
                    sttInitialRange = null; 

                    targetRange.setStart(activeSpeechDOMNode, activeSpeechDOMNode.length);
                    targetRange.collapse(true);
                }
                
                selection.removeAllRanges();
                selection.addRange(targetRange);
                markdownInput.focus(); // Important to keep focus for typing/editing
                updatePreview();
            };

            sttRecognitionInstance.onerror = (event) => {
                console.error("Speech recognition error:", event.error, event.message);
                const errorCodeMap = {
                    'no-speech': "STT-002",
                    'audio-capture': "STT-003",
                    'not-allowed': "STT-004",
                    'network': "STT-005",
                    'aborted': "STT-005", // Often user-initiated (e.g. stopping) or script
                    'service-not-allowed': "STT-006",
                    'bad-grammar': "STT-005", // Less common, but possible
                    'language-not-supported': "STT-005"
                };
                displayError(errorCodeMap[event.error] || "STT-005");

                // sttRecognitionInstance.stop() might be called implicitly or by .onend
                // Reset UI and state here as onend might not fire after certain errors.
                if (sttButton && sttOriginalButtonInnerHTML) {
                    sttButton.innerHTML = sttOriginalButtonInnerHTML;
                    sttButton.classList.remove('stt-active');
                }
                activeSpeechDOMNode = null;
                sttRecognitionInstance = null; // Clear the instance
            };

            sttRecognitionInstance.onend = () => {
                if (sttButton && sttOriginalButtonInnerHTML) {
                    sttButton.innerHTML = sttOriginalButtonInnerHTML;
                    sttButton.classList.remove('stt-active');
                }

                // Finalize by potentially adding a space if content was added
                if (activeSpeechDOMNode && activeSpeechDOMNode.nodeValue && !activeSpeechDOMNode.nodeValue.endsWith(' ')) {
                    const currentText = activeSpeechDOMNode.nodeValue;
                    activeSpeechDOMNode.nodeValue = currentText + ' '; // Add trailing space

                    // Move cursor after the space
                    const selection = window.getSelection();
                    if(selection){
                        const range = document.createRange();
                        range.setStart(activeSpeechDOMNode, activeSpeechDOMNode.length);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
                
                activeSpeechDOMNode = null;
                currentFullTranscriptSegment = ""; // Reset for next potential start
                sttRecognitionInstance = null; // Important: clear the global instance
                updatePreview();
                markdownInput.focus();
            };
            
            try {
                sttRecognitionInstance.start();
            } catch (e) { // Catch potential error if .start() itself fails (e.g. already started, though logic prevents)
                displayError("STT-005");
                console.error("Error starting speech recognition:", e);
                if (sttButton && sttOriginalButtonInnerHTML) {
                    sttButton.innerHTML = sttOriginalButtonInnerHTML;
                    sttButton.classList.remove('stt-active');
                }
                sttRecognitionInstance = null;
            }
        }
    };

    if (toolbar) {
        toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (button && button.dataset.cmd) {
                const commandFunction = commands[button.dataset.cmd];
                if (commandFunction) {
                     // Simpler command execution logic for now
                    e.preventDefault(); // Prevent default button behaviors
                    commandFunction();
                }
            }
        });
    }

    // Scroll Sync Logic (remains the same)
    const editorEIU = document.querySelector('.markdown-input');
    const previewEIU = document.querySelector('.markdown-preview');
    let isSyncingEditorScroll = false;
    let isSyncingPreviewScroll = false;

    if (editorEIU && previewEIU) {
        editorEIU.addEventListener('scroll', () => {
            if (isSyncingEditorScroll || editorEIU.scrollHeight <= editorEIU.clientHeight) return;
            isSyncingPreviewScroll = true;
            const scrollPercentage = editorEIU.scrollTop / (editorEIU.scrollHeight - editorEIU.clientHeight);
            previewEIU.scrollTop = scrollPercentage * (previewEIU.scrollHeight - previewEIU.clientHeight);
            requestAnimationFrame(() => { isSyncingPreviewScroll = false; });
        });

        previewEIU.addEventListener('scroll', () => {
            if (isSyncingPreviewScroll || previewEIU.scrollHeight <= previewEIU.clientHeight) return;
            isSyncingEditorScroll = true;
            const scrollPercentage = previewEIU.scrollTop / (previewEIU.scrollHeight - previewEIU.clientHeight);
            editorEIU.scrollTop = scrollPercentage * (editorEIU.scrollHeight - editorEIU.clientHeight);
            requestAnimationFrame(() => { isSyncingEditorScroll = false; });
        });
    }
    
    // Overlay logic (remains the same)
    const overlayBackground = document.getElementById('overlayBackground');
    const ideaPage = document.querySelector('.idea-bodyOfInformation-page'); 

    if (!edit) {
        if (overlayBackground && ideaPage) {
            overlayBackground.addEventListener('click', () => {
                if (ideaPage.classList.contains('show')) {
                    ideaPage.classList.remove('show');
                    ideaPage.classList.add('hide');
                    overlayBackground.style.display = 'none';
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && ideaPage && ideaPage.classList.contains('show')) {
                ideaPage.classList.remove('show');
                ideaPage.classList.add('hide');
                if (overlayBackground) overlayBackground.style.display = 'none';
            }
        });

        const pldEteButton = document.getElementById('PLD_ETE');
        if (pldEteButton) {
            pldEteButton.addEventListener('click', (event) => {
                event.preventDefault(); 
                
                const titleInput = document.getElementById('ideaTitle');
                const title = titleInput ? titleInput.value : "";
                const currentMarkdownInput = document.querySelector('.markdown-input');
                let content = currentMarkdownInput ? currentMarkdownInput.innerText : "";
    
                if (!title || title.trim() === "" || !content || content.trim() === "") {
                    displayError("SL-003");
                    return;
                }
    
                if (responseElement) {
                    responseElement.style.display = 'block';
                    responseElement.innerText = 'Saving...';
                    responseElement.style.backgroundColor = '#e3f2fd';
                }
                SendLoadout(title, content);
            });
        } else {
             console.warn("Save button (PLD_ETE) not found for new entry mode.");
        }
    }

    // Ask user to confirm before leaving the page if there are unsaved changes
    let hasUnsavedChanges = false;
    let startedWithWrite = false;

    markdownInput?.addEventListener('input', () => {
        hasUnsavedChanges = markdownInput.textContent !== '';
        if (hasUnsavedChanges) startedWithWrite = true;
    });

    window.addEventListener('beforeunload', function (e) {
        if (!startedWithWrite) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // Ensure response element exists (remains the same)
    if (!document.getElementById('response') && (document.getElementById('ideaForm') || document.body)) {
        let localResponseElement = document.createElement('div');
        localResponseElement.id = 'response';
        localResponseElement.style.marginTop = '10px';
        localResponseElement.style.padding = '10px';
        localResponseElement.style.borderRadius = '4px';
        localResponseElement.style.display = 'none'; 
        const form = document.getElementById('ideaForm');
        if (form) form.appendChild(localResponseElement);
    }
});
