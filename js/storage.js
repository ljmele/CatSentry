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

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async withRetry(operation, options = {}) {
        const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
        const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 500;
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation(attempt);
            } catch (error) {
                lastError = error;
                if (attempt === maxRetries) break;
                const waitMs = baseDelayMs * Math.pow(2, attempt);
                await this.sleep(waitMs);
            }
        }

        throw lastError;
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
            const currentFile = await this.withRetry(() => this.getFileInfo(), {
                maxRetries: 2,
                baseDelayMs: 600
            });
            const sha = currentFile ? currentFile.sha : null;

            // 2. Prepare Payload
            const contentJson = JSON.stringify(data, null, 2);
            // GitHub requires Base64 content. 
            // btoa() handles ASCII. For Unicode (emojis), we need this trick:
            const contentBase64 = btoa(unescape(encodeURIComponent(contentJson)));

            const body = {
                message: "Update CatSentry Data [Auto-Sync] [skip ci]",
                content: contentBase64,
                committer: {
                    name: "CatSentry Bot",
                    email: "bot@catsentry.local"
                }
            };

            if (sha) body.sha = sha;

            // 3. Send PUT request
            const url = `${GH_API_BASE}/repos/${this.config.owner}/${this.config.repo}/contents/${this.config.path}`;
            const response = await this.withRetry(async () => {
                const res = await fetch(url, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${this.config.token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    body: JSON.stringify(body)
                });

                if (res.status >= 500 || res.status === 429) {
                    throw new Error(`GitHub temporary error: ${res.status}`);
                }

                return res;
            }, {
                maxRetries: 2,
                baseDelayMs: 600
            });

            if (!response.ok) throw new Error(`GitHub API Error: ${response.status}`);
            
            updateLog("Cloud save complete! ✅");
            return { success: true };

        } catch (error) {
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
            const fileData = await this.withRetry(() => this.getFileInfo(), {
                maxRetries: 2,
                baseDelayMs: 600
            });
            
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
        
        if (!response.ok) {
            // Detailed error for debugging
            const errText = `GitHub API Error: ${response.status} ${response.statusText}`;
            if (response.status === 401) throw new Error("401 Unauthorized (Check Token)");
            if (response.status === 403) throw new Error("403 Forbidden (Token needs 'repo' scope)");
            throw new Error(errText);
        }
        
        return await response.json();
    }
}

// Global Instance
const ghStorage = new GitHubStorage();
