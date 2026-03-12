// ble.js - BLE connection and event ingestion

window.App = window.App || {};
App.ble = App.ble || {};

App.ble.autoReconnectEnabled = true;
App.ble.maxReconnectAttempts = 3;
App.ble.reconnectAttempt = 0;
App.ble.reconnectTimer = null;

App.ble.setAutoReconnect = function setAutoReconnect(enabled) {
    App.ble.autoReconnectEnabled = !!enabled;
    App.ui.showToast(
        `Auto-reconnect ${App.ble.autoReconnectEnabled ? "enabled" : "disabled"}.`,
        App.ble.autoReconnectEnabled ? "info" : "warning"
    );
};

App.ble.getFriendlyBleError = function getFriendlyBleError(error) {
    const name = error && error.name ? error.name : "UnknownError";

    if (name === "NotFoundError") {
        return "No CatSentry device selected. Make sure it is powered and nearby.";
    }
    if (name === "SecurityError") {
        return "Bluetooth access is blocked. Allow Bluetooth permissions for this site.";
    }
    if (name === "NetworkError") {
        return "Connection lost. Trying to recover BLE link.";
    }

    return `Bluetooth error: ${name}`;
};

App.ble.scheduleReconnect = function scheduleReconnect() {
    if (!App.ble.autoReconnectEnabled) return;
    if (!App.state.device) return;
    if (App.state.device.gatt && App.state.device.gatt.connected) return;
    if (App.ble.reconnectAttempt >= App.ble.maxReconnectAttempts) {
        App.ui.showToast("Auto-reconnect stopped after max attempts.", "warning");
        return;
    }

    const delayMs = 1500 * Math.pow(2, App.ble.reconnectAttempt);
    App.ble.reconnectAttempt += 1;

    if (App.ble.reconnectTimer) {
        clearTimeout(App.ble.reconnectTimer);
    }

    App.ui.updateLog(`Auto-reconnect attempt ${App.ble.reconnectAttempt}/${App.ble.maxReconnectAttempts} in ${Math.round(delayMs / 1000)}s...`);
    App.ble.reconnectTimer = setTimeout(() => {
        App.ble.connectToCat({ reuseDevice: true });
    }, delayMs);
};

App.ble.connectToCat = async function connectToCat(options = {}) {
    const reuseDevice = !!options.reuseDevice;

    try {
        App.ui.updateLog("Scanning for CatSentry...");

        if (!reuseDevice || !App.state.device) {
            App.state.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: "CatSentry" }],
                optionalServices: [App.config.serviceUUID]
            });
        }

        App.state.device.addEventListener("gattserverdisconnected", App.ble.onDisconnected);

        App.ui.updateLog("Connecting to GATT Server...");
        App.state.server = await App.state.device.gatt.connect();
        App.state.service = await App.state.server.getPrimaryService(App.config.serviceUUID);

        App.state.characteristic = await App.state.service.getCharacteristic(App.config.charUUID);
        await App.state.characteristic.startNotifications();
        App.state.characteristic.addEventListener("characteristicvaluechanged", App.ble.handleNotifications);

        App.state.historyChar = await App.state.service.getCharacteristic(App.config.historyUUID);
        await App.state.historyChar.startNotifications();
        App.state.historyChar.addEventListener("characteristicvaluechanged", App.ble.handleHistoryData);

        App.ui.updateLog("Listeners ready.");

        const timeChar = await App.state.service.getCharacteristic(App.config.timeUUID);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const timeBuffer = new Uint32Array([nowSeconds]);

        App.ui.updateLog(`Sending Time Sync: ${nowSeconds} (${new Date().toLocaleString()})`);
        await timeChar.writeValue(timeBuffer);

        document.getElementById("connectBtn").innerText = "✅ Connected";
        document.getElementById("connectBtn").disabled = true;
        document.getElementById("statusLine").innerHTML = '<span class="status-dot online" id="statusDot"></span> Online';
        App.ui.updateLog("Link established! Waiting for history...");
        App.ble.reconnectAttempt = 0;
        App.ui.showToast("Bluetooth connected.", "success");
    } catch (error) {
        const friendly = App.ble.getFriendlyBleError(error);
        App.ui.updateLog(friendly);
        App.ui.showToast(friendly, "error", 5000);

        document.getElementById("connectBtn").innerText = "📡 Connect";
        document.getElementById("connectBtn").disabled = false;
        document.getElementById("statusLine").innerHTML = '<span class="status-dot" id="statusDot"></span> Disconnected';

        if (reuseDevice || (error && error.name === "NetworkError")) {
            App.ble.scheduleReconnect();
        }
    }
};

App.ble.handleNotifications = function handleNotifications(event) {
    const value = event.target.value;
    const decoder = new TextDecoder("utf-8");
    const message = decoder.decode(value).trim();

    const timestampStr = new Date().toLocaleTimeString();
    App.ui.updateLog(`[${timestampStr}] RAW EVENT: ${message}`);

    const type = message === "ENTRY" ? 1 : message === "EXIT" ? 2 : 0;

    if (type > 0) {
        App.addEvent(Date.now(), type);
        App.saveData();
        App.updateUI();

        if (ghStorage.isConfigured) {
            ghStorage.pushData(App.state.eventHistory);
        }
    }
};

App.ble.handleHistoryData = function handleHistoryData(event) {
    const value = event.target.value;

    if (value.byteLength >= 5) {
        const dataView = new DataView(value.buffer);
        const tsSec = dataView.getUint32(0, true);
        const type = dataView.getUint8(4);
        const tsMs = tsSec * 1000;

        if (App.isValidEvent(tsMs, type)) {
            if (App.addEvent(tsMs, type)) {
                App.state.historyEventCount++;
            }
        } else {
            App.ui.updateLog(`⚠️ Rejected invalid history event (ts: ${tsSec})`);
        }

        if (App.state.saveTimer) clearTimeout(App.state.saveTimer);
        App.state.saveTimer = setTimeout(() => {
            App.saveData();
            App.updateUI();

            if (ghStorage.isConfigured) {
                ghStorage.pushData(App.state.eventHistory);
            }

            App.ui.updateLog(`History sync finished. Loaded ${App.state.historyEventCount} new events.`);
            App.state.historyEventCount = 0;
        }, 500);
    }
};

App.ble.onDisconnected = function onDisconnected() {
    App.ui.updateLog("Device Disconnected.");
    App.ui.showToast("BLE disconnected. Attempting auto-reconnect...", "warning");
    document.getElementById("connectBtn").innerText = "📡 Connect";
    document.getElementById("connectBtn").disabled = false;
    document.getElementById("statusLine").innerHTML = '<span class="status-dot" id="statusDot"></span> Disconnected';

    App.ble.scheduleReconnect();
};

window.connectToCat = App.ble.connectToCat;
window.handleNotifications = App.ble.handleNotifications;
window.handleHistoryData = App.ble.handleHistoryData;
window.onDisconnected = App.ble.onDisconnected;
window.setBleAutoReconnect = App.ble.setAutoReconnect;
