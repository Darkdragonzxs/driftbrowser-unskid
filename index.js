import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
import config from "./config.js";

import { server as wisp } from "@mercuryworkshop/wisp-js/server";

console.log(chalk.yellow("Starting Node.js server with Wisp at /wisp/"));

const __dirname = process.cwd();
const app = express();
const bareServer = createBareServer("/fq/");
const PORT = process.env.PORT || 6969;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

if (config.challenge !== false) {
  Object.entries(config.users).forEach(([u, p]) => {
    console.log(chalk.blue(`Username: ${u}, Password: ${p}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
    const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp <= CACHE_TTL) {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
      cache.delete(req.path);
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget = null;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) return next();

    const asset = await fetch(reqTarget);
    if (!asset.ok) return next();

    const buf = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext) ? "application/octet-stream" : mime.getType(ext);

    cache.set(req.path, { data: buf, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(buf);
  } catch (err) {
    console.error("Error fetching asset:", err);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "mango")));
app.use("/fq", cors({ origin: true }));

const server = http.createServer(app);

/*  
   WISP ON /wisp/  
   This makes all WebSocket upgrade requests to /wisp/* 
   be handled by wisp-js.
*/
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.listen(PORT, () => {
  console.log(chalk.greenBright(`Server running at http://localhost:${PORT}`));
  console.log(chalk.magenta(`Wisp active at ws://localhost:${PORT}/wisp/`));
});
