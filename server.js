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
    res.send("Bamboo FPS multiplayer server is running with PVP");
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
        health: 100
    };

    socket.emit("currentPlayers", players);
    socket.broadcast.emit("playerJoined", players[socket.id]);

    socket.on("updatePlayer", data => {
        if (!players[socket.id]) return;

        const oldHealth = players[socket.id].health ?? 100;

        players[socket.id] = {
            ...players[socket.id],
            ...data,
            id: socket.id,
            // Preserve server-side PVP health unless the player is respawning/resetting.
            health: Number(data?.health ?? oldHealth)
        };

        socket.broadcast.emit("playerMoved", players[socket.id]);
    });

    socket.on("playerShot", data => {
        const attacker = players[socket.id];
        const targetId = data?.targetId;
        const target = players[targetId];

        if (!attacker || !target || targetId === socket.id) return;

        const rawDamage = Number(data?.damage || 0);
        const damage = Math.max(0, Math.min(rawDamage, 150));
        if (damage <= 0) return;

        target.health = Math.max(0, (target.health ?? 100) - damage);

        io.to(targetId).emit("pvpDamaged", {
            attackerId: socket.id,
            attackerName: attacker.name || "Player",
            damage,
            targetHealth: target.health
        });

        socket.emit("pvpHitConfirmed", {
            targetId,
            targetName: target.name || "Player",
            damage,
            targetHealth: target.health
        });

        if (target.health <= 0) {
            io.emit("pvpKilled", {
                killerId: socket.id,
                killerName: attacker.name || "Player",
                victimId: targetId,
                victimName: target.name || "Player"
            });

            // Respawn target health on the server so they can keep playing.
            target.health = 100;
        }

        io.emit("currentPlayers", players);
    });

    socket.on("chatMessage", msg => {
        io.emit("chatMessage", {
            id: socket.id,
            name: players[socket.id]?.name || "Player",
            message: msg
        });
    });

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
