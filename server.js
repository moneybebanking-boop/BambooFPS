const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const players = {};

app.get("/", (req, res) => {
    res.send("Bamboo FPS multiplayer server is running");
});

io.on("connection", socket => {
    console.log("Player connected:", socket.id);

    players[socket.id] = {
        id: socket.id,
        name: "Player",
        x: 0,
        y: 1.7,
        z: 0,
        yaw: 0,
        pitch: 0,
        mode: "menu",
        health: 100,
        kills: 0,
        deaths: 0
    };

    socket.emit("currentPlayers", players);
    socket.broadcast.emit("playerJoined", players[socket.id]);

    socket.on("updatePlayer", data => {
        if (!players[socket.id]) return;

        const oldHealth = players[socket.id].health;
        const oldKills = players[socket.id].kills;
        const oldDeaths = players[socket.id].deaths;

        players[socket.id] = {
            ...players[socket.id],
            ...data,
            id: socket.id,
            health: oldHealth,
            kills: oldKills,
            deaths: oldDeaths
        };

        socket.broadcast.emit("playerMoved", players[socket.id]);
    });

    socket.on("chatMessage", msg => {
        io.emit("chatMessage", {
            id: socket.id,
            name: players[socket.id]?.name || "Player",
            message: msg
        });
    });

    function handlePvpShot(data = {}) {
        const attacker = players[socket.id];
        const victim = players[data.targetId];

        if (!attacker || !victim) return;
        if (attacker.id === victim.id) return;

        const damage = Math.max(1, Math.min(100, Number(data.damage) || 10));
        victim.health -= damage;

        console.log(`${attacker.name} hit ${victim.name} for ${damage}. ${victim.name} HP: ${victim.health}`);

        socket.emit("pvpHitConfirmed", {
            targetId: victim.id,
            targetName: victim.name,
            targetHealth: Math.max(0, victim.health),
            damage
        });

        io.to(victim.id).emit("pvpDamaged", {
            damage,
            attackerId: attacker.id,
            attackerName: attacker.name
        });

        if (victim.health <= 0) {
            attacker.kills += 1;
            victim.deaths += 1;

            io.emit("pvpKilled", {
                killerId: attacker.id,
                killerName: attacker.name,
                victimId: victim.id,
                victimName: victim.name
            });

            victim.health = 100;
            victim.x = 0;
            victim.y = 1.7;
            victim.z = 0;
        }

        io.emit("playerMoved", victim);
        io.emit("playerMoved", attacker);
    }

    // Client should emit this when a raycast hits another player.
    socket.on("playerShot", handlePvpShot);

    // Kept for backwards compatibility, but only use one of these on the client.
    socket.on("playerHit", handlePvpShot);

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);
        delete players[socket.id];
        io.emit("playerLeft", socket.id);
    });
});

setInterval(() => {
    io.emit("currentPlayers", players);
}, 1000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
