// COLE SUAS CHAVES DO SUPABASE AQUI
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';

const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

let professorId = null;

// Elementos da tela
const tituloBoasVindas = document.getElementById('boas-vindas');
const btnSair = document.getElementById('btn-sair');
const btnNovaTurma = document.getElementById('btn-nova-turma');
const formTurmaContainer = document.getElementById('form-turma-container');
const btnCancelarTurma = document.getElementById('btn-cancelar-turma');
const btnSalvarTurma = document.getElementById('btn-salvar-turma');
const inputNomeTurma = document.getElementById('nome-turma');
const listaTurmas = document.getElementById('lista-turmas');

// 1. VERIFICAR AUTENTICAÇÃO AO CARREGAR A PÁGINA
async function checarSessao() {
    const { data: { session }, error } = await clienteSupabase.auth.getSession();

    // Se não tiver sessão (não logou), joga para o login
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    professorId = session.user.id;

    // Busca o nome do professor na tabela 'perfis'
    const { data: perfilData } = await clienteSupabase
        .from('perfis')
        .select('nome, tipo_usuario')
        .eq('id', professorId)
        .single();

    // Se um aluno tentar acessar essa página por engano, joga ele pro painel de aluno
    if (perfilData.tipo_usuario !== 'professor') {
        window.location.href = 'painel_aluno.html';
        return;
    }

    tituloBoasVindas.innerText = `Olá, Prof. ${perfilData.nome}`;
    
    // Carrega as turmas desse professor
    carregarTurmas();
}

// 2. FUNÇÃO PARA SAIR DO SISTEMA (LOGOUT)
btnSair.addEventListener('click', async () => {
    await clienteSupabase.auth.signOut();
    window.location.href = 'login.html';
});

// 3. CONTROLE DO FORMULÁRIO DE NOVA TURMA
btnNovaTurma.addEventListener('click', () => {
    formTurmaContainer.classList.remove('hidden');
    inputNomeTurma.focus();
});

btnCancelarTurma.addEventListener('click', () => {
    formTurmaContainer.classList.add('hidden');
    inputNomeTurma.value = '';
});

// 4. SALVAR UMA NOVA TURMA NO BANCO DE DADOS
// Função para gerar um código aleatório de 6 caracteres (letras e números)
function gerarCodigoTurma() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 4. SALVAR UMA NOVA TURMA NO BANCO DE DADOS (Atualizado com Código)
btnSalvarTurma.addEventListener('click', async () => {
    const nome = inputNomeTurma.value.trim();
    if (!nome) {
        alert('Por favor, digite o nome da turma.');
        return;
    }

    btnSalvarTurma.innerText = 'Salvando...';
    btnSalvarTurma.disabled = true;

    const codigoGerado = gerarCodigoTurma();

    try {
        const { error } = await clienteSupabase
            .from('turmas')
            .insert([
                { professor_id: professorId, nome: nome, codigo_acesso: codigoGerado }
            ]);

        if (error) throw error;

        inputNomeTurma.value = '';
        formTurmaContainer.classList.add('hidden');
        carregarTurmas(); 
    } catch (erro) {
        console.error('Erro ao salvar turma:', erro);
        alert('Erro ao salvar a turma.');
    } finally {
        btnSalvarTurma.innerText = 'Salvar Turma';
        btnSalvarTurma.disabled = false;
    }
});

// 5. BUSCAR E EXIBIR AS TURMAS NA TELA (Atualizado com o link para a nova tela)
// 5. BUSCAR E EXIBIR AS TURMAS NA TELA
async function carregarTurmas() {
    listaTurmas.innerHTML = '<p class="loading-text">Carregando...</p>';

    const { data: turmas, error } = await clienteSupabase
        .from('turmas')
        .select('*')
        .eq('professor_id', professorId)
        .order('criado_em', { ascending: false });

    if (error) {
        console.error('Erro ao buscar turmas:', error);
        listaTurmas.innerHTML = '<p style="color: red;">Erro ao carregar turmas.</p>';
        return;
    }

    if (turmas.length === 0) {
        listaTurmas.innerHTML = '<p class="loading-text">Você ainda não possui turmas cadastradas.</p>';
        return;
    }

    listaTurmas.innerHTML = ''; 

    turmas.forEach(turma => {
        const divCard = document.createElement('div');
        divCard.className = 'card-turma';
        
        const dataCriacao = new Date(turma.criado_em).toLocaleDateString('pt-BR');

        divCard.innerHTML = `
            <h3>${turma.nome}</h3>
            <p style="margin-bottom: 5px;"><strong>Código para alunos:</strong> <span style="color: #e74c3c; font-weight: bold; font-size: 1.1rem;">${turma.codigo_acesso}</span></p>
            <p>Criada em: ${dataCriacao}</p>
            <br>
            <div style="display: flex; gap: 10px;">
                <button class="btn-primary" style="flex: 1; font-size: 0.9rem;" onclick="window.location.href='turma_detalhes.html?id=${turma.id}'">Ver Turma</button>
                <button class="btn-danger" style="font-size: 0.9rem; padding: 10px;" onclick="excluirTurma('${turma.id}')">Apagar</button>
            </div>
        `;
        listaTurmas.appendChild(divCard);
    });
}

// 6. FUNÇÃO PARA EXCLUIR TURMA
async function excluirTurma(idTurma) {
    const confirmar = confirm("Tem certeza que deseja apagar esta turma? Todas as provas dela também serão apagadas.");
    if (!confirmar) return;

    try {
        const { error } = await clienteSupabase
            .from('turmas')
            .delete()
            .eq('id', idTurma);

        if (error) throw error;
        
        alert("Turma apagada com sucesso!");
        carregarTurmas(); // Atualiza a lista na tela
    } catch (erro) {
        console.error("Erro ao apagar turma:", erro);
        alert("Erro ao tentar apagar a turma.");
    }
}

// Placeholder para a próxima funcionalidade
function abrirTurma(turmaId) {
    alert(`Em breve: Abrir painel detalhado da turma ${turmaId}!`);
}

// Inicia a aplicação
checarSessao();