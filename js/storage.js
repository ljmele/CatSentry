// storage.js

const GH_API_BASE = "https://api.github.com";

/**
 * Manages syncing data with a JSON file in the GitHub Repository.
 */
class GitHubStorage {
    constructor() {
        this.config = JSON.parse(localStorage.getItem('catSentry_gh_config')) || {
            owner: '',
            repo: '',
            token: '',
            path: 'cat_data.json'
        };
    }

    get isConfigured() {
        return this.config.owner && this.config.repo && this.config.token;
    }

    saveConfig(owner, repo, token) {
        this.config = { ...this.config, owner, repo, token };
        localStorage.setItem('catSentry_gh_config', JSON.stringify(this.config));
    }

    /**
     * Pushes the current local history to GitHub.
     * @param {Array} data - The array of event objects.
     */
    async pushData(data) {
        if (!this.isConfigured) return { success: false, error: "GitHub not configured" };

        try {
            updateLog("Syncing to GitHub...");

            // 1. Get the current file SHA (needed for update)
            const currentFile = await this.getFileInfo();
            const sha = currentFile ? currentFile.sha : null;

            // 2. Prepare Payload
            const contentJson = JSON.stringify(data, null, 2);
            // GitHub requires Base64 content. 
            // btoa() handles ASCII. For Unicode (emojis), we need this trick:
            const contentBase64 = btoa(unescape(encodeURIComponent(contentJson)));

            const body = {
                message: "Update CatSentry Data [Auto-Sync]",
                content: contentBase64,
                committer: {
                    name: "CatSentry Bot",
                    email: "bot@catsentry.local"
                }
            };

            if (sha) body.sha = sha;

            // 3. Send PUT request
            const url = `${GH_API_BASE}/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.path}`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) throw new Error(`GitHub API Error: ${response.status}`);
            
            updateLog("Cloud save complete! ✅");
            return { success: true };

        } catch (error) {
            console.error(error);
            updateLog("Cloud sync failed: " + error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Pulls the data from GitHub and returns it.
     */
    async pullData() {
        if (!this.isConfigured) return null;

        try {
            updateLog("Checking GitHub for data...");
            const fileData = await this.getFileInfo();
            
            if (!fileData) {
                updateLog("No cloud data found. Starting fresh.");
                return [];
            }

            // Decode content
            // atob() decodes Base64
            const jsonString = decodeURIComponent(escape(window.atob(fileData.content)));
            const data = JSON.parse(jsonString);
            
            updateLog(`Loaded ${data.length} events from cloud! ☁️`);
            return data;

        } catch (error) {
            console.error(error);
            updateLog("Cloud load failed: " + error.message);
            return null;
        }
    }

    async getFileInfo() {
        const url = `${GH_API_BASE}/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.path}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.status === 404) return null; // File doesn't exist yet
        if (!response.ok) throw new Error("Failed to fetch file info");
        
        return await response.json();
    }
}

// Global Instance
const ghStorage = new GitHubStorage();
