class IdeaBoxManager {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            displayError("IBM-001"); // Container not found
            return;
        }
        this.ideas = new Map(); // Map of localId -> element
        this.nextId = 1;
        this.serverUrl = 'https://your-render-app.onrender.com'; // Replace with your actual Render URL
    }

    __DEV_LEVEL_pre_loading_box_scanner() {
        if (!this.container) {
            return;
        }
        
        const existingIdeas = this.container.querySelectorAll(".idea-content");
        let maxId = 0;
        existingIdeas.forEach((el) => {
            const idStr = el.dataset.localId;
            const id = parseInt(idStr);
            if (!isNaN(id)) {
                this.ideas.set(id, el);
                if (id > maxId) maxId = id;
            }
        });
        this.nextId = maxId + 1;
    }

    // Load all ideas from server on page load
    async loadAllIdeasFromServer() {
        try {
            const entries = await GetLoadout();
            if (entries && Array.isArray(entries)) {
                entries.forEach(entry => {
                    this.addIdea(entry.title, `Loaded from server...`, entry.id, null, true);
                });
            }
        } catch (error) {
            console.error('Failed to load ideas from server:', error);
            displayError("IBM-008"); // Failed to load from server
        }
    }

    // Modified to handle server synchronization
    addIdea(title, description, serverId = null, localId = null, skipServerSync = false) {
        if (!this.container) {
            displayError("IBM-001");
            return null;
        }

        const currentId = localId || this.nextId++;

        if (!title || title.trim() === "" || title === "undefined") {
            displayError("IBM-002");
            return null;
        }

        if (!description || description.trim() === "" || description === "undefined") {
            description = "No description provided.";
        }

        const ideaElement = document.createElement("div");
        ideaElement.classList.add("idea-content");
        ideaElement.dataset.localId = currentId;
        if (serverId) {
            ideaElement.dataset.serverId = serverId;
        }
        ideaElement.dataset.ideaTitle = title;
        ideaElement.dataset.ideaDescription = description;

        const topMenu = document.createElement("div");
        topMenu.classList.add("box_top_menu");

        const topRight = document.createElement("div");
        topRight.classList.add("box_top_menu_right");

        const closeBtn = document.createElement("button");
        closeBtn.classList.add("remove-idea-button");
        closeBtn.textContent = "X";
        closeBtn.type = "button";
        closeBtn.setAttribute('aria-label', 'Delete idea');
        
        // Add delete functionality
        closeBtn.addEventListener('click', () => {
            this.removeIdeaByLocalId(currentId);
        });

        topRight.appendChild(closeBtn);
        topMenu.appendChild(topRight);

        const contentBox = document.createElement("div");
        contentBox.classList.add("box_content");

        const h2 = document.createElement("h2");
        h2.textContent = title;

        const p = document.createElement("p");
        p.textContent = description.length > 100 ? description.substring(0, 97) + "..." : description;

        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("idea-button");
        button.textContent = "View Details";
        button.addEventListener('click', async () => {
            await this.showIdeaDetails(currentId);
        });

        contentBox.appendChild(h2);
        contentBox.appendChild(p);
        contentBox.appendChild(button);

        ideaElement.appendChild(topMenu);
        ideaElement.appendChild(contentBox);

        this.ideas.set(currentId, ideaElement);
        this.container.appendChild(ideaElement);

        // Save to server if this is a new idea (not loaded from server)
        if (!skipServerSync && !serverId) {
            this.saveIdeaToServer(currentId, title, description);
        }

        return currentId;
    }

    // Save new idea to server
    async saveIdeaToServer(localId, title, description) {
        try {
            const content = `# ${title}\n\n${description}`;
            const result = await SendLoadout(content, title);
            if (result && result.success) {
                // Update the element with server ID
                const element = this.ideas.get(localId);
                if (element) {
                    element.dataset.serverId = result.id;
                }
                console.log(`Idea ${localId} saved to server with ID ${result.id}`);
            }
        } catch (error) {
            console.error('Failed to save idea to server:', error);
            displayError("IBM-009"); // Failed to save to server
        }
    }

    // Show full idea details
    async showIdeaDetails(localId) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) {
            displayError("IBM-004");
            return;
        }

        const serverId = idea.dataset.serverId;
        let content = idea.dataset.ideaDescription;

        // If we have a server ID, fetch full content from server
        if (serverId) {
            try {
                const fullContent = await GetLoadoutContent(serverId);
                if (fullContent) {
                    content = fullContent;
                }
            } catch (error) {
                console.error('Failed to fetch full content:', error);
                // Continue with cached content
            }
        }

        // Show in modal/overlay
        this.displayContentModal(idea.dataset.ideaTitle, content);
    }

    // Display content in modal
    displayContentModal(title, content) {
        const modalHtml = `
            <div class="modal-header">
                <h2>${title}</h2>
                <button type="button" class="close-modal" onclick="ConfigInfoPage('overlayBackground', 'hide')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="content-display">${this.formatContent(content)}</div>
            </div>
        `;

        const modalContent = document.querySelector('.idea-bodyOfInformation-page');
        if (modalContent) {
            modalContent.innerHTML = modalHtml;
            ConfigInfoPage('overlayBackground', 'show');
        }
    }

    // Format content for display (handle markdown if needed)
    formatContent(content) {
        if (typeof marked !== 'undefined') {
            return marked.parse(content);
        }
        // Fallback: simple text formatting
        return content.replace(/\n/g, '<br>');
    }

    setContent(localId, title, description) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) {
            displayError("IBM-004");
            return false;
        }

        const h2 = idea.querySelector(".box_content h2");
        const p = idea.querySelector(".box_content p");

        if (h2 && title) h2.textContent = title;
        if (p && description) {
            p.textContent = description.length > 100 ? description.substring(0, 97) + "..." : description;
        }

        if (title) idea.dataset.ideaTitle = title;
        if (description) idea.dataset.ideaDescription = description;

        // Update on server if we have a server ID
        const serverId = idea.dataset.serverId;
        if (serverId) {
            this.updateIdeaOnServer(serverId, title, description);
        }

        return true;
    }

    // Update idea on server
    async updateIdeaOnServer(serverId, title, description) {
        try {
            const content = `# ${title}\n\n${description}`;
            const success = await updateLoadoutContent(serverId, content);
            if (!success) {
                displayError("IBM-010"); // Failed to update on server
            }
        } catch (error) {
            console.error('Failed to update idea on server:', error);
            displayError("IBM-010");
        }
    }

    getContent(localId) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) return null;

        return {
            localId: parseInt(idea.dataset.localId),
            serverId: idea.dataset.serverId || null,
            title: idea.dataset.ideaTitle,
            description: idea.dataset.ideaDescription
        };
    }

    getLastLocalId() {
        if (this.ideas.size === 0) return null;
        return this.nextId - 1;
    }
    
    appendContent(localId, extraText) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) {
            displayError("IBM-005");
            return false;
        }

        const p = idea.querySelector(".box_content p");
        if (p) {
            const fullDescription = idea.dataset.ideaDescription + ` ${extraText}`;
            idea.dataset.ideaDescription = fullDescription;
            p.textContent = fullDescription.length > 100 ? fullDescription.substring(0, 97) + "..." : fullDescription;
            
            // Update on server
            const serverId = idea.dataset.serverId;
            if (serverId) {
                this.updateIdeaOnServer(serverId, idea.dataset.ideaTitle, fullDescription);
            }
        }
        return true;
    }

    async removeIdeaByLocalId(localId) {
        const numId = parseInt(localId);
        if (isNaN(numId)) {
            displayError("IBM-006");
            return false;
        }

        const element = this.ideas.get(numId);
        if (element) {
            const serverId = element.dataset.serverId;
            
            // Delete from server first if we have a server ID
            if (serverId) {
                try {
                    await this.deleteIdeaFromServer(serverId);
                } catch (error) {
                    console.error('Failed to delete from server:', error);
                    // Continue with local deletion even if server deletion fails
                }
            }

            // Dispatch custom event
            document.body.dispatchEvent(new CustomEvent("ideaRemoved", { 
                detail: { localId: numId, serverId: serverId } 
            }));
            
            element.remove();
            this.ideas.delete(numId);
            
            return true;
        } else {
            displayError("IBM-007");
            return false;
        }
    }

    // Delete idea from server
    async deleteIdeaFromServer(serverId) {
        try {
            const response = await fetch(`${this.serverUrl}/delete/${serverId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }

            const result = await response.json();
            return result.success;
        } catch (error) {
            console.error('Delete from server failed:', error);
            throw error;
        }
    }

    getAllIdeas() {
        return Array.from(this.ideas.values()).map(element => ({
            localId: parseInt(element.dataset.localId),
            serverId: element.dataset.serverId || null,
            title: element.dataset.ideaTitle,
            description: element.dataset.ideaDescription
        }));
    }

    clear() {
        if (!this.container && this.ideas.size > 0) {
            console.warn("IdeaBoxManager: Attempting to clear ideas but container is invalid.");
        }
        this.ideas.forEach((element) => {
            element.remove();
        });
        this.ideas.clear();
        this.nextId = 1;
    }
}

// Modal configuration function
function ConfigInfoPage(elementId, situation) {
    const element = document.getElementById(elementId);
    const page = document.querySelector('.idea-bodyOfInformation-page');
    
    if (!element || !page) {
        displayError("CFG-001");
        return;
    }
    
    if (situation === 'toggle') {
        const isVisible = window.getComputedStyle(element).display !== 'none';
        situation = isVisible ? 'hide' : 'show';
    }
    
    if (situation === 'show') {
        element.style.display = 'block';
        page.classList.remove('hide');
        page.classList.add('show');
    } else if (situation === 'hide') {
        element.style.display = 'none';
        page.classList.remove('show');
        page.classList.add('hide');
    }
}

// MISSING FUNCTION: Send new content to server
async function SendLoadout(content, title = null) {
    const serverUrl = 'https://your-render-app.onrender.com'; // Replace with your actual URL
    
    try {
        const response = await fetch(`${serverUrl}/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
                ...(title && { 'X-Entry-Title': title })
            },
            body: content
        });

        if (!response.ok) {
            displayError("SL-001"); // Failed to save to server
            throw new Error(`Server responded with ${response.status}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('SendLoadout error:', error);
        displayError("SL-002"); // Network error during save
        throw error;
    }
}

// Get entries from server
async function GetLoadout(id) {
    const serverUrl = 'https://your-render-app.onrender.com'; // Replace with your actual URL
    const url = id ? `${serverUrl}/entries/${id}` : `${serverUrl}/entries`;
    const specificErrorCodeBase = id ? "GL-002" : "GL-001";
    const jsonErrorCode = id ? "GL-004" : "GL-003";

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            displayError(specificErrorCodeBase);
            throw new Error(`Server responded with ${res.status}`);
        }

        try {
            return await res.json();
        } catch (jsonErr) {
            displayError(jsonErrorCode);
            throw jsonErr;
        }
    } catch (err) {
        if (!err.message.startsWith("Server responded with")) {
            displayError(specificErrorCodeBase);
        }
        throw err;
    }
}

// Get full content from server
async function GetLoadoutContent(id, title) {
    const serverUrl = 'https://your-render-app.onrender.com'; // Replace with your actual URL
    id = id || '';
    title = title || '';

    if (id === '' && title === '') {
        displayError("GLC-001");
        return null;
    }
    if (id && isNaN(parseInt(id))) {
        displayError("GLC-002");
        return null;
    }
    if (title && typeof title !== 'string') {
        displayError("GLC-003");
        return null;
    }

    let driveFileId;

    try {
        if (id !== '') {
            // Get entry metadata to find the Google Drive file ID
            const load = await GetLoadout(id);
            if (!load || !load.filename) {
                displayError("GLC-006");
                return null;
            }
            driveFileId = load.filename; // This is the Google Drive file ID
        } else if (title) {
            const allEntries = await GetLoadout();
            const entry = allEntries.find(e => e.title === title);
            if (!entry || !entry.filename) {
                displayError("GLC-004");
                return null;
            }
            driveFileId = entry.filename;
        }

        if (!driveFileId) {
            return null;
        }
        
        // Use the corrected endpoint that matches your server.js
        const resp = await fetch(`${serverUrl}/load/${driveFileId}`);
        if (!resp.ok) {
            displayError("GLC-005");
            return null;
        }
        return await resp.text();

    } catch (err) {
        if (err instanceof TypeError) {
            displayError("GLC-007");
        } else {
            console.error("GetLoadoutContent encountered an issue:", err);
        }
        return null;
    }
}

// Update content on server
async function updateLoadoutContent(id, newTextContent) {
    const serverUrl = 'https://your-render-app.onrender.com'; // Replace with your actual URL
    
    try {
        const response = await fetch(`${serverUrl}/update/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: newTextContent
        });

        if (!response.ok) {
            displayError("ULC-001");
            try {
                const errData = await response.json();
                if (errData && errData.error) {
                    console.warn("Server error details on update:", errData.error);
                    displayError("ULC-002");
                }
            } catch (jsonErr) {
                displayError("ULC-003");
            }
            return false;
        }
        return true;
    } catch (err) {
        displayError("ULC-001");
        return false;
    }
}

// Test function for loading data
async function loadAndUseData() {
    try {
        const entries = await GetLoadout();
        if (entries) console.log("All Entries:", entries);

        const singleEntry = await GetLoadout(1);
        if (singleEntry) console.log("Single Entry (ID 1):", singleEntry);

    } catch (err) {
        console.error('loadAndUseData failed overall:', err);
    }
}

// Make everything available globally
window.IdeaBoxManager = IdeaBoxManager;
window.SendLoadout = SendLoadout;
window.GetLoadout = GetLoadout;
window.GetLoadoutContent = GetLoadoutContent;
window.updateLoadoutContent = updateLoadoutContent;
window.loadAndUseData = loadAndUseData;
window.ConfigInfoPage = ConfigInfoPage;
