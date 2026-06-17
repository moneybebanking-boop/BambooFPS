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

```
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

    players[socket.id] = {
        ...players[socket.id],
        ...data,
        id: socket.id
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

socket.on("playerHit", data => {

    const victim = players[data.targetId];
    const attacker = players[socket.id];

    if (!victim || !attacker) return;

    victim.health -= data.damage || 25;

    if (victim.health <= 0) {

        victim.deaths++;
        attacker.kills++;

        io.emit("playerKilled", {
            killer: attacker.name,
            victim: victim.name
        });

        victim.health = 100;

        victim.x = 0;
        victim.y = 1.7;
        victim.z = 0;
    }

    io.emit("playerHealthUpdate", {
        id: victim.id,
        health: victim.health
    });

});

socket.on("disconnect", () => {

    console.log("Player disconnected:", socket.id);

    delete players[socket.id];

    io.emit("playerLeft", socket.id);

});
```

});

setInterval(() => {
io.emit("currentPlayers", players);
}, 1000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
console.log(`Server running on port ${PORT}`);
});
