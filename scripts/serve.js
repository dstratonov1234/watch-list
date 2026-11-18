#!/usr/bin/env node
// Локальный сервер сайта без Python:  node scripts/serve.js [порт]
// Нужен там, где `python -m http.server` не запускается (macOS: команды `python` нет, а системный python3
// из панели предпросмотра не получает доступ к папке проекта в Downloads/Documents).
// Отдаёт папку репозитория только на 127.0.0.1 и без кэша — правка темы видна сразу после перезагрузки.
// Порт: аргумент, иначе переменная PORT (её задаёт панель предпросмотра, если 8780 занят), иначе 8780.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8780);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

http
  .createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return send(res, 400, "Bad Request");
    }
    let file = path.join(ROOT, rel);
    // Наружу из папки репозитория и в служебное (.git) не ходим.
    const inside = path.relative(ROOT, file);
    if (inside.startsWith("..") || path.isAbsolute(inside) || inside.split(path.sep).includes(".git")) return send(res, 403, "Forbidden");

    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!rel.endsWith("/")) {
          res.writeHead(301, { Location: rel + "/" });
          return res.end();
        }
        file = path.join(file, "index.html");
      }
      fs.readFile(file, (e, data) => {
        if (e) return send(res, 404, "Not Found");
        res.writeHead(200, {
          "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Content-Length": data.length,
          "Cache-Control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : data);
      });
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Watch List: http://localhost:${PORT}`));
