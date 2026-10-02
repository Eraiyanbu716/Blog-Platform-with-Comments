import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "blog.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "development_secret_change_me";

function createToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Blog API is running" });
});

// AUTH
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) return res.status(409).json({ message: "Email already registered" });

  const hash = await bcrypt.hash(password, 10);
  const result = db
    .prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)")
    .run(name.trim(), normalizedEmail, hash);

  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ user, token: createToken(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email?.trim().toLowerCase());

  if (!user || !(await bcrypt.compare(password || "", user.password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const safeUser = { id: user.id, name: user.name, email: user.email };
  res.json({ user: safeUser, token: createToken(safeUser) });
});

// POSTS
app.get("/api/posts", (req, res) => {
  const posts = db.prepare(`
    SELECT p.id, p.title, p.content, p.author_id, p.created_at, p.updated_at,
           u.name AS author_name,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    ORDER BY p.created_at DESC
  `).all();

  res.json(posts);
});

app.get("/api/posts/:id", (req, res) => {
  const post = db.prepare(`
    SELECT p.id, p.title, p.content, p.author_id, p.created_at, p.updated_at,
           u.name AS author_name
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ message: "Post not found" });

  const comments = db.prepare(`
    SELECT c.id, c.content, c.author_id, c.created_at, u.name AS author_name
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.json({ ...post, comments });
});

app.post("/api/posts", auth, (req, res) => {
  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ message: "Title and content are required" });
  }

  const result = db
    .prepare("INSERT INTO posts (title, content, author_id) VALUES (?, ?, ?)")
    .run(title.trim(), content.trim(), req.user.id);

  const post = db.prepare(`
    SELECT p.*, u.name AS author_name
    FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(post);
});

app.put("/api/posts/:id", auth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ message: "Post not found" });
  if (post.author_id !== req.user.id) return res.status(403).json({ message: "You can only edit your own posts" });

  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ message: "Title and content are required" });
  }

  db.prepare(`
    UPDATE posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(title.trim(), content.trim(), req.params.id);

  res.json(db.prepare(`
    SELECT p.*, u.name AS author_name
    FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
  `).get(req.params.id));
});

app.delete("/api/posts/:id", auth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ message: "Post not found" });
  if (post.author_id !== req.user.id) return res.status(403).json({ message: "You can only delete your own posts" });

  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ message: "Post deleted successfully" });
});

// COMMENTS
app.get("/api/posts/:id/comments", (req, res) => {
  const comments = db.prepare(`
    SELECT c.id, c.content, c.author_id, c.created_at, u.name AS author_name
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.json(comments);
});

app.post("/api/posts/:id/comments", auth, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ message: "Comment cannot be empty" });

  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ message: "Post not found" });

  const result = db.prepare(`
    INSERT INTO comments (content, post_id, author_id) VALUES (?, ?, ?)
  `).run(content.trim(), req.params.id, req.user.id);

  const comment = db.prepare(`
    SELECT c.id, c.content, c.author_id, c.created_at, u.name AS author_name
    FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(comment);
});

app.delete("/api/comments/:id", auth, (req, res) => {
  const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id);
  if (!comment) return res.status(404).json({ message: "Comment not found" });
  if (comment.author_id !== req.user.id) return res.status(403).json({ message: "You can only delete your own comments" });

  db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
  res.json({ message: "Comment deleted successfully" });
});

app.listen(PORT, () => {
  console.log(`Blog API running at http://localhost:${PORT}`);
});
