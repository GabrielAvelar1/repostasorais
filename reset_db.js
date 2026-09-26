const { db, setSetting } = require('./db');

db.prepare('DELETE FROM exam_answers').run();
db.prepare('DELETE FROM student_exams').run();
db.prepare("DELETE FROM users WHERE role != 'teacher'").run();
setSetting('exam_open', '0');
setSetting('grades_released', '0');

const teacher = db.prepare("SELECT * FROM users WHERE role = 'teacher'").get();
const qCount = db.prepare("SELECT COUNT(*) as c FROM questions").get().c;
const uCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;

console.log(`✅ Banco de dados preparado:`);
console.log(`- Usuários cadastrados: ${uCount} (${teacher.full_name} - ${teacher.registration})`);
console.log(`- Questões no banco: ${qCount}`);
console.log(`- Prova liberada: NÃO (bloqueada até a professora liberar)`);
console.log(`- Notas liberadas: NÃO (ocultas até a professora liberar)`);
