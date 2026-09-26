require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('⚠️ Para popular o Supabase, defina SUPABASE_URL e SUPABASE_KEY no arquivo .env.');
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log('Conectando ao Supabase:', supabaseUrl);

  // 1. Seed teacher Patricia
  const { data: teacher, error: teacherErr } = await supabase
    .from('users')
    .upsert({ registration: '12345', full_name: 'Patricia', role: 'teacher' }, { onConflict: 'registration' });
  if (teacherErr) console.warn('Aviso usuário professor:', teacherErr.message);
  else console.log('✅ Professora Patricia configurada no Supabase.');

  // 2. Seed settings
  const settings = [
    { key: 'exam_open', value: '0' },
    { key: 'grades_released', value: '0' },
    { key: 'exam_title', value: 'Prova Oral de Odontopediatria' },
    { key: 'ai_model', value: 'gemini-3.8-flash' }
  ];
  for (const s of settings) {
    await supabase.from('settings').upsert(s, { onConflict: 'key' });
  }
  console.log('✅ Configurações salvas no Supabase.');

  // 3. Seed 33 questions
  const jsonPath = path.join(__dirname, 'perguntas.json');
  if (fs.existsSync(jsonPath)) {
    const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rows = list.map(item => ({
      id: item.id,
      question: item.question,
      expected_answer: item.expectedAnswer
    }));

    const { error: qErr } = await supabase.from('questions').upsert(rows, { onConflict: 'id' });
    if (qErr) console.warn('Erro ao carregar questões:', qErr.message);
    else console.log(`✅ ${rows.length} questões cadastradas com sucesso no Supabase!`);
  }

  console.log('\n🎉 Supabase pronto para uso!');
}

seed().catch(console.error);
