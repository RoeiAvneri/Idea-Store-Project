class IdeaBoxManager {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            displayError("IBM-001"); // Container not found
            // No return here, let it fail later if methods are called,
            // or throw new Error after displayError if it should halt.
        }
        this.ideas = new Map(); // Map of id -> element
        this.nextId = 1; // For local client-side ID generation if needed before server ID
    }

    __DEV_LEVEL_pre_loading_box_scanner() {
        if (!this.container) {
             // IBM-001 would have been shown by constructor
            return;
        }
        
        const existingIdeas = this.container.querySelectorAll(".idea-content");
        let maxId = 0;
        existingIdeas.forEach((el) => {
            const idStr = el.dataset.ideaId || el.dataset.localId; // Prefer localId if it exists
            const id = parseInt(idStr);
            if (!isNaN(id)) {
                this.ideas.set(id, el);
                if (id > maxId) maxId = id;
            }
        });
        this.nextId = maxId + 1;
    }

    // localId is purely for client-side tracking before/without a server ID
    addIdea(title, description, serverId = null, localId = null) {
        if (!this.container) {
            displayError("IBM-001"); // Container not available (already handled by constructor ideally)
            return null;
        }

        const currentId = localId || this.nextId++;

        if (!title || title.trim() === "" || title === "undefined") {
            displayError("IBM-002"); // Title cannot be empty or undefined
            return null; // Indicate failure
        }

        if (!description || description.trim() === "" || description === "undefined") {
            description = "No description provided."; // Default, not an error
        }

        const ideaElement = document.createElement("div");
        ideaElement.classList.add("idea-content");
        ideaElement.dataset.localId = currentId; // Use localId for map key and internal reference
        if (serverId) {
            ideaElement.dataset.serverId = serverId;
        }
        ideaElement.dataset.ideaTitle = title;
        ideaElement.dataset.ideaDescription = description; // Store initial full description if different from snippet

        const topMenu = document.createElement("div");
        topMenu.classList.add("box_top_menu");

        const topRight = document.createElement("div");
        topRight.classList.add("box_top_menu_right");

        const closeBtn = document.createElement("button");
        closeBtn.classList.add("remove-idea-button");
        closeBtn.textContent = "X";
        closeBtn.type = "button";
        closeBtn.setAttribute('aria-label', 'Delete idea');

        topRight.appendChild(closeBtn);
        topMenu.appendChild(topRight);

        const contentBox = document.createElement("div");
        contentBox.classList.add("box_content");

        const h2 = document.createElement("h2");
        h2.textContent = title;

        const p = document.createElement("p");
        // Description for display might be a snippet
        p.textContent = description.length > 100 ? description.substring(0, 97) + "..." : description;

        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("idea-button"); // For "View Details"
        button.textContent = "View Details";
        button.addEventListener('click', () => {
            // Assuming showInfoPage is globally available from logic_home.js or similar
            // It would typically use serverId to fetch full content.
            if (typeof ConfigInfoPage === 'function' && typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
                 // This is a simplified call, showInfoPage needs context (e.g. serverId)
                 // The actual showing is now handled by event listener in logic_home.js
                 // console.log(`View details for localId: ${currentId}, serverId: ${serverId}`);
            } else {
                displayError("IBM-003"); // Dependency function missing (ConfigInfoPage)
            }
        });

        contentBox.appendChild(h2);
        contentBox.appendChild(p);
        contentBox.appendChild(button);

        ideaElement.appendChild(topMenu);
        ideaElement.appendChild(contentBox);

        this.ideas.set(currentId, ideaElement);
        this.container.appendChild(ideaElement);

        return currentId;
    }

    // id here refers to localId
    setContent(localId, title, description) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) {
            displayError("IBM-004"); // Idea with ID not found
            return false;
        }

        const h2 = idea.querySelector(".box_content h2");
        const p = idea.querySelector(".box_content p");

        if (h2 && title) h2.textContent = title;
        if (p && description) {
            // Update displayed description snippet
            p.textContent = description.length > 100 ? description.substring(0, 97) + "..." : description;
        }


        if (title) idea.dataset.ideaTitle = title;
        if (description) idea.dataset.ideaDescription = description; // Store full description

        return true;
    }

    // id here refers to localId
    getContent(localId) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) return null;

        return {
            localId: parseInt(idea.dataset.localId),
            serverId: idea.dataset.serverId || null,
            title: idea.dataset.ideaTitle,
            description: idea.dataset.ideaDescription // Return full stored description
        };
    }

    getLastLocalId() {
        if (this.ideas.size === 0) return null;
        // nextId is already 1 more than the last assigned localId
        return this.nextId - 1;
    }
    
    // id here refers to localId
    appendContent(localId, extraText) {
        const idea = this.ideas.get(parseInt(localId));
        if (!idea) {
            displayError("IBM-005"); // Idea with ID not found
            return false;
        }

        const p = idea.querySelector(".box_content p");
        if (p) {
            const fullDescription = idea.dataset.ideaDescription + ` ${extraText}`;
            idea.dataset.ideaDescription = fullDescription; // Update full description
            // Update displayed snippet
            p.textContent = fullDescription.length > 100 ? fullDescription.substring(0, 97) + "..." : fullDescription;
        }
        return true;
    }

    // id here refers to localId
    removeIdeaByLocalId(localId) {
        const numId = parseInt(localId);
        if (isNaN(numId)) {
            displayError("IBM-006"); // Invalid ID provided
            return false;
        }

        const element = this.ideas.get(numId);
        if (element) {
            // Dispatch custom event with localId and serverId if available
            document.body.dispatchEvent(new CustomEvent("ideaRemoved", { 
                detail: { localId: numId, serverId: element.dataset.serverId } 
            }));
            
            element.remove();
            this.ideas.delete(numId);
            
            // console.log(`Idea with local ID ${numId} removed successfully from UI.`); // For debugging
            return true;
        } else {
            displayError("IBM-007"); // Idea with ID not found
            return false;
        }
    }

    getAllIdeas() { // Returns data of all ideas managed locally
        return Array.from(this.ideas.values()).map(element => ({
            localId: parseInt(element.dataset.localId),
            serverId: element.dataset.serverId || null,
            title: element.dataset.ideaTitle,
            description: element.dataset.ideaDescription
        }));
    }

    clear() {
        if (!this.container && this.ideas.size > 0) {
             // IBM-001 might have been shown; still, trying to clear without container is problematic
             console.warn("IdeaBoxManager: Attempting to clear ideas but container is invalid.");
        }
        this.ideas.forEach((element) => {
            element.remove();
        });
        this.ideas.clear();
        this.nextId = 1; // Reset local ID counter
    }
}

function ConfigInfoPage(elementId, situation) {
    const element = document.getElementById(elementId); // e.g. 'overlayBackground'
    const page = document.querySelector('.idea-bodyOfInformation-page'); // The modal content itself
    
    if (!element || !page) {
        displayError("CFG-001"); // Required elements not found
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

async function SendLoadout(title, content) {
    // Parameter check is now done by the caller which uses SL-003
    const responseElement = document.getElementById('response'); // Assume it exists

    try {
        const res = await fetch('http://https://idea-store-project.onrender.com:3000/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain', // Server expects title in query, content in body
                'X-Entry-Title': encodeURIComponent(title) // Send title via header as an example, adjust if server expects query param
            },
            body: content
        });

        if (!res.ok) {
            displayError("SL-004"); // POST request failed on server
            if (responseElement) responseElement.innerText = '❌ Error saving idea (Server).';
            return; // Exit on server error
        }

        try {
            const data = await res.json();
            if (responseElement) {
                responseElement.innerText =
                    `✅ Saved as ${data.filename} (Title: "${data.title}")`;
            }
            // Redirect to home page after successful save
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        } catch (jsonErr) {
            displayError("SL-002"); // Response not valid JSON
            if (responseElement) responseElement.innerText = '❌ Error saving idea (Bad Response).';
        }
    } catch (err) {
        displayError("SL-001"); // Failed to send POST request (network error)
        if (responseElement) responseElement.innerText = '❌ Error saving idea (Network).';
    }
}

async function GetLoadout(id) {
    const url = id ? `http://https://idea-store-project.onrender.com:3000/entries/${id}` : 'http://https://idea-store-project.onrender.com:3000/entries';
    const specificErrorCodeBase = id ? "GL-002" : "GL-001"; // GL-002 for single, GL-001 for list
    const jsonErrorCode = id ? "GL-004" : "GL-003";

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            displayError(specificErrorCodeBase); // Failed to fetch (specific or list)
            throw new Error(`Server responded with ${res.status}`); // Throw to be caught by caller
        }

        try {
            return await res.json();
        } catch (jsonErr) {
            displayError(jsonErrorCode); // Response not valid JSON
            throw jsonErr; // Re-throw to be caught by caller
        }
    } catch (err) {
        // If not already one of our specific errors, it's a network one
        if (err.message.startsWith("Server responded with")) {
             // displayError was already called for !res.ok
        } else {
            displayError(specificErrorCodeBase); // Covers network errors too for simplicity here
        }
        throw err; // Re-throw to be caught by caller or general handler
    }
}


async function GetLoadoutContent(id, title) {
    id = id || '';
    title = title || '';

    if (id === '' && title === '') {
        displayError("GLC-001"); // Neither ID nor title provided
        return null; // Return null or throw to indicate failure clearly
    }
    if (id && isNaN(parseInt(id))) {
        displayError("GLC-002"); // ID is not a number
        return null;
    }
    if (title && typeof title !== 'string') {
        displayError("GLC-003"); // Title is not a string
        return null;
    }

    let file_load;

    try {
        if (id !== '') { // Fetch by ID
            const load = await GetLoadout(id);
            if (!load || !load.filename) {
                displayError("GLC-006"); // Failed to get entry metadata (e.g. GetLoadout failed or returned bad data)
                return null;
            }
            file_load = load.filename;
        } else if (title) { // Fetch by title (implies id === '')
            const allEntries = await GetLoadout(); // Fetches all entries
            const entry = allEntries.find(e => e.title === title);
            if (!entry || !entry.filename) {
                displayError("GLC-004"); // No entry found by title (or entry malformed)
                return null;
            }
            file_load = entry.filename;
        }

        if (!file_load) {
             // Errors displayed above should cover this path.
            return null;
        }
        
        const resp = await fetch(`http://https://idea-store-project.onrender.com:3000/load/${file_load}`);
        if (!resp.ok) {
            displayError("GLC-005"); // Failed to fetch file content (server error)
            return null;
        }
        return await resp.text();

    } catch (err) {
        // Errors from GetLoadout (GL-001, GL-002 etc) will be caught here
        // If it's a direct fetch error for /load/
        if (err instanceof TypeError) { // typically network errors from fetch
            displayError("GLC-007"); // Network error fetching file content
        } else {
            // This will catch errors propagated from GetLoadout or other unexpected issues
            // displayError("GEN-001"); // General async error in this function
            // Errors from GetLoadout should have already called displayError.
            console.error("GetLoadoutContent encountered an issue:", err)
        }
        return null;
    }
}


async function updateLoadoutContent(id, newTextContent) {
  try {
    const response = await fetch(`http://https://idea-store-project.onrender.com:3000/update/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: newTextContent
    });

    if (!response.ok) {
      displayError("ULC-001"); // PUT request to update failed
      try {
        const errData = await response.json();
        if (errData && errData.error) {
          // Optional: Add more detail if server sends specific error message
          // This could be a new error code or an enhancement to ULC-002
          console.warn("Server error details on update:", errData.error);
          displayError("ULC-002"); // Server returned error payload
        }
      } catch (jsonErr) {
        displayError("ULC-003"); // Update error response not valid JSON
      }
      return false;
    }
    return true;
  } catch (err) {
    displayError("ULC-001"); // Treat network errors also as ULC-001 (general PUT failure)
    return false;
  }
}

async function loadAndUseData() {
    try {
        const entries = await GetLoadout(); // all entries
        if (entries) console.log("All Entries:", entries);

        const singleEntry = await GetLoadout(1); // entry with ID 1
        if (singleEntry) console.log("Single Entry (ID 1):", singleEntry);

    } catch (err) {
        // GetLoadout already calls displayError for its specific issues (GL-001, GL-002, etc.)
        // This catch is for any other unexpected error during the process or if GetLoadout re-throws.
        // If GetLoadout handles its errors and returns null/throws, this might not always need a generic GEN-001.
        // console.error('loadAndUseData failed overall:', err); // Keep for debugging
        // displayError("GEN-001"); // A general "something went wrong here"
    }
}

// The global RaiseError function is superseded by displayError from ErrorHandler.js
// So it's removed from here.

// Make class available globally
window.IdeaBoxManager = IdeaBoxManager;

window.SendLoadout = SendLoadout;
window.GetLoadout = GetLoadout;
window.GetLoadoutContent = GetLoadoutContent;
window.updateLoadoutContent = updateLoadoutContent;
window.loadAndUseData = loadAndUseData;

window.ConfigInfoPage = ConfigInfoPage;
