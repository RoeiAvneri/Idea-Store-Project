const ErrorCode = (code) => {
  const codes = {
    100: {
      title: "Failed to fetch to server",
      description: "Cannot connect to the server. Please check your network connection or server status.",
      level: "critical"
    },
    // 📤 SendLoadout(title, content)
    "SL-001": {
      title: "Failed to send POST request",
      description: "Cannot connect to the server to send data. Please check your network connection or server status.",
      level: "critical"
    },
    "SL-002": {
      title: "Response not valid JSON",
      description: "The server responded with a non-JSON payload after a POST request, causing res.json() to fail.",
      level: "warn"
    },
    "SL-003": {
      title: "Missing required parameters for save",
      description: "Either the title or content (or both) were not provided before sending the request to save.",
      level: "warn"
    },
    "SL-004": {
      title: "POST request failed on server",
      description: "The server responded with an error status (not 2xx) to the POST request.",
      level: "critical"
    },

    // 📥 GetLoadout(id)
    "GL-001": {
      title: "Failed to fetch entries list",
      description: "Could not retrieve the list of entries. Possible network/server issue or server error.",
      level: "critical"
    },
    "GL-002": {
      title: "Failed to fetch single entry",
      description: "The GET request for a specific entry (by ID) failed due to a network/server issue or server error.",
      level: "critical"
    },
    "GL-003": {
      title: "Entries list response not valid JSON",
      description: "The server responded with a non-JSON payload when fetching all entries.",
      level: "warn"
    },
    "GL-004": {
      title: "Single entry response not valid JSON",
      description: "The server responded with a non-JSON payload when fetching a single entry by ID.",
      level: "warn"
    },

    // 📄 GetLoadoutContent(id, title)
    "GLC-001": {
      title: "Neither ID nor title provided",
      description: "Both ID and title parameters are empty for GetLoadoutContent — at least one is required.",
      level: "warn"
    },
    "GLC-002": {
      title: "ID is not a number",
      description: "The provided ID for GetLoadoutContent cannot be parsed into a valid number.",
      level: "warn"
    },
    "GLC-003": {
      title: "Title is not a string",
      description: "The provided title for GetLoadoutContent is not of type string.",
      level: "warn"
    },
    "GLC-004": {
      title: "No entry found by title",
      description: "A title was given for GetLoadoutContent, but no entry matching it was found in the database.",
      level: "warn"
    },
    "GLC-005": {
      title: "Failed to fetch file content (server error)",
      description: "The fetch request to load the file content (/load/:file) failed. The server response was not OK (status not 200).",
      level: "critical"
    },
    "GLC-006": {
      title: "Failed to get entry metadata",
      description: "Could not retrieve entry details (ID or filename) needed to fetch its content. A prior GetLoadout call failed.",
      level: "critical"
    },
    "GLC-007": {
      title: "Network error fetching file content",
      description: "The fetch request to /load/:file failed due to a network or connection error before a response was received.",
      level: "critical"
    },

    // ✏️ updateLoadoutContent(id, newTextContent)
    "ULC-001": {
      title: "PUT request to update failed",
      description: "The request to update the content returned a non-OK response from the server.",
      level: "critical"
    },
    "ULC-002": {
      title: "Server returned error payload on update",
      description: "The server returned an error message in the JSON payload during an update attempt.",
      level: "warn"
    },
    "ULC-003": {
      title: "Update error response not valid JSON",
      description: "The server returned an error status during update, and its error payload was not valid JSON.",
      level: "warn"
    },

    // 🔄 General Async / DOM Failures
    "GEN-001": {
      title: "Failure in async/await block",
      description: "An unknown error occurred during an asynchronous fetch operation or related logic block.",
      level: "critical"
    },
    "GEN-002": {
      title: "Required DOM element not found",
      description: "A DOM element essential for functionality (e.g., editor input, preview area) was not found in the document.",
      level: "critical" // Changed to critical as these are usually fundamental
    },

    // IdeaBoxManager (IBM)
    "IBM-001": { title: "IdeaBoxManager container not found", description: "The specified DOM container for IdeaBoxManager does not exist.", level: "critical" },
    "IBM-002": { title: "Invalid idea title", description: "Title provided for a new idea was empty or invalid.", level: "warn" },
    "IBM-003": { title: "Dependency function missing", description: "A required function (e.g., 'showInfoPage') is not available globally for an idea box action.", level: "warn" },
    "IBM-004": { title: "Idea not found (setContent)", description: "Attempted to set content for an idea ID that does not exist in IdeaBoxManager.", level: "warn" },
    "IBM-005": { title: "Idea not found (appendContent)", description: "Attempted to append content to an idea ID that does not exist in IdeaBoxManager.", level: "warn" },
    "IBM-006": { title: "Invalid ID for removal", description: "Provided ID for idea removal was not a valid number.", level: "warn" },
    "IBM-007": { title: "Idea not found (removeIdeaById)", description: "Attempted to remove an idea by an ID that does not exist in IdeaBoxManager.", level: "warn" },

    // Config Page (CFG) - related to UI components like modals
    "CFG-001": { title: "ConfigInfoPage elements missing", description: "Required DOM elements (e.g., overlay or page container) for ConfigInfoPage are missing.", level: "warn" },

    // Logic Home (LH) - Specific errors for homepage logic
    "LH-001": { title: "Failed to load content for idea card", description: "GetLoadoutContent failed when populating an individual idea card description on the homepage.", level: "warn" },
    "LH-002": { title: "Missing server ID for delete", description: "The idea element is missing the 'data-server-id' attribute, preventing deletion.", level: "warn" },
    "LH-003": { title: "No content for preview", description: "Successfully fetched, but no content was available to display in the preview modal. The entry might be empty.", level: "warn" },

    // Delete operations (DL)
    "DL-001": { title: "Delete request failed on server", description: "The server responded with an error status (not 2xx) to the DELETE request.", level: "critical" },
    "DL-002": { title: "Network error during delete", description: "A network or connection error occurred while attempting to delete an entry.", level: "critical" },
    "DL-003": { title: "Delete error response not JSON", description: "The server returned an error status for delete, and the error payload (if any) was not valid JSON.", level: "warn" }
  };

  return codes[code] || {
    title: "Unknown Error",
    description: `An unknown error occurred (Code: ${code}).`,
    level: "critical"
  };
};


const displayError = (errorCode) => {
  const error = ErrorCode(errorCode);
  if (error.level === "warn") {
    console.warn(`Warning (${errorCode}): ${error.title} - ${error.description}`);
  } else if (error.level === "critical") {
    console.error(`Critical Error (${errorCode}): ${error.title} - ${error.description}`);
    // Attempt to display critical errors prominently on the page
    let errorContainer = document.getElementById('critical-error-container');
    if (!errorContainer) {
        errorContainer = document.createElement('div');
        errorContainer.id = 'critical-error-container';
        document.body.appendChild(errorContainer);
    }
    
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message'; // Existing class
    errorElement.style.backgroundColor = '#ffdddd';
    errorElement.style.border = '1px solid #ff0000';
    errorElement.style.padding = '15px';
    errorElement.style.borderRadius = '5px';
    errorElement.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    errorElement.innerHTML = `
      <h2 style="margin-top:0; color: #d8000c;">${error.title}</h2>
      <p>${error.description}</p>
      <button onclick="this.parentElement.remove()" style="padding:5px 10px; margin-top:10px;">Dismiss</button>
    `;
    errorContainer.appendChild(errorElement);
  }
};