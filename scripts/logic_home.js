// Initialize the manager
// Ensure ErrorHandler.js and script.js (for IdeaBoxManager) are loaded before this.
const manager = new IdeaBoxManager("#ideabox-wrapper");

// Global RaiseError is removed, use displayError(code) from ErrorHandler.js

// Function to configure info page visibility (e.g., for preview modal)

// Search function
function searchFor(value) {
    const searchValue = value.toLowerCase().trim();
    // Use manager.getAllIdeas() if DOM might be out of sync, or querySelectorAll if DOM is source of truth
    const ideasElements = document.querySelectorAll('#ideabox-wrapper .idea-content'); 
    
    ideasElements.forEach(ideaElement => {
        const title = (ideaElement.dataset.ideaTitle || '').toLowerCase();
        // The p element contains the snippet. For searching full desc, need data attribute.
        const description = (ideaElement.dataset.ideaDescription || '').toLowerCase(); 
        
        if (searchValue === '' || title.includes(searchValue) || description.includes(searchValue)) {
            ideaElement.style.display = 'block';
        } else {
            ideaElement.style.display = 'none';
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!manager.container) {
        // IBM-001 already displayed by IdeaBoxManager constructor if #ideabox-wrapper is missing.
        displayError("GEN-002"); // Or a specific "Homepage cannot initialize"
        return;
    }
    // Scan for any static ideas (less common if dynamically loaded)
    manager.__DEV_LEVEL_pre_loading_box_scanner(); 
    
    try {
        const entries = await GetLoadout(); // Get all entries from server
        
        if (!entries) {
            // GetLoadout should display its own errors (e.g., GL-001, GL-003)
            // displayError(100); // Redundant if GetLoadout handles its errors
            return; // Stop if no entries could be fetched
        }
        
        manager.clear(); // Clear any scanned or pre-existing local ideas before loading from server
        
        for (const entry of entries) {
            let description = "No description available.";
            try {
                const content = await GetLoadoutContent(entry.id, null); // Fetch by ID is more robust
                if (content) {
                    // Extract a simple description from markdown content
                    // Remove markdown headers, list markers, etc. for a cleaner snippet.
                    const plainText = content.replace(/^#+\s*.*$/gm, '') // Remove headers
                                           .replace(/^[*-]\s+/gm, '')     // Remove list markers
                                           .replace(/[`*_~[\]()#+-]/g, '') // Remove other common markdown chars
                                           .split('\n').map(s => s.trim()).filter(Boolean).join(' ').trim();
                    description = plainText.slice(0, 150) + (plainText.length > 150 ? '...' : '');
                } else {
                    // GetLoadoutContent would display errors like GLC-005 if fetch failed
                    // If content is legitimately null/empty from server, "No description available." is fine.
                    // displayError("LH-001"); // Failed to load content for an idea card.
                }
            } catch (contentError) {
                 displayError("LH-001"); // General error for loading content for a card.
                 // Log original error for more details if needed
                 console.error(`Content load error for entry ID ${entry.id}:`, contentError);
            }
            
            // Add idea with server ID, manager generates a localId
            manager.addIdea(entry.title || 'Untitled', description, entry.id);
        }
    } catch (error) {
        // This catches errors from the initial GetLoadout() or if entries array processing fails unexpectedly
        // displayError(100); // "Failed to fetch to server" - this is too generic now
        // Errors from GetLoadout (GL-001, etc.) are displayed by GetLoadout itself.
        // This remains a fallback.
        console.error('Error during initial loading of ideas:', error);
    }

    // Event delegation for delete buttons
    document.body.addEventListener('click', async function (event) {
        if (event.target.classList.contains('remove-idea-button')) {
            const ideaElement = event.target.closest('.idea-content');
            if (!ideaElement) return;

            const serverId = ideaElement.dataset.serverId;
            const localId = ideaElement.dataset.localId; // Use localId for manager
            
            if (!serverId) {
                displayError("LH-002"); // Server ID not found for deletion
                // If no serverId, but localId exists, maybe it's a local-only unsaved idea?
                // For this app, assume all displayed items on home are synced.
                return;
            }

            if (!confirm('Are you sure you want to delete this idea? This action cannot be undone.')) {
                return;
            }

            try {
                const res = await fetch(`http://localhost:3000/delete/${serverId}`, { 
                    method: 'DELETE' 
                });

                if (res.ok) {
                    // Successfully deleted on server
                    if (localId) manager.removeIdeaByLocalId(localId);
                    else ideaElement.remove(); // Fallback if no localId known for some reason
                    // Optionally show a success message (e.g., using a toast notification system)
                } else {
                    displayError("DL-001"); // Delete request failed on server
                    try {
                        const errorData = await res.json();
                        console.warn('Server error details on delete:', errorData.error);
                    } catch (jsonErr) {
                        displayError("DL-003"); // Delete error response not JSON
                    }
                }
            } catch (err) {
                displayError("DL-002"); // Network error during delete
            }
        }
    });

    // Event delegation for "View Details" buttons
    document.body.addEventListener('click', async function (e) {
        if (e.target.classList.contains('idea-button')) {
            const ideaDiv = e.target.closest('.idea-content');
            if (!ideaDiv) return;

            const serverId = ideaDiv.dataset.serverId;
            // const localId = ideaDiv.dataset.localId; // Available if needed

            if (!serverId) {
                displayError("LH-002"); // Or a new "LH-004: Missing server ID for preview"
                return;
            }

            const previewContainer = document.querySelector('.markdown-preview.markdown-body.preview-mode');
            if (!previewContainer) {
                displayError("GEN-002"); // Preview container DOM element missing
                return;
            }
            
            previewContainer.innerHTML = "<em>Loading content...</em>"; // Show loading state
            ConfigInfoPage('overlayBackground', 'show'); // Show modal structure

            try {
                const markdownContent = await GetLoadoutContent(serverId, null); // Fetch by serverId

                if (markdownContent === null) { // Indicates fetch failure handled by GetLoadoutContent
                    previewContainer.innerHTML = "<em>Failed to load content.</em>";
                    // displayError("LH-003") could be called here or rely on GetLoadoutContent's errors.
                    // GLC-005 (server error) or GLC-007 (network error) might have been shown.
                    // If content is simply empty, GLC-004 might be relevant if fetched by title, or it's just empty.
                    return;
                }
                 if (markdownContent.trim() === "") {
                    displayError("LH-003"); // No content found for preview (empty entry)
                    previewContainer.innerHTML = "<em>This entry is empty.</em>";
                    previewContainer.setAttribute('data-server-id', serverId); // Still set ID for edit button
                    return;
                }

                
                if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
                     marked.setOptions({ // Ensure marked is configured
                        pedantic: false, gfm: true, breaks: false, sanitize: false,
                        smartLists: true, smartypants: false, xhtml: false,
                        highlight: function (code, lang) {
                            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
                        }
                    });
                    previewContainer.innerHTML = marked.parse(markdownContent);
                } else {
                    previewContainer.innerHTML = "<pre>" + markdownContent.replace(/</g, "<").replace(/>/g, ">") + "</pre>"; // Plain text fallback
                    console.warn("Marked.js or Highlight.js missing for preview rendering.");
                }
                previewContainer.setAttribute('data-server-id', serverId); // For the edit button
            } catch (err) {
                // Errors from GetLoadoutContent (GLC-xxx) should be displayed by it.
                // This catch is a fallback.
                displayError("GEN-001"); // General failure loading preview content
                if (previewContainer) previewContainer.innerHTML = "<em>Error loading content. See console.</em>";
            }
        }
    });

    // Event listener for the Edit button within the preview modal
    document.addEventListener('click', function(e) {
        const button = e.target.closest('.idea-bodyOfInformation-edit-button');
        if (!button) return;

        const container = button.closest('.idea-bodyOfInformation-page');
        if (!container) { displayError("GEN-002"); return; } // Modal structure problem

        const ideaPreviewDiv = container.querySelector('.markdown-preview.markdown-body.preview-mode');
        if (!ideaPreviewDiv) { displayError("GEN-002"); return; } // Preview content area missing

        const serverId = ideaPreviewDiv.getAttribute('data-server-id');
        if (!serverId) {
            displayError("LH-002"); // Or a new specific "Missing server ID for edit redirect"
            return;
        }
        
        window.location.href = `create_new_idea.html#load=true&entry=${serverId}§ion=content`;
    });

    const addIdeaButton = document.getElementById('add-idea-button');
    if (addIdeaButton) {
        addIdeaButton.addEventListener('click', function() {
            window.location.href = 'create_new_idea.html';
        });
    } else {
        // Use a more appropriate error or just a warning if button is optional
        console.warn("'add-idea-button' not found."); 
        // displayError("LH-XXX"); // Create a new error code if this is critical
    }

    // Handle overlay/modal close
    const overlayBg = document.getElementById('overlayBackground');
    const closeButton = document.getElementById('closeButton'); // In the modal

    if (overlayBg) overlayBg.addEventListener('click', function() { ConfigInfoPage('overlayBackground', 'hide'); });
    if (closeButton) closeButton.addEventListener('click', function() { ConfigInfoPage('overlayBackground', 'hide'); });
    
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            const page = document.querySelector('.idea-bodyOfInformation-page');
            if (page && page.classList.contains('show')) {
                 ConfigInfoPage('overlayBackground', 'hide');
            }
        }
    });

    // Search UI handlers
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('ideasSearch');

    if (searchButton && searchInput) {
        searchButton.addEventListener('click', function () {
            searchFor(searchInput.value);
        });
        searchInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                searchFor(this.value);
            }
        });
    } else {
        console.warn("Search UI elements (button or input) not found."); // Non-critical warning
    }
});
