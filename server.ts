import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import cors from "cors";

const db = new Database("cyclecare.db");

// Initialize SQLite schema
db.exec(`
  CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    startDate TEXT NOT NULL,
    duration INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    date TEXT NOT NULL,
    flow TEXT,
    sex TEXT,
    sex_desire TEXT,
    temperature REAL,
    lh_test TEXT,
    pregnancy_test TEXT,
    mucus TEXT,
    symptoms TEXT,
    notes TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(uid, date)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", database: "sqlite", version: "pro-clue-clone" });
  });

  // Cycles API
  app.get("/api/cycles/:uid", (req, res) => {
    try {
      const cycles = db.prepare("SELECT * FROM cycles WHERE uid = ? ORDER BY startDate DESC").all(req.params.uid);
      res.json(cycles);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/cycles", (req, res) => {
    const { uid, startDate, duration } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO cycles (uid, startDate, duration) VALUES (?, ?, ?)");
      const result = stmt.run(uid, startDate, duration || null);
      res.json({ id: result.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Daily Logs API
  app.post("/api/logs", (req, res) => {
    const { 
      uid, date, flow, sex, sex_desire, temperature, lh_test, pregnancy_test, mucus, symptoms, notes 
    } = req.body;
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO daily_logs (
          uid, date, flow, sex, sex_desire, temperature, lh_test, pregnancy_test, mucus, symptoms, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        uid, date, flow, sex, sex_desire, temperature, lh_test, pregnancy_test, mucus, 
        JSON.stringify(symptoms || []), notes
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/logs/:uid", (req, res) => {
    try {
      const logs = db.prepare("SELECT * FROM daily_logs WHERE uid = ? ORDER BY date DESC").all(req.params.uid);
      res.json(logs.map((l: any) => ({ 
        ...l, 
        symptoms: JSON.parse(l.symptoms || "[]") 
      })));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
