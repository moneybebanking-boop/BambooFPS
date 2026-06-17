(async () => {
    const old = document.getElementById("fpsGame");
    if (old) old.remove();

    const container = document.createElement("div");
    container.id = "fpsGame";
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.zIndex = "999999";
    document.body.appendChild(container);

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
    document.head.appendChild(script);
    await new Promise(resolve => script.onload = resolve);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6ec6ff);

    const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1200);

    // SHARP / NON-BLURRY RENDERING
    // This makes the game render at the real screen resolution instead of stretching a low-res canvas.
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.domElement.style.width = "100vw";
    renderer.domElement.style.height = "100vh";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.imageRendering = "auto";
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);


    // SAFE STORAGE: some pages block localStorage when pasted into the console.
    // This keeps the game working by falling back to temporary memory storage.
    const memoryStorage = {};
    const SAVE_KEY = "bambooFPS_autoSave_v1";
    const NAME_KEY = "bambooFPS_playerName_v1";
    const TAKEN_NAMES_KEY = "bambooFPS_takenNames_v1";

    let currentPlayerName = "";
    let takenNames = [];

    function normalizePlayerName(name) {
        return String(name || "").trim().toLowerCase();
    }

    function isOwner() {
        return normalizePlayerName(currentPlayerName) === "justfish";
    }

    function safeLoad(key, defaultValue) {
        try {
            const raw = window.localStorage.getItem(key);
            if (raw === null || raw === undefined) return defaultValue;
            return JSON.parse(raw);
        } catch (err) {
            return Object.prototype.hasOwnProperty.call(memoryStorage, key)
                ? memoryStorage[key]
                : defaultValue;
        }
    }

    function safeSave(key, value) {
        memoryStorage[key] = value;
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            // localStorage is blocked, so this run will use memoryStorage instead.
        }
    }

    currentPlayerName = safeLoad(NAME_KEY, "");
    takenNames = safeLoad(TAKEN_NAMES_KEY, []);
    if (!Array.isArray(takenNames)) takenNames = [];

    // CUSTOM SOUND SYSTEM
    // If you are using index.html + game.js, create a folder named "sounds" beside game.js.
    // Example:
    // BambooFPS/sounds/shoot.mp3
    // BambooFPS/sounds/reload.mp3
    const soundFiles = {
        shoot: "sounds/shoot.mp3",
        reload: "sounds/reload.mp3",
        hit: "sounds/hit.mp3",
        hurt: "sounds/hurt.mp3",
        loot: "sounds/loot.mp3",
        extract: "sounds/extract.mp3",
        buy: "sounds/buy.mp3",
        sell: "sounds/sell.mp3",
        vault: "sounds/vault.mp3",
        error: "sounds/error.mp3"
    };

    const soundCache = {};
    let soundEnabled = safeLoad("bambooSoundEnabled", true);
    let soundVolume = Number(safeLoad("bambooSoundVolume", 0.55));

    function playSound(name, volume = 1) {
        if (!soundEnabled || !soundFiles[name]) return;

        try {
            if (!soundCache[name]) {
                const audio = new Audio(soundFiles[name]);
                audio.preload = "auto";
                soundCache[name] = audio;
            }

            const sound = soundCache[name].cloneNode();
            sound.volume = Math.max(0, Math.min(1, soundVolume * volume));
            sound.play().catch(() => {
                // Browsers may block sound until the player clicks once.
            });
        } catch (err) {
            // Keep the game from crashing if a sound file is missing.
        }
    }

    window.bambooSetSoundVolume = amount => {
        soundVolume = Math.max(0, Math.min(1, Number(amount) || 0));
        safeSave("bambooSoundVolume", soundVolume);
    };

    window.bambooToggleSound = () => {
        soundEnabled = !soundEnabled;
        safeSave("bambooSoundEnabled", soundEnabled);
        showCenterMessage(soundEnabled ? "Sound ON" : "Sound OFF", "#ffffff");
    };

    let gameStarted = false;
    let gameMode = "menu"; // menu, ffa, extraction
    let scoped = false;
    let health = 100;
    let kills = 0;
    let money = Number(safeLoad("bambooMoney", 500));
    let reloading = false;
    let burstFiring = false;
    let nearShop = false;
    let nearExtract = false;
    let nearLoot = null;
    let nearPurpleVault = null;
    let inVehicle = false;
    let raidActive = false;
    let extractStartTime = 0;
    let extracting = false;
    let extractTarget = null;

    const spawn = { x: 0, y: 1.7, z: 0 };
    camera.position.set(spawn.x, spawn.y, spawn.z);

    const keys = {};
    let yaw = 0;
    let pitch = 0;
    let velocityY = 0;
    let onGround = true;
    const mouseSensitivity = 0.0025;

    const worldObjects = [];
    const obstacles = [];
    const enemies = [];
    const pickups = [];
    const lootObjects = [];
    const extractZones = [];
    const shopObjects = [];
    const purpleVaults = [];

    const stash = safeLoad("bambooExtractionStash", []);
    let raidInventory = [];
    let equippedRaidItems = [];
    let initialRaidBagCount = 0;

    // LOADING SCREEN / EXTRACTION LOADOUT
    // Only these slots can be brought into an Extraction raid.
    let loadout = safeLoad("bambooExtractionLoadout", {
        helmet: null,
        chestRig: null,
        gun: null,
        bag: []
    });
    if (!Array.isArray(loadout.bag)) loadout.bag = [];

    const maxBagSlots = 12;
    let armorPoints = 0;

    // DEV MODE
    let devMode = false;
    let devFly = false;
    let devGod = false;

    const itemDefs = {
        pistol: { name: "Pistol", type: "gun", value: 75 },
        ar: { name: "AR", type: "gun", value: 220 },
        shotgun: { name: "Shotgun", type: "gun", value: 180 },
        sniper: { name: "Sniper", type: "gun", value: 300 },
        smg: { name: "SMG", type: "gun", value: 200 },
        ammo: { name: "Ammo Box", type: "ammo", value: 40 },
        medkit: { name: "Medkit", type: "heal", value: 60 },
        gold: { name: "Gold Watch", type: "sellable", value: 150 },
        phone: { name: "Phone", type: "sellable", value: 90 },
        documents: { name: "Intel Documents", type: "sellable", value: 180 },
        diamond: { name: "Diamond", type: "sellable", value: 450 },
        laptop: { name: "Encrypted Laptop", type: "sellable", value: 350 },
        armor: { name: "Armor Plate", type: "armor", value: 120 },
        helmet: { name: "Combat Helmet", type: "helmet", value: 180 },
        chestRig: { name: "Chest Rig", type: "chestRig", value: 240 },
        backpack: { name: "Raid Backpack", type: "bag", value: 160 },
        purpleKeycard: { name: "Purple Keycard", type: "keycard", value: 10000, shopPrice: 10000, rarity: "Legendary", description: "Used once to open a Purple Vault." },
        heartOfBamboo: { name: "Heart of Bamboo", type: "relic", value: 1000000, rarity: "Mythic", description: "The rarest item in Bamboo FPS. Only found inside Purple Vaults." }
    };

    const weapons = {
        pistol: { id: "pistol", name: "Pistol", damage: 1, headshotDamage: 3, magSize: 12, ammo: 12, reserve: 60, fireRate: 350, reloadTime: 1000, pellets: 1, spread: 0.006, recoil: 0.025 },
        ar: { id: "ar", name: "AR", damage: 1, headshotDamage: 3, magSize: 30, ammo: 30, reserve: 120, fireRate: 150, reloadTime: 1500, pellets: 1, spread: 0.014, auto: true, recoil: 0.016 },
        shotgun: { id: "shotgun", name: "Shotgun", damage: 1, headshotDamage: 2, magSize: 6, ammo: 6, reserve: 36, fireRate: 700, reloadTime: 1800, pellets: 7, spread: 0.08, recoil: 0.055 },
        sniper: { id: "sniper", name: "Sniper", damage: 5, headshotDamage: 10, magSize: 5, ammo: 5, reserve: 25, fireRate: 900, reloadTime: 2200, pellets: 1, spread: 0, recoil: 0.08 },
        smg: { id: "smg", name: "SMG", damage: 1, headshotDamage: 2, magSize: 40, ammo: 40, reserve: 160, fireRate: 80, reloadTime: 1300, pellets: 1, spread: 0.025, auto: true, recoil: 0.012 }
    };

    let currentWeapon = weapons.pistol;
    let lastShotTime = 0;

    const playerStats = {
        closeRangeKills: 0,
        longRangeKills: 0,
        headshots: 0,
        hidingTicks: 0,
        rushTicks: 0,
        longRangeTicks: 0,
        lastStrategy: "balanced"
    };

    const enemyAI = {
        aimSkill: 0.20,
        maxAimSkill: 0.90,
        aggression: 0.022,
        shootRange: 32,
        bulletDamage: 3,
        shootCooldownBase: 1600,
        flankPower: 0.009,
        lastAdaptTime: 0
    };


    // AUTO-SAVE LOAD: restores full progress when the game starts.
    // This keeps your Extraction stash/loadout/money/stats between sessions when running from index.html/game.js.
    const loadedAutoSave = safeLoad(SAVE_KEY, null);
    if (loadedAutoSave) {
        money = Number(loadedAutoSave.money ?? money);
        if (!currentPlayerName && loadedAutoSave.playerName) currentPlayerName = String(loadedAutoSave.playerName);
        if (Array.isArray(loadedAutoSave.takenNames)) takenNames = Array.from(new Set([...takenNames, ...loadedAutoSave.takenNames.map(normalizePlayerName)]));

        if (Array.isArray(loadedAutoSave.stash)) {
            stash.splice(0, stash.length, ...loadedAutoSave.stash);
        }

        if (loadedAutoSave.loadout && typeof loadedAutoSave.loadout === "object") {
            loadout = {
                helmet: loadedAutoSave.loadout.helmet ?? null,
                chestRig: loadedAutoSave.loadout.chestRig ?? null,
                gun: loadedAutoSave.loadout.gun ?? null,
                bag: Array.isArray(loadedAutoSave.loadout.bag) ? loadedAutoSave.loadout.bag : []
            };
        }

        if (loadedAutoSave.playerStats && typeof loadedAutoSave.playerStats === "object") {
            Object.assign(playerStats, loadedAutoSave.playerStats);
        }

    }

    // Only the player named justfish is allowed to use dev mode.
    devMode = isOwner();
    devFly = false;
    devGod = false;

    const ui = document.createElement("div");
    ui.style.position = "fixed";
    ui.style.top = "10px";
    ui.style.left = "10px";
    ui.style.color = "white";
    ui.style.fontFamily = "monospace";
    ui.style.fontSize = "18px";
    ui.style.zIndex = "1000000";
    ui.style.textShadow = "2px 2px 4px black";
    document.body.appendChild(ui);

    const centerMsg = document.createElement("div");
    centerMsg.style.position = "fixed";
    centerMsg.style.left = "50%";
    centerMsg.style.top = "28%";
    centerMsg.style.transform = "translate(-50%, -50%)";
    centerMsg.style.color = "white";
    centerMsg.style.font = "bold 34px Arial";
    centerMsg.style.textShadow = "3px 3px 8px black";
    centerMsg.style.zIndex = "1000003";
    centerMsg.style.pointerEvents = "none";
    document.body.appendChild(centerMsg);

    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.right = "15px";
    panel.style.top = "15px";
    panel.style.width = "330px";
    panel.style.maxHeight = "80vh";
    panel.style.overflow = "auto";
    panel.style.display = "none";
    panel.style.zIndex = "1000004";
    panel.style.background = "rgba(0,0,0,.78)";
    panel.style.border = "2px solid white";
    panel.style.borderRadius = "10px";
    panel.style.padding = "12px";
    panel.style.color = "white";
    panel.style.fontFamily = "Arial";
    document.body.appendChild(panel);


    const compass = document.createElement("div");
    compass.style.position = "fixed";
    compass.style.top = "8px";
    compass.style.left = "50%";
    compass.style.transform = "translateX(-50%)";
    compass.style.width = "520px";
    compass.style.height = "44px";
    compass.style.display = "none";
    compass.style.zIndex = "1000001";
    compass.style.background = "rgba(0,0,0,.45)";
    compass.style.border = "2px solid white";
    compass.style.borderRadius = "10px";
    compass.style.color = "white";
    compass.style.fontFamily = "monospace";
    compass.style.textAlign = "center";
    compass.style.textShadow = "2px 2px 4px black";
    compass.innerHTML = `<div style="font-size:13px;letter-spacing:24px;margin-left:24px;">N E S W</div><div id="extractArrow" style="font-size:24px;line-height:20px;">↑</div><div id="extractCompassText" style="font-size:12px;">Nearest Extract</div>`;
    document.body.appendChild(compass);

    const extractArrow = compass.querySelector("#extractArrow");
    const extractCompassText = compass.querySelector("#extractCompassText");

    // FREE FOR ALL EXIT BUTTON
    const ffaExitBtn = document.createElement("button");
    ffaExitBtn.textContent = "EXIT FFA TO LOADING SCREEN";
    ffaExitBtn.style.position = "fixed";
    ffaExitBtn.style.top = "12px";
    ffaExitBtn.style.right = "12px";
    ffaExitBtn.style.zIndex = "1000003";
    ffaExitBtn.style.display = "none";
    ffaExitBtn.style.fontFamily = "Arial, sans-serif";
    ffaExitBtn.style.fontWeight = "bold";
    ffaExitBtn.style.fontSize = "15px";
    ffaExitBtn.style.padding = "10px 14px";
    ffaExitBtn.style.background = "#aa1111";
    ffaExitBtn.style.color = "white";
    ffaExitBtn.style.border = "3px solid white";
    ffaExitBtn.style.borderRadius = "10px";
    ffaExitBtn.style.cursor = "pointer";
    ffaExitBtn.style.boxShadow = "0 0 12px black";
    document.body.appendChild(ffaExitBtn);

    const startScreen = document.createElement("div");
    startScreen.style.position = "fixed";
    startScreen.style.inset = "0";
    startScreen.style.zIndex = "1000005";
    startScreen.style.background = "linear-gradient(#5ecbff, #1f3d1f)";
    startScreen.style.display = "flex";
    startScreen.style.flexDirection = "column";
    startScreen.style.alignItems = "center";
    startScreen.style.justifyContent = "center";
    startScreen.style.gap = "28px";
    startScreen.style.fontFamily = "Arial, sans-serif";
    startScreen.style.color = "white";
    startScreen.style.textShadow = "3px 3px 6px black";
    startScreen.innerHTML = `
        <div style="text-align:center;margin-bottom:6px;">
            <div style="font-size:58px;font-weight:bold;">Bamboo FPS</div>
            <div style="font-size:24px;margin-top:8px;">Loading Screen</div>
            <div style="font-size:14px;margin-top:6px;opacity:.9;">Build your Extraction loadout here. Shop is only available on this screen.</div>
        </div>
        <div style="display:flex;gap:18px;align-items:stretch;max-width:1180px;width:94%;justify-content:center;">
            <div style="display:flex;flex-direction:column;gap:14px;min-width:260px;align-items:center;justify-content:center;">
                <button id="ffaBtn" style="font-size:28px;font-weight:bold;padding:16px 42px;background:#00aa22;color:white;border:4px solid white;border-radius:12px;cursor:pointer;box-shadow:0 0 20px black;width:250px;">FREE FOR ALL</button>
                <button id="extractBtn" style="font-size:28px;font-weight:bold;padding:16px 42px;background:#aa6600;color:white;border:4px solid white;border-radius:12px;cursor:pointer;box-shadow:0 0 20px black;width:250px;">EXTRACTION</button>
                <button id="shopBtn" style="font-size:22px;font-weight:bold;padding:12px 32px;background:#2244aa;color:white;border:3px solid white;border-radius:10px;cursor:pointer;width:250px;">SHOP / STASH</button>
                <button id="devBtn" style="font-size:18px;font-weight:bold;padding:10px 24px;background:#551188;color:white;border:3px solid white;border-radius:10px;cursor:pointer;width:250px;">DEV MODE</button>
            </div>
            <div id="loadingInventory" style="background:rgba(0,0,0,.55);border:2px solid white;border-radius:12px;padding:14px;width:780px;max-height:72vh;overflow:auto;text-shadow:none;"></div>
        </div>
        <div style="font-size:14px;max-width:970px;text-align:center;line-height:1.35;">Extraction is raid mode. Find guns and valuables in the city, open Purple Vaults with Purple Keycards, put loot in your raid bag, then extract. If you die, everything in your raid and everything you brought in is lost.</div>
    `;
    document.body.appendChild(startScreen);

    // VERY FIRST NAME SCREEN
    const nameScreen = document.createElement("div");
    nameScreen.style.position = "fixed";
    nameScreen.style.inset = "0";
    nameScreen.style.zIndex = "1000010";
    nameScreen.style.background = "linear-gradient(#111827, #134e4a)";
    nameScreen.style.display = currentPlayerName ? "none" : "flex";
    nameScreen.style.flexDirection = "column";
    nameScreen.style.alignItems = "center";
    nameScreen.style.justifyContent = "center";
    nameScreen.style.gap = "18px";
    nameScreen.style.fontFamily = "Arial, sans-serif";
    nameScreen.style.color = "white";
    nameScreen.style.textShadow = "3px 3px 6px black";
    nameScreen.innerHTML = `
        <div style="font-size:52px;font-weight:bold;">Choose Your Name</div>
        <div style="font-size:16px;max-width:620px;text-align:center;line-height:1.35;">Names are saved. Once a name is taken on this device, it cannot be chosen again.</div>
        <input id="playerNameInput" maxlength="18" placeholder="Enter name" style="font-size:24px;padding:12px 16px;border-radius:10px;border:3px solid white;text-align:center;">
        <button id="playerNameBtn" style="font-size:24px;font-weight:bold;padding:12px 42px;background:#00aa22;color:white;border:4px solid white;border-radius:12px;cursor:pointer;">CONTINUE</button>
        <div id="playerNameError" style="font-size:16px;color:#ffaaaa;height:24px;"></div>
    `;
    document.body.appendChild(nameScreen);

    function finishNameSetup(name) {
        currentPlayerName = String(name || "").trim();
        const normalized = normalizePlayerName(currentPlayerName);
        if (!takenNames.includes(normalized)) takenNames.push(normalized);
        safeSave(NAME_KEY, currentPlayerName);
        safeSave(TAKEN_NAMES_KEY, takenNames);
        devMode = isOwner();
        devFly = false;
        devGod = false;
        nameScreen.style.display = "none";
        const devBtnEl = document.getElementById("devBtn");
        if (devBtnEl) devBtnEl.style.display = isOwner() ? "block" : "none";
        renderLoadingInventory();
        updateUI();
        saveGame("name selected");
    }

    document.getElementById("playerNameBtn").onclick = () => {
        const input = document.getElementById("playerNameInput");
        const err = document.getElementById("playerNameError");
        const name = String(input.value || "").trim();
        const normalized = normalizePlayerName(name);
        if (!normalized) { err.textContent = "Please enter a name."; return; }
        if (!/^[a-z0-9_ -]{2,18}$/i.test(name)) { err.textContent = "Use 2-18 letters/numbers/spaces."; return; }
        if (takenNames.includes(normalized) && normalizePlayerName(currentPlayerName) !== normalized) {
            err.textContent = "That name is already taken.";
            return;
        }
        finishNameSetup(name);
    };

    const chatBox = document.createElement("div");
    chatBox.style.position = "fixed";
    chatBox.style.left = "12px";
    chatBox.style.bottom = "12px";
    chatBox.style.width = "430px";
    chatBox.style.zIndex = "1000004";
    chatBox.style.fontFamily = "Arial, sans-serif";
    chatBox.style.color = "white";
    chatBox.style.textShadow = "2px 2px 4px black";
    chatBox.innerHTML = `
        <div id="chatMessages" style="height:150px;overflow:hidden;background:rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.6);border-radius:8px;padding:8px;font-size:14px;"></div>
        <input id="chatInput" placeholder="Press Enter to chat" maxlength="120" style="width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border-radius:8px;border:2px solid white;background:rgba(0,0,0,.65);color:white;">
    `;
    document.body.appendChild(chatBox);
    const chatMessages = chatBox.querySelector("#chatMessages");
    const chatInput = chatBox.querySelector("#chatInput");
    let chatFocused = false;

    function addChatMessage(text) {
        const safeText = String(text || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const owner = isOwner();
        const title = owner ? `<span style="color:#ffd700;font-weight:bold;">[OWNER]</span> ` : "";
        const nameHtml = owner
            ? `<span style="font-weight:bold;background:linear-gradient(90deg,red,orange,yellow,lime,cyan,blue,violet);-webkit-background-clip:text;background-clip:text;color:transparent;">${currentPlayerName}</span>`
            : `<span style="font-weight:bold;color:#9ee7ff;">${currentPlayerName || "Player"}</span>`;
        const row = document.createElement("div");
        row.innerHTML = `${title}${nameHtml}: ${safeText}`;
        chatMessages.appendChild(row);
        while (chatMessages.children.length > 8) chatMessages.removeChild(chatMessages.firstChild);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatInput.addEventListener("focus", () => { chatFocused = true; });
    chatInput.addEventListener("blur", () => { chatFocused = false; });
    chatInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.stopPropagation();
            const msg = chatInput.value.trim();
            if (msg) addChatMessage(msg);
            chatInput.value = "";
            chatInput.blur();
        }
    });

    const extractTimerUI = document.createElement("div");
    extractTimerUI.style.position = "fixed";
    extractTimerUI.style.left = "50%";
    extractTimerUI.style.bottom = "95px";
    extractTimerUI.style.transform = "translateX(-50%)";
    extractTimerUI.style.zIndex = "1000003";
    extractTimerUI.style.display = "none";
    extractTimerUI.style.padding = "12px 24px";
    extractTimerUI.style.background = "rgba(0,0,0,.75)";
    extractTimerUI.style.border = "3px solid #00ff66";
    extractTimerUI.style.borderRadius = "12px";
    extractTimerUI.style.color = "white";
    extractTimerUI.style.font = "bold 24px Arial";
    extractTimerUI.style.textShadow = "2px 2px 4px black";
    document.body.appendChild(extractTimerUI);

    const damageFlash = document.createElement("div");
    damageFlash.style.position = "fixed";
    damageFlash.style.inset = "0";
    damageFlash.style.background = "rgba(255,0,0,0)";
    damageFlash.style.pointerEvents = "none";
    damageFlash.style.zIndex = "1000001";
    document.body.appendChild(damageFlash);

    const crosshair = document.createElement("div");
    crosshair.style.position = "fixed";
    crosshair.style.left = "50%";
    crosshair.style.top = "50%";
    crosshair.style.transform = "translate(-50%, -50%)";
    crosshair.style.width = "10px";
    crosshair.style.height = "10px";
    crosshair.style.pointerEvents = "none";
    crosshair.style.zIndex = "1000000";
    crosshair.innerHTML = `<div style="position:absolute;width:2px;height:10px;background:black;left:4px;top:0"></div><div style="position:absolute;width:10px;height:2px;background:black;left:0;top:4px"></div>`;
    document.body.appendChild(crosshair);

    const scopeOverlay = document.createElement("div");
    scopeOverlay.style.position = "fixed";
    scopeOverlay.style.inset = "0";
    scopeOverlay.style.display = "none";
    scopeOverlay.style.pointerEvents = "none";
    scopeOverlay.style.zIndex = "1000002";
    scopeOverlay.innerHTML = `<div style="position:absolute;left:50%;top:50%;width:420px;height:420px;transform:translate(-50%,-50%);border:6px solid black;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.75);"></div><div style="position:absolute;left:50%;top:0;width:2px;height:100%;background:black;"></div><div style="position:absolute;top:50%;left:0;height:2px;width:100%;background:black;"></div>`;
    document.body.appendChild(scopeOverlay);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), new THREE.MeshBasicMaterial({ color: 0x87ceeb, side: THREE.BackSide }));
    scene.add(sky);
    camera.add(new THREE.Group());
    scene.add(camera);

    const gun = new THREE.Group();
    const baseGunPos = new THREE.Vector3(0.3, -0.3, -0.8);
    gun.position.copy(baseGunPos);
    camera.add(gun);
    const muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    muzzleFlash.visible = false;

    function getAutoSaveData() {
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            money,
            kills,
            stash: stash.slice(),
            loadout: {
                helmet: loadout.helmet ?? null,
                chestRig: loadout.chestRig ?? null,
                gun: loadout.gun ?? null,
                bag: Array.isArray(loadout.bag) ? loadout.bag.slice() : []
            },
            playerStats: { ...playerStats },
            playerName: currentPlayerName,
            takenNames: takenNames.slice(),
            devMode: isOwner() ? devMode : false,
            devFly: isOwner() ? devFly : false,
            devGod: isOwner() ? devGod : false
        };
    }

    function saveGame(reason = "auto") {
        const saveData = getAutoSaveData();

        // Full save used by the updated game.
        safeSave(SAVE_KEY, saveData);

        // Legacy keys kept so older parts of the script still read correctly.
        safeSave("bambooMoney", money);
        safeSave("bambooExtractionStash", stash);
        safeSave("bambooExtractionLoadout", loadout);
        safeSave(NAME_KEY, currentPlayerName);
        safeSave(TAKEN_NAMES_KEY, takenNames);

        console.log(`Bamboo FPS auto-saved: ${reason}`);
    }

    function saveMeta(reason = "meta") {
        saveGame(reason);
    }


    function showCenterMessage(text, color = "white") {
        centerMsg.style.color = color;
        centerMsg.textContent = text;
        clearTimeout(showCenterMessage.timer);
        showCenterMessage.timer = setTimeout(() => centerMsg.textContent = "", 1600);
    }

    function updateUI() {
        const extractText = extracting ? ` EXTRACTING: ${Math.max(0, Math.ceil((10000 - (performance.now() - extractStartTime)) / 1000))}s` : (nearExtract ? " EXTRACT: Hold X/Press X" : "");
        const raidLine = gameMode === "extraction"
            ? `\nRaid Bag: ${raidInventory.length}/12 | Stash: ${stash.length} items |${extractText}${nearLoot ? " LOOT: Press E" : ""}${nearPurpleVault ? " PURPLE VAULT: Press E" : ""}`
            : "";
        ui.innerText =
            `Player: ${currentPlayerName || "No Name"}${isOwner() ? " [OWNER]" : ""} | Mode: ${gameMode.toUpperCase()} | HP: ${Math.ceil(health)} | Kills: ${kills} | Money: $${money}\n` +
            `Gun: ${currentWeapon.name} | Ammo: ${currentWeapon.ammo}/${currentWeapon.reserve}` +
            `${reloading ? " | RELOADING..." : ""}${scoped ? " | ZOOM" : ""}${inVehicle ? " | VEHICLE" : ""}` +
            `${gameMode === "menu" ? "\nSHOP / LOADOUT ON LOADING SCREEN" : gameMode === "ffa" ? "\nFFA: Click EXIT button or press ESC to return to Loading Screen" : "\nRAID INVENTORY: Press I"}` +
            `${isOwner() && devMode ? `\nDEV: ON | Fly ${devFly ? "ON" : "OFF"} | God ${devGod ? "ON" : "OFF"}` : ""}` + raidLine;
    }

    function addWorld(obj) {
        scene.add(obj);
        worldObjects.push(obj);
        return obj;
    }

    function clearWorld() {
        for (const obj of worldObjects) scene.remove(obj);
        worldObjects.length = 0;
        obstacles.length = 0;
        enemies.length = 0;
        pickups.length = 0;
        lootObjects.length = 0;
        extractZones.length = 0;
        shopObjects.length = 0;
        purpleVaults.length = 0;
        nearLoot = null;
        nearPurpleVault = null;
        nearExtract = false;
        nearShop = false;
        inVehicle = false;
    }

    function addObstacle(x, z, w, h, d, color = 0x8b6f47) {
        const obstacle = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
        obstacle.position.set(x, h / 2, z);
        addWorld(obstacle);
        obstacles.push(obstacle);
        return obstacle;
    }

    function addEnterableBuilding(x, z, w, d, floors = 1, color = 0x777777) {
        // Enterable building made from individual wall pieces with door gaps.
        // The inside is open, so players and AI can enter and loot it.
        const wallH = 3.2 * floors;
        const thick = 0.45;
        const doorW = 2.8;
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        addWorld(group);

        const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshBasicMaterial({ color: 0x555555 }));
        floor.position.y = 0.06;
        group.add(floor);

        function wall(localX, localZ, ww, dd) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(ww, wallH, dd), new THREE.MeshBasicMaterial({ color }));
            m.position.set(x + localX, wallH / 2, z + localZ);
            addWorld(m);
            obstacles.push(m);
            return m;
        }

        // Front wall has a doorway gap. Other walls are solid.
        wall(-(w / 4 + doorW / 4), -d / 2, w / 2 - doorW / 2, thick);
        wall((w / 4 + doorW / 4), -d / 2, w / 2 - doorW / 2, thick);
        wall(0, d / 2, w, thick);
        wall(-w / 2, 0, thick, d);
        wall(w / 2, 0, thick, d);

        // Add simple roof/canopy so it feels like a real building, but keep it non-colliding.
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.25, d + 0.4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
        roof.position.set(0, wallH + 0.15, 0);
        group.add(roof);

        // Interior shelves/crates and better loot drops.
        const crateCount = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < crateCount; i++) {
            const lx = x + (Math.random() - 0.5) * (w - 3);
            const lz = z + (Math.random() - 0.5) * (d - 3);
            addLootObject(randomLootId(), lx, lz, true);
        }
        if (Math.random() < 0.65) addLootObject(["ar", "smg", "shotgun", "sniper"][Math.floor(Math.random() * 4)], x + (Math.random() - 0.5) * (w - 3), z + (Math.random() - 0.5) * (d - 3), false);
        if (Math.random() < 0.55) addLootObject(["diamond", "laptop", "documents", "gold"][Math.floor(Math.random() * 4)], x + (Math.random() - 0.5) * (w - 3), z + (Math.random() - 0.5) * (d - 3), false);
    }

    function addFloor(size = 220, color = 0x77aa55) {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        floor.rotation.x = -Math.PI / 2;
        addWorld(floor);
        const grid = new THREE.GridHelper(size, size, 0x000000, 0x000000);
        grid.position.y = 0.01;
        addWorld(grid);
    }

    function addTree(x, z) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.7), new THREE.MeshBasicMaterial({ color: 0x6b3f1d }));
        trunk.position.y = 1.5;
        const leaves1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x1f7a2e }));
        leaves1.position.y = 3.2;
        const leaves2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), new THREE.MeshBasicMaterial({ color: 0x2f9a3e }));
        leaves2.position.y = 4.4;
        tree.add(trunk, leaves1, leaves2);
        tree.position.set(x, 0, z);
        addWorld(tree);
        const collider = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
        collider.position.set(x, 1.5, z);
        addWorld(collider);
        obstacles.push(collider);
    }

    function addShop(x, z) {
        const shop = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 2), new THREE.MeshBasicMaterial({ color: 0x2222aa }));
        base.position.y = 0.7;
        const screen = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.08), new THREE.MeshBasicMaterial({ color: 0x00ffcc }));
        screen.position.set(0, 1.25, -1.05);
        shop.add(base, screen);
        shop.position.set(x, 0, z);
        shop.userData.type = "shop";
        addWorld(shop);
        shopObjects.push(shop);
        obstacles.push(base);
        return shop;
    }

    let vehicle = null;
    function addVehicle(x, z) {
        vehicle = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
        body.position.y = 0.8;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 1.8), new THREE.MeshBasicMaterial({ color: 0x666666 }));
        cab.position.set(0, 1.45, -0.5);
        vehicle.add(body, cab);
        vehicle.position.set(x, 0, z);
        addWorld(vehicle);
    }

    function toggleVehicle() {
        if (!vehicle) return;
        const flatPlayer = new THREE.Vector3(camera.position.x, 0, camera.position.z);
        const flatVehicle = new THREE.Vector3(vehicle.position.x, 0, vehicle.position.z);
        if (!inVehicle && flatPlayer.distanceTo(flatVehicle) < 4) {
            inVehicle = true;
            showCenterMessage("Entered vehicle - press F to exit", "#ffffff");
        } else if (inVehicle) {
            inVehicle = false;
            camera.position.x += Math.sin(yaw) * 3;
            camera.position.z += Math.cos(yaw) * 3;
            showCenterMessage("Exited vehicle", "#ffffff");
        }
        updateUI();
    }

    function addExtract(x, z, name) {
        const ex = new THREE.Group();
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 32), new THREE.MeshBasicMaterial({ color: 0x00ff66 }));
        pad.position.y = 0.08;
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, 0.15), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        pole.position.y = 2;
        ex.add(pad, pole);
        ex.position.set(x, 0, z);
        ex.userData.name = name;
        addWorld(ex);
        extractZones.push(ex);
    }

    function addPurpleVault(x, z) {
        const vault = new THREE.Group();
        vault.position.set(x, 0, z);
        vault.userData.opened = false;
        vault.userData.name = "Purple Vault";

        const room = new THREE.Mesh(new THREE.BoxGeometry(9, 3.8, 9), new THREE.MeshBasicMaterial({ color: 0x3b2058, transparent: true, opacity: 0.55 }));
        room.position.y = 1.9;
        const door = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.1, 0.45), new THREE.MeshBasicMaterial({ color: 0x5500aa }));
        door.position.set(0, 1.55, -4.65);
        const reader = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.2), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
        reader.position.set(2.05, 1.3, -4.95);
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 0.07, 40), new THREE.MeshBasicMaterial({ color: 0x7722ff, transparent: true, opacity: 0.35 }));
        glow.position.y = 0.04;

        vault.add(room, door, reader, glow);
        vault.userData.door = door;
        addWorld(vault);

        // Door blocks entry until a Purple Keycard is inserted.
        door.position.x += x;
        door.position.z += z;
        obstacles.push(door);
        door.position.x -= x;
        door.position.z -= z;

        purpleVaults.push(vault);
        return vault;
    }

    function hasPurpleKeycardInRaid() {
        return raidInventory.includes("purpleKeycard");
    }

    function openPurpleVault(vault) {
        if (!vault || vault.userData.opened) return;
        if (!hasPurpleKeycardInRaid()) {
            playSound("error");
            showCenterMessage("Need a Purple Keycard", "#cc99ff");
            return;
        }

        const keyIndex = raidInventory.indexOf("purpleKeycard");
        if (keyIndex >= 0) raidInventory.splice(keyIndex, 1); // keycard is consumed/lost when inserted

        vault.userData.opened = true;
        if (vault.userData.door) {
            const door = vault.userData.door;
            const obsIndex = obstacles.indexOf(door);
            if (obsIndex >= 0) obstacles.splice(obsIndex, 1);
            vault.remove(door);
        }

        const vx = vault.position.x;
        const vz = vault.position.z;
        playSound("vault");
        showCenterMessage("PURPLE VAULT OPENED - Keycard consumed", "#cc99ff");

        // Heart of Bamboo is loot-only and only appears from Purple Vaults.
        if (Math.random() < 0.45) addLootObject("heartOfBamboo", vx, vz + 1.8, false);

        const vaultLoot = ["diamond", "laptop", "documents", "gold", "sniper", "ar", "chestRig", "helmet", "backpack", "ammo", "medkit"];
        for (let i = 0; i < 9; i++) {
            const id = vaultLoot[Math.floor(Math.random() * vaultLoot.length)];
            addLootObject(id, vx + (Math.random() - 0.5) * 5.5, vz + (Math.random() - 0.5) * 5.5, Math.random() < 0.45);
        }
        updatePanelInventory();
        updateUI();
    }

    function randomLootId() {
        const roll = Math.random();
        if (roll < 0.015) return "purpleKeycard"; // very rare world/key crate loot
        const pool = ["ammo", "medkit", "gold", "phone", "documents", "diamond", "laptop", "armor", "helmet", "chestRig", "ar", "shotgun", "smg", "sniper"];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function addLootObject(id, x, z, boxed = false) {
        const def = itemDefs[id];
        const color = def.type === "gun" ? 0x111111 : def.type === "heal" ? 0xff3333 : def.type === "ammo" ? 0xffcc00 : def.type === "keycard" ? 0x9933ff : def.type === "relic" ? 0x00ff88 : 0x33ccff;
        const mesh = new THREE.Mesh(
            boxed ? new THREE.BoxGeometry(1.6, 1.0, 1.6) : new THREE.BoxGeometry(0.75, 0.35, 0.75),
            new THREE.MeshBasicMaterial({ color: boxed ? 0x8b5a2b : color })
        );
        mesh.position.set(x, boxed ? 0.5 : 0.25, z);
        mesh.userData.lootId = id;
        mesh.userData.boxed = boxed;
        addWorld(mesh);
        lootObjects.push(mesh);
        return mesh;
    }

    function pickupLoot(obj) {
        if (!obj) return;
        if (raidInventory.length >= maxBagSlots) {
            showCenterMessage("Raid bag full", "#ffcc00");
            return;
        }
        const id = obj.userData.lootId;
        raidInventory.push(id);
        if (itemDefs[id].type === "gun") switchWeapon(weapons[id]);
        if (id === "ammo") Object.values(weapons).forEach(w => w.reserve += 25);
        if (id === "medkit") health = Math.min(100, health + 40);
        scene.remove(obj);
        const index = lootObjects.indexOf(obj);
        if (index >= 0) lootObjects.splice(index, 1);
        const worldIndex = worldObjects.indexOf(obj);
        if (worldIndex >= 0) worldObjects.splice(worldIndex, 1);
        nearLoot = null;
        playSound("loot");
        showCenterMessage(`Looted: ${itemDefs[id].name}`, "#00ffcc");
        updateUI();
    }

    function startExtractTimer() {
        if (gameMode !== "extraction" || !nearExtract) return;
        if (extracting) return;
        extracting = true;
        extractStartTime = performance.now();
        extractTarget = true;
        extractTimerUI.style.display = "block";
        showCenterMessage("Extract started - stay in the zone for 10 seconds", "#00ff66");
        updateUI();
    }

    function cancelExtractTimer(reason = "Extraction cancelled") {
        if (!extracting) return;
        extracting = false;
        extractStartTime = 0;
        extractTarget = null;
        extractTimerUI.style.display = "none";
        showCenterMessage(reason, "#ffcc00");
        updateUI();
    }

    function completeExtractRaid() {
        stash.push(...raidInventory.slice(initialRaidBagCount));
        raidInventory = [];
        initialRaidBagCount = 0;
        equippedRaidItems = [];
        raidActive = false;
        extracting = false;
        extractTimerUI.style.display = "none";
        saveMeta("extracted raid");
        showCenterMessage("EXTRACTED! Loot moved to stash", "#00ff66");
        returnToLoadingScreen();
    }

    function updateExtractTimer() {
        if (!extracting) return;
        if (gameMode !== "extraction" || !nearExtract) {
            cancelExtractTimer("Extraction cancelled - left extract");
            return;
        }
        const remaining = Math.max(0, 10 - Math.floor((performance.now() - extractStartTime) / 1000));
        extractTimerUI.textContent = `EXTRACTING... ${remaining}s`;
        if (performance.now() - extractStartTime >= 10000) completeExtractRaid();
    }

    function extractRaid() {
        startExtractTimer();
    }

    function loseRaidAndReturn() {
        raidInventory = [];
        initialRaidBagCount = 0;
        equippedRaidItems = [];
        loadout = { helmet: null, chestRig: null, gun: null, bag: [] };
        raidActive = false;
        extracting = false;
        extractTimerUI.style.display = "none";
        saveMeta("died in raid");
        alert("You died in raid. All raid loot and everything you brought in was lost.");
        currentWeapon = weapons.pistol;
        buildGunModel();
        returnToLoadingScreen();
    }

    function exitFFAtoLoadingScreen() {
        if (gameMode !== "ffa") return;
        const matchKills = kills;
        clearWorld();
        gameStarted = false;
        gameMode = "menu";
        health = 100;
        velocityY = 0;
        camera.position.set(spawn.x, spawn.y, spawn.z);
        scoped = false;
        inVehicle = false;
        startScreen.style.display = "flex";
        compass.style.display = "none";
        ffaExitBtn.style.display = "none";
        panel.style.display = "none";
        extracting = false;
        if (typeof extractTimerUI !== "undefined") extractTimerUI.style.display = "none";
        document.exitPointerLock?.();
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
        showCenterMessage(`Returned to loading screen | FFA kills: ${matchKills}`, "#ffffff");
    }

    function returnToLoadingScreen() {
        clearWorld();
        gameStarted = false;
        gameMode = "menu";
        health = 100;
        velocityY = 0;
        camera.position.set(spawn.x, spawn.y, spawn.z);
        startScreen.style.display = "flex";
        compass.style.display = "none";
        ffaExitBtn.style.display = "none";
        panel.style.display = "none";
        extracting = false;
        if (typeof extractTimerUI !== "undefined") extractTimerUI.style.display = "none";
        document.exitPointerLock?.();
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
    }

    function openShop() {
        if (gameMode !== "menu" && gameMode !== "extraction") return;
        panel.style.display = panel.style.display === "none" ? "block" : "none";
        updatePanelInventory();
    }

    function countItems(list) {
        const counts = {};
        for (const id of list) counts[id] = (counts[id] || 0) + 1;
        return counts;
    }

    function removeOneFromStash(id) {
        const index = stash.indexOf(id);
        if (index < 0) return false;
        stash.splice(index, 1);
        return true;
    }

    function addToStash(id) {
        stash.push(id);
    }

    function loadoutItems() {
        const items = [];
        if (loadout.helmet) items.push(loadout.helmet);
        if (loadout.chestRig) items.push(loadout.chestRig);
        if (loadout.gun) items.push(loadout.gun);
        items.push(...loadout.bag);
        return items;
    }

    function buyItem(id) {
        if (gameMode !== "menu") {
            showCenterMessage("Shop is only on the loading screen", "#ffcc00");
            return;
        }
        const price = itemDefs[id].shopPrice || Math.ceil(itemDefs[id].value * 1.35);
        if (money < price) { showCenterMessage("Not enough money", "#ff3333"); return; }
        money -= price;
        playSound("buy");
        stash.push(id);
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
    }

    function sellFirst(id) {
        if (gameMode !== "menu") { showCenterMessage("Sell only on loading screen", "#ffcc00"); return; }
        const index = stash.indexOf(id);
        if (index < 0) return;
        money += itemDefs[id].value;
        playSound("sell");
        stash.splice(index, 1);
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
    }

    function equipFromStash(id, slot) {
        if (gameMode !== "menu") { showCenterMessage("Loadout changes only on loading screen", "#ffcc00"); return; }
        const def = itemDefs[id];
        if (!def) return;
        if (slot === "gun" && def.type !== "gun") return;
        if (slot === "helmet" && def.type !== "helmet") return;
        if (slot === "chestRig" && def.type !== "chestRig") return;
        if (slot === "bag" && loadout.bag.length >= maxBagSlots) { showCenterMessage("Bag full", "#ffcc00"); return; }
        if (!removeOneFromStash(id)) return;
        if (slot === "gun") {
            if (loadout.gun) addToStash(loadout.gun);
            loadout.gun = id;
        } else if (slot === "helmet") {
            if (loadout.helmet) addToStash(loadout.helmet);
            loadout.helmet = id;
        } else if (slot === "chestRig") {
            if (loadout.chestRig) addToStash(loadout.chestRig);
            loadout.chestRig = id;
        } else if (slot === "bag") {
            loadout.bag.push(id);
        }
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
    }

    function unequipSlot(slot, bagIndex = -1) {
        if (gameMode !== "menu") return;
        if (slot === "gun" && loadout.gun) { addToStash(loadout.gun); loadout.gun = null; }
        if (slot === "helmet" && loadout.helmet) { addToStash(loadout.helmet); loadout.helmet = null; }
        if (slot === "chestRig" && loadout.chestRig) { addToStash(loadout.chestRig); loadout.chestRig = null; }
        if (slot === "bag" && bagIndex >= 0 && loadout.bag[bagIndex]) { addToStash(loadout.bag[bagIndex]); loadout.bag.splice(bagIndex, 1); }
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
    }

    function giveDevItem(id) {
        if (!isOwner() || !devMode) return;
        stash.push(id);
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
        showCenterMessage(`DEV gave: ${itemDefs[id].name}`, "#cc99ff");
    }

    function giveDevAll() {
        if (!isOwner() || !devMode) return;
        Object.keys(itemDefs).forEach(id => stash.push(id));
        money += 5000;
        saveMeta();
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
        showCenterMessage("DEV gave all items + $5000", "#cc99ff");
    }

    function setDevMoney() {
        if (!isOwner() || !devMode) return;
        const input = document.getElementById("devMoneyInput");
        if (!input) return;
        const value = Math.floor(Number(input.value));
        if (!Number.isFinite(value) || value < 0) {
            showCenterMessage("Enter a valid money amount", "#ffcc00");
            return;
        }
        money = value;
        saveMeta("dev money set");
        renderLoadingInventory();
        updatePanelInventory();
        updateUI();
        showCenterMessage(`DEV set money to $${money}`, "#cc99ff");
    }

    function toggleDevMode() {
        if (!isOwner()) {
            devMode = false;
            devFly = false;
            devGod = false;
            showCenterMessage("Dev mode is owner-only", "#ffcc00");
            updateUI();
            return;
        }
        devMode = !devMode;
        renderLoadingInventory();
        updateUI();
        saveMeta("dev mode toggled");
        showCenterMessage(devMode ? "DEV MODE ON" : "DEV MODE OFF", devMode ? "#cc99ff" : "#ffffff");
    }

    function toggleDevFly() { if (isOwner() && devMode) { devFly = !devFly; saveMeta("dev fly toggled"); showCenterMessage(devFly ? "DEV FLY ON" : "DEV FLY OFF", "#cc99ff"); updateUI(); } }
    function toggleDevGod() { if (isOwner() && devMode) { devGod = !devGod; saveMeta("dev god toggled"); showCenterMessage(devGod ? "DEV GOD ON" : "DEV GOD OFF", "#cc99ff"); updateUI(); } }

    window.bambooBuyItem = buyItem;
    window.bambooSellFirst = sellFirst;
    window.bambooEquipFromStash = equipFromStash;
    window.bambooUnequipSlot = unequipSlot;
    window.bambooGiveDevItem = giveDevItem;
    window.bambooGiveDevAll = giveDevAll;
    window.bambooSetDevMoney = setDevMoney;
    window.bambooToggleDevMode = toggleDevMode;
    window.bambooToggleDevFly = toggleDevFly;
    window.bambooToggleDevGod = toggleDevGod;

    function renderLoadingInventory() {
        const box = document.getElementById("loadingInventory");
        if (!box) return;
        const counts = countItems(stash);
        const shopIds = ["purpleKeycard", "pistol", "ar", "shotgun", "smg", "sniper", "ammo", "medkit", "armor", "helmet", "chestRig", "backpack"];
        const stashRows = Object.keys(counts).length
            ? Object.keys(counts).sort().map(id => {
                const def = itemDefs[id];
                const equipButtons = [];
                if (def.type === "gun") equipButtons.push(`<button onclick="bambooEquipFromStash('${id}','gun')">Gun Slot</button>`);
                if (def.type === "helmet") equipButtons.push(`<button onclick="bambooEquipFromStash('${id}','helmet')">Helmet</button>`);
                if (def.type === "chestRig") equipButtons.push(`<button onclick="bambooEquipFromStash('${id}','chestRig')">Chest Rig</button>`);
                equipButtons.push(`<button onclick="bambooEquipFromStash('${id}','bag')">Bag</button>`);
                equipButtons.push(`<button onclick="bambooSellFirst('${id}')">Sell</button>`);
                return `<div style="display:flex;justify-content:space-between;gap:8px;margin:5px 0;background:rgba(255,255,255,.08);padding:5px;border-radius:6px;"><span>${def.name} x${counts[id]} ($${def.value})</span><span>${equipButtons.join(" ")}</span></div>`;
            }).join("")
            : `<div style="opacity:.8;">Empty stash. Buy items or extract loot from raid.</div>`;
        const bagRows = loadout.bag.length
            ? loadout.bag.map((id, i) => `<div style="display:flex;justify-content:space-between;margin:3px 0;"><span>${i + 1}. ${itemDefs[id].name}</span><button onclick="bambooUnequipSlot('bag',${i})">Remove</button></div>`).join("")
            : `<div style="opacity:.75;">Bag empty</div>`;
        box.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1.25fr;gap:14px;color:white;">
                <div>
                    <div style="font-size:22px;font-weight:bold;margin-bottom:8px;">Extraction Loadout</div>
                    <div style="font-size:14px;margin-bottom:8px;">Money: $${money}</div>
                    <div style="background:rgba(0,0,0,.35);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.55);">
                        <div style="display:flex;justify-content:space-between;margin:5px 0;"><b>Helmet:</b><span>${loadout.helmet ? itemDefs[loadout.helmet].name + ` <button onclick="bambooUnequipSlot('helmet')">Remove</button>` : "Empty"}</span></div>
                        <div style="display:flex;justify-content:space-between;margin:5px 0;"><b>Chest Rig:</b><span>${loadout.chestRig ? itemDefs[loadout.chestRig].name + ` <button onclick="bambooUnequipSlot('chestRig')">Remove</button>` : "Empty"}</span></div>
                        <div style="display:flex;justify-content:space-between;margin:5px 0;"><b>Gun Slot:</b><span>${loadout.gun ? itemDefs[loadout.gun].name + ` <button onclick="bambooUnequipSlot('gun')">Remove</button>` : "Empty"}</span></div>
                        <hr>
                        <b>Raid Bag (${loadout.bag.length}/${maxBagSlots})</b>
                        ${bagRows}
                    </div>
                    <div style="font-size:12px;margin-top:8px;opacity:.85;">Only the helmet, chest rig, gun slot, and bag items enter a raid. If you die, all of them are lost.</div>
                    <hr>
                    <div style="font-size:20px;font-weight:bold;">Shop</div>
                    ${shopIds.map(id => `<div style="display:flex;justify-content:space-between;gap:8px;margin:5px 0;"><span>${itemDefs[id].name} - $${itemDefs[id].shopPrice || Math.ceil(itemDefs[id].value * 1.35)}</span><button onclick="bambooBuyItem('${id}')">Buy</button></div>`).join("")}
                </div>
                <div>
                    <div style="font-size:22px;font-weight:bold;margin-bottom:8px;">Stash</div>
                    ${stashRows}
                    <hr>
                    ${isOwner() ? `
                    <div style="font-size:18px;font-weight:bold;color:#cc99ff;">Dev Mode - Owner Only</div>
                    <div style="margin:6px 0;">Status: <b>${devMode ? "ON" : "OFF"}</b> | Fly: <b>${devFly ? "ON" : "OFF"}</b> | God: <b>${devGod ? "ON" : "OFF"}</b></div>
                    <button onclick="bambooToggleDevMode()">Toggle Dev Mode</button>
                    <button onclick="bambooToggleDevFly()">Toggle Fly</button>
                    <button onclick="bambooToggleDevGod()">Toggle No Damage</button>
                    <button onclick="bambooGiveDevAll()">Give All + Money</button>
                    <button onclick="bambooToggleSound()">Toggle Sound</button>
                    <label style="display:block;margin-top:6px;">Sound Volume <input type="range" min="0" max="1" step="0.05" value="${soundVolume}" oninput="bambooSetSoundVolume(this.value)"></label>
                    <div style="margin-top:8px;display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
                        <input id="devMoneyInput" type="number" min="0" placeholder="Set money" style="width:120px;padding:6px;border-radius:6px;border:1px solid white;">
                        <button onclick="bambooSetDevMoney()">Set Money</button>
                    </div>
                    <div style="margin-top:6px;max-height:110px;overflow:auto;">${Object.keys(itemDefs).map(id => `<button style="margin:2px;" onclick="bambooGiveDevItem('${id}')">${itemDefs[id].name}</button>`).join("")}</div>
                    <div style="font-size:12px;margin-top:6px;opacity:.8;">Keys in-game: F9 dev, V fly, G no damage, PageUp/PageDown fly up/down.</div>
                    ` : `<div style="font-size:13px;margin-top:10px;opacity:.75;">Dev mode is owner-only.</div>`}
                </div>
            </div>`;
    }

    function updatePanelInventory() {
        const counts = countItems(stash);
        const raidCounts = countItems(raidInventory);
        const shopIds = ["purpleKeycard", "pistol", "ar", "shotgun", "smg", "sniper", "ammo", "medkit", "armor", "helmet", "chestRig", "backpack"];
        panel.innerHTML = `
            <div style="font-size:24px;font-weight:bold;margin-bottom:8px;">${gameMode === "menu" ? "Shop / Stash" : "Raid Inventory"}</div>
            <div>Money: $${money}</div>
            ${gameMode === "menu" ? `<hr><b>Shop - Buy</b>${shopIds.map(id => `<div style="margin:7px 0;display:flex;justify-content:space-between;gap:8px;"><span>${itemDefs[id].name} - $${itemDefs[id].shopPrice || Math.ceil(itemDefs[id].value * 1.35)}</span><button onclick="bambooBuyItem('${id}')">Buy</button></div>`).join("")}<hr><b>Stash</b>${Object.keys(counts).length ? Object.keys(counts).map(id => `<div style="margin:7px 0;display:flex;justify-content:space-between;gap:8px;"><span>${itemDefs[id].name} x${counts[id]} ($${itemDefs[id].value})</span><span><button onclick="bambooSellFirst('${id}')">Sell</button></span></div>`).join("") : `<div style="opacity:.8;margin-top:6px;">Empty</div>`}` : ``}
            <hr>
            <b>Current Raid Bag</b>
            ${Object.keys(raidCounts).length ? Object.keys(raidCounts).map(id => `<div style="margin:5px 0;">${itemDefs[id].name} x${raidCounts[id]}</div>`).join("") : `<div style="opacity:.8;margin-top:6px;">Empty</div>`}
            <div style="font-size:12px;opacity:.8;margin-top:12px;">Death in raid deletes the raid bag and your brought-in loadout.</div>
        `;
    }

    function clearGun() { while (gun.children.length) gun.remove(gun.children[0]); }
    function addGunPart(w, h, d, x, y, z, color) {
        const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
        part.position.set(x, y, z);
        gun.add(part);
    }
    function buildGunModel() {
        clearGun();
        if (currentWeapon.name === "Pistol") {
            addGunPart(0.22, 0.16, 0.45, 0, 0, -0.2, 0x333333); addGunPart(0.12, 0.28, 0.12, 0, -0.18, -0.05, 0x111111); muzzleFlash.position.set(0, 0, -0.48);
        } else if (currentWeapon.name === "AR") {
            addGunPart(0.22, 0.16, 0.75, 0, 0, -0.3, 0x333333); addGunPart(0.12, 0.12, 0.65, 0, 0.02, -0.82, 0x111111); addGunPart(0.16, 0.35, 0.16, 0, -0.22, -0.15, 0x222222); muzzleFlash.position.set(0, 0.02, -1.16);
        } else if (currentWeapon.name === "Shotgun") {
            addGunPart(0.28, 0.18, 0.85, 0, 0, -0.35, 0x4b2e1a); addGunPart(0.14, 0.14, 0.75, 0, 0.03, -0.9, 0x111111); muzzleFlash.position.set(0, 0.03, -1.28);
        } else if (currentWeapon.name === "Sniper") {
            addGunPart(0.22, 0.16, 1.0, 0, 0, -0.45, 0x222222); addGunPart(0.1, 0.1, 1.1, 0, 0.02, -1.05, 0x111111); addGunPart(0.18, 0.18, 0.35, 0, 0.2, -0.4, 0x000000); muzzleFlash.position.set(0, 0.02, -1.62);
        } else {
            addGunPart(0.2, 0.15, 0.55, 0, 0, -0.25, 0x222222); addGunPart(0.1, 0.1, 0.38, 0, 0.02, -0.65, 0x111111); muzzleFlash.position.set(0, 0.02, -0.88);
        }
        gun.add(muzzleFlash);
    }
    buildGunModel();

    function switchWeapon(weapon) {
        if (!weapon || reloading || burstFiring) return;
        currentWeapon = weapon;
        scoped = false;
        camera.fov = 75;
        camera.updateProjectionMatrix();
        scopeOverlay.style.display = "none";
        buildGunModel();
        updateUI();
    }

    function createEnemy(enemyClass = "raider") {
        const enemy = new THREE.Group();
        const shirtColor = enemyClass === "sniper" ? 0x222244 : enemyClass === "rusher" ? 0x883333 : 0x8b5a2b;
        const shirt = new THREE.MeshBasicMaterial({ color: shirtColor });
        const pants = new THREE.MeshBasicMaterial({ color: 0x5a351c });
        const skin = new THREE.MeshBasicMaterial({ color: 0xf0c090 });
        const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), skin); head.position.y = 2.35;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.5), shirt); body.position.y = 1.45;
        const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.15, 0.35), shirt); leftArm.position.set(-0.7, 1.45, 0);
        const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.15, 0.35), shirt); rightArm.position.set(0.7, 1.45, 0);
        const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.38), pants); leftLeg.position.set(-0.22, 0.35, 0);
        const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.38), pants); rightLeg.position.set(0.22, 0.35, 0);
        const eye1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), black); eye1.position.set(-0.18, 2.42, -0.465);
        const eye2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), black); eye2.position.set(0.18, 2.42, -0.465);
        enemy.add(head, body, leftArm, rightArm, leftLeg, rightLeg, eye1, eye2);
        enemy.head = head; enemy.parts = [head, body, leftArm, rightArm, leftLeg, rightLeg, eye1, eye2];
        enemy.leftArm = leftArm; enemy.rightArm = rightArm; enemy.leftLeg = leftLeg; enemy.rightLeg = rightLeg;
        enemy.hp = enemyClass === "rusher" ? 4 : enemyClass === "sniper" ? 3 : 5;
        enemy.maxHp = enemy.hp;
        enemy.enemyClass = enemyClass;
        enemy.lastShot = 0;
        enemy.nextStrafeChange = 0;
        enemy.strafeDir = Math.random() < 0.5 ? -1 : 1;
        enemy.moveSpeed = enemyClass === "rusher" ? 0.04 : 0.025;
        return enemy;
    }

    function spawnEnemy(x = null, z = null, enemyClass = null) {
        const classes = gameMode === "extraction" ? ["raider", "rusher", "sniper"] : ["raider", "rusher"];
        const chosen = enemyClass || classes[Math.floor(Math.random() * classes.length)];
        const enemy = createEnemy(chosen);
        enemy.position.set(x ?? ((Math.random() - 0.5) * 95), 0, z ?? (-10 - Math.random() * 95));
        addWorld(enemy);
        enemies.push(enemy);
    }

    function createForestFFA() {
        clearWorld();
        gameMode = "ffa";
        raidActive = false;
        addFloor(220, 0x77aa55);
        addObstacle(6, -10, 4, 2, 1.5); addObstacle(-7, -14, 5, 2.5, 1.5); addObstacle(13, -22, 3, 3, 3); addObstacle(-15, -25, 5, 2, 2); addObstacle(0, -32, 8, 2.5, 1.2); addObstacle(18, -8, 2, 2, 6); addObstacle(-20, -8, 2, 2, 6);
        for (let i = 0; i < 35; i++) addTree((Math.random() - 0.5) * 100, -5 - Math.random() * 90);
        addVehicle(8, -12);
        for (let i = 0; i < 10; i++) spawnEnemy();
        camera.position.set(0, 1.7, 0); yaw = 0; pitch = 0; health = 100;
    }

    function createCityExtraction() {
        clearWorld();
        gameMode = "extraction";
        raidActive = true;
        raidInventory = [];
        equippedRaidItems = [];
        addFloor(420, 0x4d4d4d);
        // roads
        for (let z = -190; z <= 190; z += 70) addObstacle(0, z, 390, 0.08, 8, 0x222222);
        for (let x = -180; x <= 180; x += 70) addObstacle(x, 0, 8, 0.08, 390, 0x222222);
        // enterable city buildings with loot inside
        for (let i = 0; i < 42; i++) {
            const x = Math.round(((Math.random() - 0.5) * 390) / 12) * 12;
            const z = Math.round(((Math.random() - 0.5) * 390) / 12) * 12;
            if (Math.abs(x) < 22 && Math.abs(z) < 22) continue;
            const w = 11 + Math.random() * 17;
            const d = 11 + Math.random() * 17;
            const floors = 1 + Math.floor(Math.random() * 3);
            addEnterableBuilding(x, z, w, d, floors, 0x666666 + Math.floor(Math.random() * 0x333333));
        }
        // cover cars / crates
        for (let i = 0; i < 35; i++) addObstacle((Math.random() - 0.5) * 360, (Math.random() - 0.5) * 360, 2 + Math.random() * 4, 1.2, 2 + Math.random() * 5, 0x8b6f47);
        addVehicle(10, 6);
        addExtract(175, 175, "North Gate");
        addExtract(-180, 160, "West Tunnel");
        addExtract(160, -185, "South Road");
        addPurpleVault(-120, -115);
        addPurpleVault(112, 82);
        addPurpleVault(-35, 150);
        for (let i = 0; i < 45; i++) addLootObject(randomLootId(), (Math.random() - 0.5) * 390, (Math.random() - 0.5) * 390, Math.random() < 0.6);
        for (let i = 0; i < 20; i++) spawnEnemy((Math.random() - 0.5) * 390, (Math.random() - 0.5) * 390);
        camera.position.set(0, 1.7, 0); yaw = 0; pitch = 0; health = 100;
        armorPoints = (loadout.helmet ? 35 : 0) + (loadout.chestRig ? 75 : 0);
        raidInventory = [...loadout.bag];
        initialRaidBagCount = loadout.bag.length;
        equippedRaidItems = loadoutItems();
        currentWeapon = loadout.gun ? weapons[loadout.gun] : weapons.pistol;
        buildGunModel();
    }

    function startMode(mode) {
        if (!currentPlayerName) {
            nameScreen.style.display = "flex";
            showCenterMessage("Choose a name first", "#ffcc00");
            return;
        }
        extracting = false;
        extractTimerUI.style.display = "none";
        if (mode === "ffa") createForestFFA(); else createCityExtraction();
        gameStarted = true;
        startScreen.style.display = "none";
        panel.style.display = "none";
        compass.style.display = mode === "extraction" ? "block" : "none";
        ffaExitBtn.style.display = mode === "ffa" ? "block" : "none";
        renderer.domElement.requestPointerLock();
        updateUI();
    }

    document.getElementById("ffaBtn").onclick = () => startMode("ffa");
    document.getElementById("extractBtn").onclick = () => startMode("extraction");
    document.getElementById("shopBtn").onclick = () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; updatePanelInventory(); };
    document.getElementById("devBtn").style.display = isOwner() ? "block" : "none";
    document.getElementById("devBtn").onclick = () => toggleDevMode();
    ffaExitBtn.onclick = () => exitFFAtoLoadingScreen();
    renderLoadingInventory();
    saveGame("game loaded");

    // Backup auto-save every 10 seconds while the game is open.
    setInterval(() => {
        saveGame("10-second backup");
    }, 10000);

    renderer.domElement.addEventListener("click", () => { if (gameStarted) renderer.domElement.requestPointerLock(); });

    function flashDamage() {
        damageFlash.style.background = "rgba(255,0,0,0.35)";
        setTimeout(() => damageFlash.style.background = "rgba(255,0,0,0)", 120);
    }

    function reloadWeapon() {
        if (reloading || burstFiring || currentWeapon.ammo >= currentWeapon.magSize || currentWeapon.reserve <= 0) return;
        playSound("reload", 0.8);
        reloading = true; updateUI(); gun.rotation.z = 0.55; gun.position.y -= 0.15;
        setTimeout(() => {
            const needed = currentWeapon.magSize - currentWeapon.ammo;
            const loaded = Math.min(needed, currentWeapon.reserve);
            currentWeapon.ammo += loaded; currentWeapon.reserve -= loaded;
            gun.rotation.z = 0; gun.position.y = baseGunPos.y; reloading = false; updateUI();
        }, currentWeapon.reloadTime);
    }

    function showMuzzleFlash() { muzzleFlash.visible = true; setTimeout(() => muzzleFlash.visible = false, 60); }
    function makeTracer() {
        const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 6), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
        tracer.position.copy(camera.position); tracer.quaternion.copy(camera.quaternion); tracer.translateZ(-4);
        scene.add(tracer); setTimeout(() => scene.remove(tracer), 60);
    }

    function shootOnePellet() {
        const ray = new THREE.Raycaster();
        const spreadX = (Math.random() - 0.5) * currentWeapon.spread;
        const spreadY = (Math.random() - 0.5) * currentWeapon.spread;
        ray.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
        const obstacleHits = ray.intersectObjects(obstacles, false);
        const enemyParts = enemies.flatMap(e => e.parts);
        const enemyHits = ray.intersectObjects(enemyParts, false);
        if (!enemyHits.length) return;
        if (obstacleHits.length && obstacleHits[0].distance < enemyHits[0].distance) return;
        const hitPart = enemyHits[0].object;
        const enemy = enemies.find(e => e.parts.includes(hitPart));
        if (!enemy) return;
        const isHeadshot = hitPart === enemy.head;
        const damage = isHeadshot ? currentWeapon.headshotDamage : currentWeapon.damage;
        enemy.hp -= damage;
        hitPart.material.color.set(isHeadshot ? 0xffff00 : 0xff5555);
        playSound("hit", isHeadshot ? 0.9 : 0.45);
        if (isHeadshot) { playerStats.headshots++; showCenterMessage("HEADSHOT!", "#ffff00"); }
        setTimeout(() => { if (hitPart.parent) hitPart.material.color.set(isHeadshot ? 0xf0c090 : 0x8b5a2b); }, 100);
        if (enemy.hp <= 0) {
            const dx = camera.position.x - enemy.position.x;
            const dz = camera.position.z - enemy.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < 8) playerStats.closeRangeKills++; else if (dist > 25) playerStats.longRangeKills++;
            kills++; money += isHeadshot ? 100 : 50;
            scene.remove(enemy);
            enemies.splice(enemies.indexOf(enemy), 1);
            if (gameMode === "extraction") addLootObject(randomLootId(), enemy.position.x, enemy.position.z, false);
            spawnEnemy();
            enemyAI.aimSkill = Math.min(enemyAI.maxAimSkill, enemyAI.aimSkill + 0.008);
            saveMeta(); updateUI();
        }
    }

    function fireSingleShot() {
        if (currentWeapon.ammo <= 0) { reloadWeapon(); return false; }
        currentWeapon.ammo--; updateUI(); pitch += currentWeapon.recoil; playSound("shoot", 0.65); showMuzzleFlash(); makeTracer();
        gun.position.z += 0.08; setTimeout(() => gun.position.z = baseGunPos.z, 80);
        for (let i = 0; i < currentWeapon.pellets; i++) shootOnePellet();
        return true;
    }

    function shoot() {
        if (!gameStarted || document.pointerLockElement !== renderer.domElement || reloading) return;
        const now = performance.now();
        if (now - lastShotTime < currentWeapon.fireRate) return;
        lastShotTime = now;
        fireSingleShot();
    }

    function damagePlayer(amount) {
        if (isOwner() && devGod) return;
        // Armor reduces incoming damage before health. Helmet + chest rig help most in extraction.
        if (armorPoints > 0) {
            const absorbed = Math.min(armorPoints, amount * 0.65);
            armorPoints -= absorbed;
            amount -= absorbed;
        }
        health -= amount;
        playSound("hurt", 0.7);
        flashDamage();
        updateUI();
        if (health <= 0) {
            if (gameMode === "extraction" && raidActive) {
                loseRaidAndReturn();
            } else {
                alert("you died lol 💀");
                health = 100;
                camera.position.set(spawn.x, spawn.y, spawn.z);
            }
            health = 100;
            velocityY = 0;
            updateUI();
        }
    }

    function hasLineOfSight(from, to, ignoreParts = []) {
        const dir = new THREE.Vector3().subVectors(to, from).normalize();
        const dist = from.distanceTo(to);
        const ray = new THREE.Raycaster(from, dir, 0, dist);
        const hits = ray.intersectObjects(obstacles, false);
        return hits.length === 0;
    }

    function enemyShoot(enemy, dist, canSee) {
        if (!canSee || dist > enemyAI.shootRange) return;
        const now = performance.now();
        const cooldown = enemy.enemyClass === "sniper" ? 2100 : enemyAI.shootCooldownBase;
        if (now - enemy.lastShot < cooldown) return;
        enemy.lastShot = now;
        const chance = enemy.enemyClass === "sniper" ? enemyAI.aimSkill + 0.15 : enemyAI.aimSkill;
        if (Math.random() < chance) damagePlayer(enemy.enemyClass === "sniper" ? enemyAI.bulletDamage * 1.7 : enemyAI.bulletDamage);
    }

    function updateAdaptiveAI(dist, canSeePlayer) {
        const now = performance.now();
        if (dist < 8) playerStats.rushTicks++; else if (dist > 28) playerStats.longRangeTicks++;
        if (!canSeePlayer) playerStats.hidingTicks++;
        if (now - enemyAI.lastAdaptTime < 2500) return;
        enemyAI.lastAdaptTime = now;
        const maxStat = Math.max(playerStats.rushTicks, playerStats.longRangeTicks, playerStats.hidingTicks);
        if (maxStat === playerStats.hidingTicks && maxStat > 50) { playerStats.lastStrategy = "hiding/camping"; enemyAI.flankPower = 0.016; enemyAI.aggression = 0.030; }
        else if (maxStat === playerStats.rushTicks && maxStat > 50) { playerStats.lastStrategy = "rushing"; enemyAI.shootRange = 38; enemyAI.aggression = 0.018; }
        else if (maxStat === playerStats.longRangeTicks && maxStat > 50) { playerStats.lastStrategy = "sniping/distance"; enemyAI.aggression = 0.040; enemyAI.shootRange = 42; }
        else { playerStats.lastStrategy = "balanced"; }
        enemyAI.aimSkill = Math.min(enemyAI.maxAimSkill, enemyAI.aimSkill + 0.006);
        playerStats.hidingTicks *= 0.9; playerStats.rushTicks *= 0.9; playerStats.longRangeTicks *= 0.9;
    }

    function facePlayerUpright(enemy) {
        const dx = camera.position.x - enemy.position.x;
        const dz = camera.position.z - enemy.position.z;
        enemy.rotation.x = 0; enemy.rotation.z = 0; enemy.rotation.y = Math.atan2(dx, dz);
    }

    function moveEntityWithCollision(entity, dx, dz, size = new THREE.Vector3(1, 2.4, 1)) {
        const oldX = entity.position.x; const oldZ = entity.position.z;
        entity.position.x += dx;
        let box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(entity.position.x, 1.2, entity.position.z), size);
        for (const obstacle of obstacles) if (box.intersectsBox(new THREE.Box3().setFromObject(obstacle))) { entity.position.x = oldX; break; }
        entity.position.z += dz;
        box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(entity.position.x, 1.2, entity.position.z), size);
        for (const obstacle of obstacles) if (box.intersectsBox(new THREE.Box3().setFromObject(obstacle))) { entity.position.z = oldZ; break; }
    }

    function movePlayerWithCollision(dx, dz) {
        const fake = { position: camera.position };
        moveEntityWithCollision(fake, dx, dz, new THREE.Vector3(0.8, 1.8, 0.8));
    }

    function updateEnemy(enemy) {
        const dx = camera.position.x - enemy.position.x;
        const dz = camera.position.z - enemy.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        const canSee = hasLineOfSight(new THREE.Vector3(enemy.position.x, 1.8, enemy.position.z), camera.position.clone());
        updateAdaptiveAI(dist, canSee);
        let moveX = 0, moveZ = 0;
        const wanted = enemy.enemyClass === "sniper" ? 22 : 1.1;
        if (dist > wanted) { moveX += (dx / dist) * enemy.moveSpeed * (canSee ? 0.75 : 1.4); moveZ += (dz / dist) * enemy.moveSpeed * (canSee ? 0.75 : 1.4); }
        if (canSee && dist < 30) {
            if (performance.now() > enemy.nextStrafeChange) { enemy.strafeDir *= -1; enemy.nextStrafeChange = performance.now() + 1000 + Math.random() * 2000; }
            moveX += (dz / dist) * enemyAI.flankPower * enemy.strafeDir;
            moveZ += (-dx / dist) * enemyAI.flankPower * enemy.strafeDir;
        }
        moveEntityWithCollision(enemy, moveX, moveZ);
        facePlayerUpright(enemy);
        const walkTime = performance.now() * 0.008;
        enemy.leftArm.rotation.x = Math.sin(walkTime) * 0.5;
        enemy.rightArm.rotation.x = -Math.sin(walkTime) * 0.5;
        enemy.leftLeg.rotation.x = -Math.sin(walkTime) * 0.5;
        enemy.rightLeg.rotation.x = Math.sin(walkTime) * 0.5;
        enemyShoot(enemy, dist, canSee);
        if (dist < 1.2) damagePlayer(0.12);
    }

    addEventListener("keydown", e => {
        if (chatFocused) return;
        keys[e.key.toLowerCase()] = true;
        if (e.key === "1") switchWeapon(weapons.pistol);
        if (e.key === "2") switchWeapon(weapons.ar);
        if (e.key === "3") switchWeapon(weapons.shotgun);
        if (e.key === "4") switchWeapon(weapons.sniper);
        if (e.key === "5") switchWeapon(weapons.smg);
        if (e.key.toLowerCase() === "r") reloadWeapon();
        if (e.key.toLowerCase() === "f") toggleVehicle();
        if (e.key.toLowerCase() === "i") openShop();
        if (e.key.toLowerCase() === "b" && gameMode === "menu") openShop();
        if (e.key.toLowerCase() === "x") extractRaid();
        if (e.key === "Escape" && gameMode === "ffa") exitFFAtoLoadingScreen();
        if (e.key === "F9") toggleDevMode();
        if (e.key.toLowerCase() === "v") toggleDevFly();
        if (e.key.toLowerCase() === "g") toggleDevGod();
        if (e.key.toLowerCase() === "e") {
            if (nearPurpleVault) openPurpleVault(nearPurpleVault);
            else if (nearLoot) pickupLoot(nearLoot);

        }
    });
    addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
    addEventListener("mousedown", e => { if (e.button === 0) keys.mouse = true; if (e.button === 2 && currentWeapon.name === "Sniper") { scoped = true; camera.fov = 25; camera.updateProjectionMatrix(); scopeOverlay.style.display = "block"; updateUI(); } });
    addEventListener("mouseup", e => { if (e.button === 0) keys.mouse = false; if (e.button === 2) { scoped = false; camera.fov = 75; camera.updateProjectionMatrix(); scopeOverlay.style.display = "none"; updateUI(); } });
    addEventListener("click", shoot);
    addEventListener("contextmenu", e => e.preventDefault());
    document.addEventListener("mousemove", e => {
        if (document.pointerLockElement === renderer.domElement) {
            yaw -= e.movementX * mouseSensitivity;
            pitch -= e.movementY * mouseSensitivity;
            const limit = THREE.MathUtils.degToRad(80);
            pitch = Math.max(-limit, Math.min(limit, pitch));
        }
    });

    function checkNearbyInteractables() {
        nearShop = false;
        nearPurpleVault = null;
        nearExtract = extractZones.some(ex => camera.position.distanceTo(new THREE.Vector3(ex.position.x, camera.position.y, ex.position.z)) < 4.5);
        nearLoot = null;
        let best = 2.2;
        for (const vault of purpleVaults) {
            if (!vault.userData.opened) {
                const dist = camera.position.distanceTo(new THREE.Vector3(vault.position.x, camera.position.y, vault.position.z - 4.5));
                if (dist < 5.2) nearPurpleVault = vault;
            }
        }
        for (const loot of lootObjects) {
            loot.rotation.y += 0.02;
            const dist = camera.position.distanceTo(loot.position);
            if (dist < best) { best = dist; nearLoot = loot; }
        }
    }

    function updateExtractCompass() {
        if (gameMode !== "extraction" || !extractZones.length) {
            compass.style.display = "none";
            return;
        }
        compass.style.display = "block";
        let nearest = null;
        let best = Infinity;
        for (const ex of extractZones) {
            const dx = ex.position.x - camera.position.x;
            const dz = ex.position.z - camera.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < best) { best = dist; nearest = ex; }
        }
        if (!nearest) return;
        const dx = nearest.position.x - camera.position.x;
        const dz = nearest.position.z - camera.position.z;
        const worldAngle = Math.atan2(dx, dz);
        const relative = worldAngle - yaw;
        extractArrow.style.transform = `rotate(${relative}rad)`;
        extractCompassText.textContent = `${nearest.userData.name || "Extract"} - ${Math.round(best)}m`;
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!gameStarted) { renderer.render(scene, camera); return; }
        camera.rotation.order = "YXZ";
        camera.rotation.y = yaw; camera.rotation.x = pitch; camera.rotation.z = 0;
        const sprinting = keys.shift;
        const speed = inVehicle ? 0.55 : (sprinting ? 0.28 : 0.15);
        let moving = false, moveX = 0, moveZ = 0;
        if (keys.w) { moveX -= Math.sin(yaw) * speed; moveZ -= Math.cos(yaw) * speed; moving = true; }
        if (keys.s) { moveX += Math.sin(yaw) * speed; moveZ += Math.cos(yaw) * speed; moving = true; }
        if (keys.a) { moveX -= Math.cos(yaw) * speed; moveZ += Math.sin(yaw) * speed; moving = true; }
        if (keys.d) { moveX += Math.cos(yaw) * speed; moveZ -= Math.sin(yaw) * speed; moving = true; }
        if (isOwner() && devFly) {
            camera.position.x += moveX;
            camera.position.z += moveZ;
            if (keys[" "] || keys.pageup) camera.position.y += 0.28;
            if (keys.control || keys.pagedown) camera.position.y -= 0.28;
            if (camera.position.y < 1.7) camera.position.y = 1.7;
            onGround = false;
            velocityY = 0;
        } else {
            movePlayerWithCollision(moveX, moveZ);
            if (keys[" "] && onGround) { velocityY = 0.18; onGround = false; }
            velocityY -= 0.01; camera.position.y += velocityY;
            if (camera.position.y <= spawn.y) { camera.position.y = spawn.y; velocityY = 0; onGround = true; }
        }
        if (inVehicle && vehicle) { vehicle.position.x = camera.position.x; vehicle.position.z = camera.position.z; vehicle.rotation.y = yaw; }
        if (moving && onGround && !reloading) {
            const bob = Math.sin(performance.now() * 0.012) * 0.035;
            gun.position.y = baseGunPos.y + bob;
            gun.position.x = baseGunPos.x + Math.cos(performance.now() * 0.012) * 0.015;
        } else if (!reloading) gun.position.lerp(baseGunPos, 0.15);
        if (currentWeapon.auto && keys.mouse && !reloading && document.pointerLockElement === renderer.domElement) shoot();
        checkNearbyInteractables();
        updateExtractTimer();
        enemies.forEach(updateEnemy);
        updateExtractCompass();
        const bound = gameMode === "extraction" ? 235 : 215;
        if (Math.abs(camera.position.x) > bound || Math.abs(camera.position.z) > bound) camera.position.set(spawn.x, spawn.y, spawn.z);
        updateUI();
        renderer.render(scene, camera);
    }

    updateUI();
    animate();

    addEventListener("resize", () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(innerWidth, innerHeight, false);
        renderer.domElement.style.width = "100vw";
        renderer.domElement.style.height = "100vh";
    });
})();