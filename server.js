
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const makeToken = () => crypto.randomBytes(16).toString("hex");

let game = {
  pin: String(Math.floor(100000 + Math.random() * 900000)),
  teacherToken: makeToken(),
  teams: [],
  round: 0,
  question: 0,
  phase: "lobby",
  votes: {},
  verdict: null
};

function publicState() {
  return {
    pin: game.pin,
    teams: game.teams.map(t => ({
      id: t.id,
      name: t.name,
      zombies: t.zombies
    })),
    round: game.round,
    question: game.question,
    phase: game.phase,
    votesReceived: Object.keys(game.votes).length,
    verdict: game.phase === "revealed" ? game.verdict : null
  };
}

function update() {
  io.emit("game:update", publicState());
}

io.on("connection", socket => {
  socket.emit("game:update", publicState());

  socket.on("teacher:login", (token, reply) => {
    reply({ ok: token === game.teacherToken });
  });

  socket.on("team:join", ({ pin, name }, reply) => {
    if (pin !== game.pin || game.phase !== "lobby") {
      return reply({ error: "Invalid PIN or game already started" });
    }
    if (game.teams.length >= 8) {
      return reply({ error: "Game is full" });
    }
    const team = {
      id: makeToken(),
      name: String(name).slice(0, 25),
      zombies: 3
    };
    game.teams.push(team);
    reply({ ok: true, teamId: team.id });
    update();
  });

  socket.on("teacher:start", (token) => {
    if (token !== game.teacherToken) return;
    if (game.teams.length < 2) return;
    game.phase = "voting";
    update();
  });

  socket.on("team:vote", ({ teamId, vote }) => {
    if (game.phase !== "voting") return;
    if (!["JOIN", "RUN"].includes(vote)) return;
    const team = game.teams.find(t => t.id === teamId);
    if (!team) return;
    if (team === game.teams[game.round]) return;
    game.votes[teamId] = vote;
    update();
  });

  socket.on("teacher:verdict", ({ token, verdict }) => {
    if (token !== game.teacherToken) return;
    if (game.phase !== "voting") return;
    if (!["correct", "wrong"].includes(verdict)) return;
    game.verdict = verdict;
    // Deliberately not shown to students yet.
  });

  socket.on("teacher:reveal", (token) => {
    if (token !== game.teacherToken) return;
    if (game.phase !== "voting" || !game.verdict) return;

    const presenter = game.teams[game.round];

    for (const team of game.teams) {
      if (team.id === presenter.id) continue;
      const vote = game.votes[team.id];

      if (game.verdict === "correct" && vote === "JOIN") {
        team.zombies += 2;
        presenter.zombies += 1;
      }

      if (game.verdict === "wrong" && vote === "RUN") {
        team.zombies += 5;
      }
    }

    game.phase = "revealed";
    update();
  });

  socket.on("teacher:next", (token) => {
    if (token !== game.teacherToken) return;
    if (game.phase !== "revealed") return;

    if (game.question === 0) {
      game.question = 1;
    } else {
      game.question = 0;
      game.round += 1;
    }

    game.votes = {};
    game.verdict = null;
    game.phase = game.round >= game.teams.length
      ? "finished"
      : "voting";

    update();
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Vertical Bite Hordes server running");
});
