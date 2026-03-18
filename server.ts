import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "vaastu-reminder-secret-key-2026";

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const db = (() => {
  try {
    const database = new Database("reminders.db");
    console.log("Database initialized successfully");
    // Test query
    const result = database.prepare("SELECT 1").get();
    console.log("Database test query successful:", result);
    return database;
  } catch (err) {
    console.error("Failed to initialize database:", err);
    return null;
  }
})();

// Initialize Database
if (db) {
  try {
    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create reminders table with user_id
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        type TEXT DEFAULT 'task',
        repeat TEXT DEFAULT 'none',
        remind_before INTEGER DEFAULT 0,
        notes TEXT,
        priority TEXT DEFAULT 'normal',
        tags TEXT,
        share_to TEXT,
        is_special INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        voice_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
    
    // Check if user_id column exists in reminders (migration)
    const tableInfo = db.prepare("PRAGMA table_info(reminders)").all() as any[];
    const hasUserId = tableInfo.some(col => col.name === 'user_id');
    if (!hasUserId) {
      console.log("Migrating reminders table to add user_id...");
      db.exec("ALTER TABLE reminders ADD COLUMN user_id INTEGER DEFAULT 1");
    }

    const hasVoiceData = tableInfo.some(col => col.name === 'voice_data');
    if (!hasVoiceData) {
      console.log("Migrating reminders table to add voice_data...");
      db.exec("ALTER TABLE reminders ADD COLUMN voice_data TEXT");
    }

    console.log("Database schema verified");
  } catch (err) {
    console.error("Failed to initialize database schema:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: (origin, callback) => {
      // Allow all origins in this environment
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
  }));

  // Request logger
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Origin: ${origin}`);
    next();
  });

  // Middleware to verify JWT
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const info = db!.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(username, hashedPassword);
      const token = jwt.sign({ id: info.lastInsertRowid, username }, JWT_SECRET);
      res.cookie("token", token, { httpOnly: true, secure: true, sameSite: 'none' });
      res.json({ success: true, user: { id: info.lastInsertRowid, username } });
    } catch (err: any) {
      if (err.message.includes("UNIQUE")) {
        return res.status(400).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const user = db!.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ success: true, user: { id: user.id, username: user.username } });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Not logged in" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      res.json({ user: decoded });
    } catch (err) {
      res.status(401).json({ error: "Invalid session" });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    console.log("Health check requested");
    res.json({ status: "ok", database: !!db, time: new Date().toISOString() });
  });

  // Ping endpoint
  app.get("/api/ping", (req, res) => {
    console.log("Ping requested");
    res.json({ pong: true, time: new Date().toISOString() });
  });

  // API: Reminders CRUD (Protected)
  app.get("/api/reminders", authenticate, (req: any, res) => {
    if (!db) {
      console.error("Database not available during fetch");
      return res.status(500).json({ error: "Database not available" });
    }
    try {
      console.log(`Fetching reminders for user: ${req.user.id}`);
      const rows = db.prepare("SELECT * FROM reminders WHERE user_id = ? ORDER BY is_pinned DESC, date ASC, time ASC").all(req.user.id);
      console.log(`Found ${rows.length} reminders`);
      res.json(rows);
    } catch (err) {
      console.error("Fetch error:", err);
      res.status(500).json({ error: "Failed to fetch reminders" });
    }
  });

  app.post("/api/reminders", authenticate, (req: any, res) => {
    if (!db) return res.status(500).json({ error: "Database not available" });
    try {
      const { title, date, time, type, repeat, remind_before, notes, priority, tags, share_to, is_special, is_pinned, voice_data } = req.body;
      const info = db.prepare(`
        INSERT INTO reminders (user_id, title, date, time, type, repeat, remind_before, notes, priority, tags, share_to, is_special, is_pinned, voice_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, title, date, time, type, repeat, remind_before, notes, priority, tags, share_to, is_special ? 1 : 0, is_pinned ? 1 : 0, voice_data);
      res.json({ id: info.lastInsertRowid });
    } catch (err) {
      console.error("Insert error:", err);
      res.status(500).json({ error: "Failed to create reminder" });
    }
  });

  app.delete("/api/reminders/:id", authenticate, (req: any, res) => {
    if (!db) return res.status(500).json({ error: "Database not available" });
    try {
      const result = db.prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Reminder not found" });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete error:", err);
      res.status(500).json({ error: "Failed to delete reminder" });
    }
  });

  app.patch("/api/reminders/:id/pin", authenticate, (req: any, res) => {
    const { is_pinned } = req.body;
    db!.prepare("UPDATE reminders SET is_pinned = ? WHERE id = ? AND user_id = ?").run(is_pinned ? 1 : 0, req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.put("/api/reminders/:id", authenticate, (req: any, res) => {
    const { title, date, time, type, repeat, remind_before, notes, priority, tags, share_to, is_special, is_pinned, voice_data } = req.body;
    db!.prepare(`
      UPDATE reminders 
      SET title = ?, date = ?, time = ?, type = ?, repeat = ?, remind_before = ?, notes = ?, priority = ?, tags = ?, share_to = ?, is_special = ?, is_pinned = ?, voice_data = ?
      WHERE id = ? AND user_id = ?
    `).run(title, date, time, type, repeat, remind_before, notes, priority, tags, share_to, is_special ? 1 : 0, is_pinned ? 1 : 0, voice_data, req.params.id, req.user.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
