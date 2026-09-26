require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('⚡ Conectado ao banco de dados Supabase:', supabaseUrl);
}

module.exports = {
  supabase,
  isSupabaseConfigured: () => Boolean(supabase)
};
