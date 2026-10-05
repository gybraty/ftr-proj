CREATE SCHEMA IF NOT EXISTS student;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS records;
CREATE SCHEMA IF NOT EXISTS timetable;

CREATE TABLE IF NOT EXISTS student.students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS student.enrollments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL,
  course_id INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS payment.payments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment.payment_steps (
  id SERIAL PRIMARY KEY,
  payment_id INT NOT NULL REFERENCES payment.payments(id),
  step TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS records.grades (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL,
  course_id INT NOT NULL,
  grade TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records.tuition_status (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL,
  term TEXT NOT NULL DEFAULT '2026S',
  paid BOOLEAN NOT NULL DEFAULT false,
  payment_id INT,
  UNIQUE (student_id, term)
);

CREATE TABLE IF NOT EXISTS timetable.timetables (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL,
  slot TEXT NOT NULL,
  room TEXT NOT NULL
);
