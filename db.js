const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    expected_answer TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    total_score REAL DEFAULT NULL,
    submitted_at DATETIME DEFAULT NULL,
    graded_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS exam_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    order_num INTEGER NOT NULL,
    student_answer TEXT DEFAULT '',
    ai_score REAL DEFAULT NULL,
    ai_feedback TEXT DEFAULT NULL,
    teacher_score REAL DEFAULT NULL,
    teacher_feedback TEXT DEFAULT NULL,
    final_score REAL DEFAULT NULL,
    FOREIGN KEY (exam_id) REFERENCES student_exams(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id)
  );
`);

// Initialize settings if not set
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function getSetting(key, defaultValue = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

if (!getSetting('exam_open')) setSetting('exam_open', '0');
if (!getSetting('grades_released')) setSetting('grades_released', '0');
if (!getSetting('exam_title')) setSetting('exam_title', 'Prova Oral de Odontopediatria');

// Initialize Teacher account: Patricia / 12345
const findTeacher = db.prepare("SELECT * FROM users WHERE registration = '12345'").get();
if (!findTeacher) {
  db.prepare("INSERT INTO users (registration, full_name, role) VALUES ('12345', 'Patricia', 'teacher')").run();
  console.log('Conta da Professora Patricia (12345) criada com sucesso.');
}

// Populate questions if empty
const countQuestions = db.prepare('SELECT COUNT(*) as count FROM questions').get();
if (countQuestions.count === 0) {
  const jsonPath = path.join(__dirname, 'perguntas.json');
  if (fs.existsSync(jsonPath)) {
    const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const insertQ = db.prepare('INSERT INTO questions (id, question, expected_answer) VALUES (?, ?, ?)');
    for (const item of list) {
      insertQ.run(item.id, item.question, item.expectedAnswer);
    }
    console.log(`Carregadas ${list.length} questões no banco de dados.`);
  }
}

module.exports = {
  db,
  getSetting,
  setSetting
};
