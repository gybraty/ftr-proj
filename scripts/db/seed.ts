import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function seed(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read and apply schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('Schema applied');

    // Truncate all tables in reverse dependency order
    await client.query(`
      TRUNCATE TABLE student.enrollments CASCADE;
      TRUNCATE TABLE student.students CASCADE;
      TRUNCATE TABLE payment.payment_steps CASCADE;
      TRUNCATE TABLE payment.payments CASCADE;
      TRUNCATE TABLE records.grades CASCADE;
      TRUNCATE TABLE records.tuition_status CASCADE;
      TRUNCATE TABLE timetable.timetables CASCADE;
      ALTER SEQUENCE student.students_id_seq RESTART WITH 1;
      ALTER SEQUENCE student.enrollments_id_seq RESTART WITH 1;
      ALTER SEQUENCE payment.payments_id_seq RESTART WITH 1;
      ALTER SEQUENCE payment.payment_steps_id_seq RESTART WITH 1;
      ALTER SEQUENCE records.grades_id_seq RESTART WITH 1;
      ALTER SEQUENCE records.tuition_status_id_seq RESTART WITH 1;
      ALTER SEQUENCE timetable.timetables_id_seq RESTART WITH 1;
    `);
    console.log('Tables truncated and sequences reset');

    // Insert 100 students
    for (let i = 1; i <= 100; i++) {
      await client.query(
        'INSERT INTO student.students (name, email) VALUES ($1, $2)',
        [`Student ${i}`, `student${i}@uni.test`]
      );
    }
    console.log('Inserted 100 students');

    // Insert 250 grades (students 1-50, courses 1-5)
    const grades = ['A', 'B', 'C', 'D'];
    for (let studentId = 1; studentId <= 50; studentId++) {
      for (let courseId = 1; courseId <= 5; courseId++) {
        const gradeIndex = (studentId + courseId) % 4;
        const grade = grades[gradeIndex];
        await client.query(
          'INSERT INTO records.grades (student_id, course_id, grade) VALUES ($1, $2, $3)',
          [studentId, courseId, grade]
        );
      }
    }
    console.log('Inserted 250 grades');

    // Insert 10 timetables (courses 1-10)
    for (let courseId = 1; courseId <= 10; courseId++) {
      const slot = `Mon ${String(courseId).padStart(2, "0")}:00`;
      const room = `R10${courseId}`;
      await client.query(
        'INSERT INTO timetable.timetables (course_id, slot, room) VALUES ($1, $2, $3)',
        [courseId, slot, room]
      );
    }
    console.log('Inserted 10 timetables');

    console.log('Seed completed successfully');
  } finally {
    await client.end();
  }
}

export { seed };

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://ftr:ftr@localhost:5432/university';
  seed(databaseUrl).catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
