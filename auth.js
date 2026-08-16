// COLE AQUI OS DADOS DO SEU PROJETO SUPABASE
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';

// Inicializa o cliente do Supabase (Corrigido o nome da variável aqui)
const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

// Elementos da interface
const formLoginBox = document.getElementById('form-login');
const formCadastroBox = document.getElementById('form-cadastro');
const loginForm = document.getElementById('loginForm');
const cadastroForm = document.getElementById('cadastroForm');

// Função para alternar entre a tela de Login e Cadastro
function alternarFormulario() {
    formLoginBox.classList.toggle('hidden');
    formCadastroBox.classList.toggle('hidden');
}

// LÓGICA DE CADASTRO
cadastroForm.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    
    const btn = document.getElementById('btn-cadastrar');
    btn.innerText = "Cadastrando...";
    btn.disabled = true;

    const nome = document.getElementById('cad-nome').value;
    const email = document.getElementById('cad-email').value;
    const senha = document.getElementById('cad-senha').value;
    const tipoUsuario = document.querySelector('input[name="tipoUsuario"]:checked').value;

    try {
        // Usa clienteSupabase
        const { data: authData, error: authError } = await clienteSupabase.auth.signUp({
            email: email,
            password: senha,
        });

        if (authError) throw authError;

        if (authData.user) {
            const { error: dbError } = await clienteSupabase
                .from('perfis')
                .insert([
                    { id: authData.user.id, nome: nome, tipo_usuario: tipoUsuario }
                ]);

            if (dbError) throw dbError;

            alert("Cadastro realizado com sucesso! Faça login para continuar.");
            alternarFormulario();
            cadastroForm.reset(); 
        }
    } catch (erro) {
        console.error("Erro no cadastro:", erro);
        alert("Erro ao cadastrar: " + erro.message);
    } finally {
        btn.innerText = "Realizar Cadastro";
        btn.disabled = false;
    }
});

// LÓGICA DE LOGIN
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btn = document.getElementById('btn-entrar');
    btn.innerText = "Entrando...";
    btn.disabled = true;

    const email = document.getElementById('login-email').value;
    const senha = document.getElementById('login-senha').value;

    try {
        // Usa clienteSupabase
        const { data: authData, error: authError } = await clienteSupabase.auth.signInWithPassword({
            email: email,
            password: senha,
        });

        if (authError) throw authError;

        const userId = authData.user.id;
        const { data: perfilData, error: perfilError } = await clienteSupabase
            .from('perfis')
            .select('tipo_usuario, nome')
            .eq('id', userId)
            .single();

        if (perfilError) throw perfilError;

        alert(`Bem-vindo, ${perfilData.nome}!`);

        if (perfilData.tipo_usuario === 'professor') {
            window.location.href = 'painel_professor.html'; 
        } else {
            window.location.href = 'painel_aluno.html'; 
        }

    } catch (erro) {
        console.error("Erro no login:", erro);
        alert("Erro ao entrar: Verifique seu e-mail e senha.");
    } finally {
        btn.innerText = "Entrar no Sistema";
        btn.disabled = false;
    }
});