// ==========================================
// CONFIGURAÇÕES INICIAIS E SUPABASE
// ==========================================
// COLE SUAS CHAVES DO SUPABASE AQUI
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';

const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

let alunoId = null;

const tituloBoasVindas = document.getElementById('boas-vindas');
const btnSair = document.getElementById('btn-sair');
const btnEntrarTurma = document.getElementById('btn-entrar-turma');
const inputCodigoTurma = document.getElementById('input-codigo-turma');
const listaTurmasAluno = document.getElementById('lista-turmas-aluno');

// ==========================================
// 1. VERIFICAR AUTENTICAÇÃO
// ==========================================
async function checarSessao() {
    const { data: { session } } = await clienteSupabase.auth.getSession();

    if (!session) { window.location.href = 'login.html'; return; }
    
    alunoId = session.user.id;

    const { data: perfilData } = await clienteSupabase.from('perfis').select('nome, tipo_usuario').eq('id', alunoId).single();

    if (perfilData.tipo_usuario !== 'aluno') {
        window.location.href = 'painel_professor.html'; return;
    }

    tituloBoasVindas.innerText = `Olá, ${perfilData.nome}! Preparado para estudar?`;
    carregarTurmasAluno();
}

// ==========================================
// 2. ENTRAR EM UMA NOVA TURMA VIA CÓDIGO
// ==========================================
btnEntrarTurma.addEventListener('click', async () => {
    const codigo = inputCodigoTurma.value.trim().toUpperCase();
    if (!codigo) { alert('Digite o código da turma.'); return; }

    btnEntrarTurma.disabled = true;
    btnEntrarTurma.innerText = 'Buscando...';

    try {
        // Busca a turma que tem esse código
        const { data: turmaData, error: erroTurma } = await clienteSupabase.from('turmas').select('id, nome').eq('codigo_acesso', codigo).single();

        if (erroTurma || !turmaData) throw new Error("Código inválido ou turma não encontrada.");

        // Cadastra o aluno na turma
        const { error: erroMatricula } = await clienteSupabase.from('turma_alunos').insert([{ turma_id: turmaData.id, aluno_id: alunoId }]);

        if (erroMatricula) {
            if (erroMatricula.code === '23505') throw new Error("Você já está matriculado nesta turma!");
            throw erroMatricula;
        }

        alert(`Sucesso! Você entrou na turma: ${turmaData.nome}`);
        inputCodigoTurma.value = '';
        carregarTurmasAluno();

    } catch (erro) {
        alert(erro.message);
    } finally {
        btnEntrarTurma.disabled = false;
        btnEntrarTurma.innerText = 'Entrar na Turma';
    }
});

// ==========================================
// 3. CARREGAR TURMAS DO ALUNO
// ==========================================
async function carregarTurmasAluno() {
    listaTurmasAluno.innerHTML = '<p class="loading-text">Carregando suas turmas...</p>';

    // Busca as turmas onde este alunoId está matriculado
    const { data: relacoes, error } = await clienteSupabase
        .from('turma_alunos')
        .select(`turma_id, turmas ( nome, codigo_acesso )`)
        .eq('aluno_id', alunoId);

    if (error) { listaTurmasAluno.innerHTML = '<p style="color: red;">Erro ao carregar turmas.</p>'; return; }
    
    if (relacoes.length === 0) { 
        listaTurmasAluno.innerHTML = '<p class="loading-text">Você ainda não está em nenhuma turma. Use o código acima para entrar!</p>'; 
        return; 
    }

    listaTurmasAluno.innerHTML = '';
    relacoes.forEach(relacao => {
        const turma = relacao.turmas;
        const divCard = document.createElement('div');
        divCard.className = 'card-turma'; // Usando o mesmo CSS do professor
        
        divCard.innerHTML = `
            <h3>${turma.nome}</h3>
            <p style="margin-bottom: 15px;">Código: <strong>${turma.codigo_acesso}</strong></p>
            <button class="btn-primary" style="width: 100%; background: #2980b9;" onclick="abrirTurmaAluno('${relacao.turma_id}')">Acessar Provas</button>
        `;
        listaTurmasAluno.appendChild(divCard);
    });
}

function abrirTurmaAluno(turmaId) {
    // Redireciona para a tela onde o aluno vê as provas daquela turma
    window.location.href = `turma_aluno.html?id=${turmaId}`;
}

// LOGOUT
btnSair.addEventListener('click', async () => {
    await clienteSupabase.auth.signOut();
    window.location.href = 'login.html';
});

// INICIA
checarSessao();