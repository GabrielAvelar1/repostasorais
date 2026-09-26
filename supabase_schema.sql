-- ========================================================
-- ESQUEMA DO BANCO DE DADOS SUPABASE (POSTGRESQL)
-- Sistema de Provas Orais - Professora Patricia
-- ========================================================

-- 1. TABELA DE USUÁRIOS
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  registration TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE CONFIGURAÇÕES
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 3. TABELA DE QUESTÕES
CREATE TABLE IF NOT EXISTS questions (
  id BIGINT PRIMARY KEY,
  question TEXT NOT NULL,
  expected_answer TEXT NOT NULL
);

-- 4. TABELA DE EXAMES DOS ALUNOS
CREATE TABLE IF NOT EXISTS student_exams (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  total_score NUMERIC(4, 1) DEFAULT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NULL,
  graded_at TIMESTAMPTZ DEFAULT NULL
);

-- 5. TABELA DE RESPOSTAS DAS QUESTÕES
CREATE TABLE IF NOT EXISTS exam_answers (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES student_exams(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id),
  order_num INT NOT NULL,
  student_answer TEXT DEFAULT '',
  ai_score NUMERIC(4, 1) DEFAULT NULL,
  ai_feedback TEXT DEFAULT NULL,
  teacher_score NUMERIC(4, 1) DEFAULT NULL,
  teacher_feedback TEXT DEFAULT NULL,
  final_score NUMERIC(4, 1) DEFAULT NULL
);

-- Desativar RLS para permitir que o backend e os alunos façam leituras e gravações
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_exams DISABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers DISABLE ROW LEVEL SECURITY;

-- Inserir dados iniciais
INSERT INTO users (registration, full_name, role)
VALUES ('12345', 'Patricia', 'teacher')
ON CONFLICT (registration) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('exam_open', '0'),
  ('grades_released', '0'),
  ('exam_title', 'Prova Oral de Odontopediatria'),
  ('ai_model', 'gemini-3.8-flash')
ON CONFLICT (key) DO NOTHING;
