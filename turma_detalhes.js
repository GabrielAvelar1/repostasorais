// COLE SUAS CHAVES DO SUPABASE AQUI
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';

const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// ELEMENTOS DA TELA E ESTADO
// ==========================================
const parametrosUrl = new URLSearchParams(window.location.search);
const idTurmaAtual = parametrosUrl.get('id');

let provasDaTurma = [];
let alunosDaTurma = [];

// ==========================================
// NAVEGAÇÃO DE TABS
// ==========================================
document.querySelectorAll('#menu-tabs a[data-target]').forEach(link => {
    link.addEventListener('click', (e) => {
        document.querySelectorAll('#menu-tabs li').forEach(li => li.classList.remove('active'));
        e.target.parentElement.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(e.target.getAttribute('data-target')).classList.add('active');

        // Carrega dados sob demanda
        if (e.target.getAttribute('data-target') === 'tab-avisos') carregarAvisos();
        if (e.target.getAttribute('data-target') === 'tab-boletim') carregarBoletim();
    });
});

// ==========================================
// 1. CARREGAR DETALHES (BASE)
// ==========================================
async function carregarDetalhesDaTurma() {
    if (!idTurmaAtual) {
        alert("Turma não encontrada.");
        window.location.href = 'painel_professor.html';
        return;
    }

    const { data: turma, error } = await clienteSupabase.from('turmas').select('*').eq('id', idTurmaAtual).single();

    if (error || !turma) {
        document.getElementById('nome-turma-titulo').innerText = "Erro ao carregar turma.";
        return;
    }

    document.getElementById('nome-turma-titulo').innerText = turma.nome;
    document.getElementById('codigo-turma-destaque').innerText = turma.codigo_acesso || 'Sem código';
    
    // Carrega dados iniciais da tab principal
    carregarProvas();
    // Pre-carrega alunos para uso futuro
    const { data: alunos } = await clienteSupabase.from('turma_alunos').select(`aluno_id, perfis ( nome )`).eq('turma_id', idTurmaAtual);
    if(alunos) alunosDaTurma = alunos;
}

// ==========================================
// 2. PROVAS (LÓGICA EXISTENTE ADAPTADA)
// ==========================================
const btnNovaProva = document.getElementById('btn-nova-prova');
const formProvaContainer = document.getElementById('form-prova-container');
const btnCancelarProva = document.getElementById('btn-cancelar-prova');
const btnSalvarProva = document.getElementById('btn-salvar-prova');
const inputNomeProva = document.getElementById('input-nome-prova');
const inputDataInicio = document.getElementById('input-data-inicio');
const inputDataFim = document.getElementById('input-data-fim');
const inputValorTotal = document.getElementById('input-valor-total');
const containerPerguntas = document.getElementById('container-perguntas');
const btnAdicionarPergunta = document.getElementById('btn-adicionar-pergunta');
const listaProvas = document.getElementById('lista-provas');

let contadorPerguntas = 0;
let provaEditandoId = null;
let inscricaoRealtime = null;

btnNovaProva.addEventListener('click', () => abrirFormularioProva());
btnCancelarProva.addEventListener('click', () => formProvaContainer.classList.add('hidden'));
btnAdicionarPergunta.addEventListener('click', () => adicionarCampoPergunta());

function abrirFormularioProva(provaData = null, perguntasData = []) {
    formProvaContainer.classList.remove('hidden');
    containerPerguntas.innerHTML = ''; 
    contadorPerguntas = 0;

    if (provaData) {
        provaEditandoId = provaData.id;
        document.getElementById('btn-salvar-prova').innerHTML = "💾 Atualizar Prova";
        inputNomeProva.value = provaData.nome;
        inputValorTotal.value = provaData.valor_total || 10;
        
        if (provaData.data_inicio) inputDataInicio.value = new Date(provaData.data_inicio).toISOString().slice(0, 16);
        if (provaData.data_fim) inputDataFim.value = new Date(provaData.data_fim).toISOString().slice(0, 16);

        perguntasData.forEach(p => adicionarCampoPergunta(p.pergunta, p.resposta_espelho, p.valor_pontos));
    } else {
        provaEditandoId = null;
        document.getElementById('btn-salvar-prova').innerHTML = "💾 Salvar Prova";
        inputNomeProva.value = '';
        inputValorTotal.value = '10';
        inputDataInicio.value = '';
        inputDataFim.value = '';
        adicionarCampoPergunta();
    }
}

function adicionarCampoPergunta(textoPergunta = '', textoEspelho = '', valorQuestao = '') {
    contadorPerguntas++;
    const usaEspelho = textoEspelho && textoEspelho.trim() !== '';
    const escapeHTML = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    
    const div = document.createElement('div');
    div.className = 'pergunta-item';
    div.style = "background: #f8fafc; border: 1px solid #cbd5e1; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem;";
    
    div.innerHTML = `
        <h4 style="margin-bottom: 1rem; color: #1e293b; display: flex; justify-content: space-between; align-items: center; font-size: 1rem;">
            <span>Questão ${contadorPerguntas}</span>
            <div style="display: flex; gap: 10px; align-items: center;">
                <input type="number" class="input-valor-questao" placeholder="Pontos (Opcional)" value="${valorQuestao || ''}" step="0.1" style="padding: 6px; width: 140px; border: 1px solid #cbd5e1; border-radius: 4px;">
                <button type="button" class="btn-danger" onclick="this.parentElement.parentElement.parentElement.remove()" style="padding: 6px 12px; margin: 0;">🗑️</button>
            </div>
        </h4>
        <textarea class="input-pergunta-texto" rows="2" style="width: 100%; margin-bottom: 1rem; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="Qual é a pergunta clínica?">${escapeHTML(textoPergunta)}</textarea>
        <label style="font-size: 0.9rem; color: #3b82f6; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem; font-weight: 500;">
            <input type="checkbox" class="check-espelho" onchange="toggleEspelho(this)" ${usaEspelho ? 'checked' : ''}> Adicionar Resposta Esperada (Gabarito para IA)
        </label>
        <textarea class="input-espelho-texto" rows="3" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; display: ${usaEspelho ? 'block' : 'none'};" placeholder="O que o aluno DEVE mencionar para tirar nota máxima?">${escapeHTML(textoEspelho || '')}</textarea>
    `;
    containerPerguntas.appendChild(div);
}

function toggleEspelho(checkbox) {
    const textarea = checkbox.parentElement.nextElementSibling;
    textarea.style.display = checkbox.checked ? 'block' : 'none';
}

btnSalvarProva.addEventListener('click', async () => {
    const nome = inputNomeProva.value.trim();
    const valorTotalProva = parseFloat(inputValorTotal.value) || 10.0;

    if (!nome) { alert('Dê um nome para a prova.'); return; }

    const itensPergunta = document.querySelectorAll('.pergunta-item');
    const perguntasParaSalvar = [];
    let somaPontosAtribuidos = 0;
    let qtdPerguntasSemValor = 0;

    itensPergunta.forEach(item => {
        const textoPergunta = item.querySelector('.input-pergunta-texto').value.trim();
        const usaEspelho = item.querySelector('.check-espelho').checked;
        const textoEspelho = usaEspelho ? item.querySelector('.input-espelho-texto').value.trim() : null;
        const inputValor = item.querySelector('.input-valor-questao').value;
        let valorQuestao = inputValor ? parseFloat(inputValor) : null;
        
        if (textoPergunta) {
            if (valorQuestao !== null) somaPontosAtribuidos += valorQuestao;
            else qtdPerguntasSemValor++;
            
            perguntasParaSalvar.push({ pergunta: textoPergunta, resposta_espelho: textoEspelho, valor_pontos: valorQuestao });
        }
    });

    if (perguntasParaSalvar.length === 0) { alert('Adicione pelo menos uma pergunta.'); return; }
    
    if (somaPontosAtribuidos > valorTotalProva) {
        alert(`Erro: A soma dos pontos (${somaPontosAtribuidos}) é maior que o total da prova (${valorTotalProva}).`);
        return;
    }

    let pontosRestantes = valorTotalProva - somaPontosAtribuidos;
    let pontosPorQuestaoVazia = qtdPerguntasSemValor > 0 ? (pontosRestantes / qtdPerguntasSemValor) : 0;

    perguntasParaSalvar.forEach(p => {
        if (p.valor_pontos === null) p.valor_pontos = parseFloat(pontosPorQuestaoVazia.toFixed(2));
    });

    btnSalvarProva.disabled = true;
    btnSalvarProva.innerText = 'Salvando...';
    let dataInicio = inputDataInicio.value ? new Date(inputDataInicio.value).toISOString() : null;
    let dataFim = inputDataFim.value ? new Date(inputDataFim.value).toISOString() : null;

    try {
        let idDaProva;
        if (provaEditandoId) {
            await clienteSupabase.from('provas').update({ nome, data_inicio: dataInicio, data_fim: dataFim, valor_total: valorTotalProva }).eq('id', provaEditandoId);
            idDaProva = provaEditandoId;
            await clienteSupabase.from('perguntas').delete().eq('prova_id', idDaProva);
        } else {
            const { data: provaCriada } = await clienteSupabase.from('provas').insert([{ turma_id: idTurmaAtual, nome, data_inicio: dataInicio, data_fim: dataFim, valor_total: valorTotalProva }]).select();
            idDaProva = provaCriada[0].id;
        }

        const perguntasComIds = perguntasParaSalvar.map(p => ({ 
            prova_id: idDaProva, pergunta: p.pergunta, resposta_espelho: p.resposta_espelho, valor_pontos: p.valor_pontos
        }));
        await clienteSupabase.from('perguntas').insert(perguntasComIds);

        formProvaContainer.classList.add('hidden');
        carregarProvas(); 
    } catch (erro) {
        console.error('Erro ao salvar:', erro);
        alert('Erro ao salvar prova.');
    } finally {
        btnSalvarProva.disabled = false;
        btnSalvarProva.innerHTML = '💾 Salvar Prova';
    }
});

async function carregarProvas() {
    listaProvas.innerHTML = '<p class="loading-text">Carregando provas...</p>';

    const { data: provas } = await clienteSupabase.from('provas').select(`*, perguntas (*)`).eq('turma_id', idTurmaAtual).order('created_at', { ascending: false });

    if (!provas || provas.length === 0) { 
        listaProvas.innerHTML = '<p class="loading-text">Nenhuma prova cadastrada ainda.</p>'; 
        provasDaTurma = [];
        return; 
    }

    provasDaTurma = provas; // Guarda estado para o boletim
    listaProvas.innerHTML = '';
    
    provas.forEach(prova => {
        const divProva = document.createElement('div');
        divProva.className = 'card-turma';
        
        let statusBadge = '';
        let novoStatus = '';
        let btnStatusText = '';
        let btnStatusColor = '';

        if (prova.status === 'rascunho') {
            statusBadge = '<span class="badge badge-yellow">Rascunho</span>';
            novoStatus = 'liberada';
            btnStatusText = 'Liberar para Alunos';
            btnStatusColor = 'btn-success';
        } else if (prova.status === 'liberada') {
            statusBadge = '<span class="badge badge-green">Aberta</span>';
            novoStatus = 'encerrada';
            btnStatusText = 'Encerrar Prova';
            btnStatusColor = 'btn-danger';
        } else if (prova.status === 'encerrada') {
            statusBadge = '<span class="badge badge-red">Encerrada</span>';
            novoStatus = 'notas_liberadas';
            btnStatusText = 'Liberar Notas p/ Alunos';
            btnStatusColor = 'btn-primary';
        } else if (prova.status === 'notas_liberadas') {
            statusBadge = '<span class="badge badge-blue">Notas Liberadas</span>';
            novoStatus = 'encerrada';
            btnStatusText = 'Ocultar Notas';
            btnStatusColor = 'btn-secondary';
        } else {
            statusBadge = '<span class="badge badge-gray">Desconhecido</span>';
            novoStatus = 'rascunho';
            btnStatusText = 'Resetar Status';
            btnStatusColor = 'btn-secondary';
        }

        const dadosProvaStr = JSON.stringify(prova).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        const perguntasProvaStr = JSON.stringify(prova.perguntas).replace(/'/g, "&apos;").replace(/"/g, "&quot;");

        let btnEditar = prova.status === 'rascunho' 
            ? `<button class="btn-secondary" style="padding: 6px 10px; font-size: 0.85rem;" onclick="abrirFormularioProva(${dadosProvaStr}, ${perguntasProvaStr})">✏️ Editar</button>` 
            : '';

        divProva.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <h3 style="margin: 0; font-size: 1.15rem;">${prova.nome}</h3>
                ${statusBadge}
            </div>
            <p style="margin-bottom: 5px; font-size: 0.85rem;"><strong>Valor:</strong> ${prova.valor_total || 10} pts | <strong>Questões:</strong> ${prova.perguntas.length}</p>
            
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 15px;">
                ${btnEditar}
                <button class="btn-secondary" style="padding: 6px 10px; font-size: 0.85rem; color: #8b5cf6; border-color: #ddd6fe;" onclick="abrirResultadosProva('${prova.id}')">📊 Correção</button>
                <button class="btn-secondary" style="padding: 6px 10px; font-size: 0.85rem;" onclick="abrirMonitorRespostas('${prova.id}')">📡 Monitorar</button>
                <button class="${btnStatusColor}" style="padding: 6px 10px; font-size: 0.85rem; width: 100%; justify-content: center; margin-top: 5px;" onclick="alterarStatusProva('${prova.id}', '${novoStatus}')">${btnStatusText}</button>
            </div>
        `;
        listaProvas.appendChild(divProva);
    });
}

async function alterarStatusProva(idProva, novoStatus) {
    await clienteSupabase.from('provas').update({ status: novoStatus }).eq('id', idProva);
    carregarProvas();
    // Atualiza boletim se status mudou (pois provas encerradas compõem a média fina, etc)
}


// ==========================================
// 3. MURAL DE AVISOS (LOCALSTORAGE MOCK)
// ==========================================
function carregarAvisos() {
    const listaAvisos = document.getElementById('lista-avisos');
    const avisosStr = localStorage.getItem(`avisos_${idTurmaAtual}`);
    const avisos = avisosStr ? JSON.parse(avisosStr) : [];

    if (avisos.length === 0) {
        listaAvisos.innerHTML = '<p class="loading-text">Nenhum aviso postado ainda.</p>';
        return;
    }

    listaAvisos.innerHTML = '';
    // Reverse para mais recentes primeiro
    avisos.reverse().forEach(aviso => {
        const dataFormatada = new Date(aviso.data).toLocaleString('pt-BR');
        const div = document.createElement('div');
        div.className = 'aviso-card';
        div.innerHTML = `
            <div class="aviso-data">Postado em: ${dataFormatada}</div>
            <p style="color: #334155; line-height: 1.5;">${aviso.texto.replace(/\n/g, '<br>')}</p>
        `;
        listaAvisos.appendChild(div);
    });
}

document.getElementById('btn-postar-aviso').addEventListener('click', () => {
    const inputAviso = document.getElementById('input-novo-aviso');
    const texto = inputAviso.value.trim();
    
    if (!texto) return;

    const avisosStr = localStorage.getItem(`avisos_${idTurmaAtual}`);
    const avisos = avisosStr ? JSON.parse(avisosStr) : [];
    
    avisos.push({
        data: new Date().toISOString(),
        texto: texto
    });

    localStorage.setItem(`avisos_${idTurmaAtual}`, JSON.stringify(avisos));
    inputAviso.value = '';
    carregarAvisos();
});


// ==========================================
// 4. BOLETIM & ALUNOS (GRADEBOOK)
// ==========================================
async function carregarBoletim() {
    const tbody = document.getElementById('gradebook-body');
    const theadTr = document.getElementById('gradebook-header');
    
    tbody.innerHTML = '<tr><td colspan="4" class="loading-text" style="text-align: center;">Carregando notas...</td></tr>';

    // 1. Reconstruir Header baseado nas Provas Existentes
    // Limpar headers dinâmicos (manter Aluno, Status e remover até a Média Final)
    while(theadTr.children.length > 3) {
        theadTr.removeChild(theadTr.children[2]); 
    }
    
    // Opcional: Filtrar apenas provas encerradas ou liberadas para o boletim
    const provasAtivas = provasDaTurma.filter(p => p.status !== 'rascunho');
    
    provasAtivas.forEach(prova => {
        const th = document.createElement('th');
        th.innerText = prova.nome;
        theadTr.insertBefore(th, theadTr.lastElementChild);
    });

    // Se não tiver alunos
    if(alunosDaTurma.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${provasAtivas.length + 3}" class="loading-text" style="text-align: center;">Nenhum aluno matriculado.</td></tr>`;
        return;
    }

    // 2. Buscar todas as notas
    const provasIds = provasAtivas.map(p => p.id);
    let respostasMatriz = [];
    
    if (provasIds.length > 0) {
        const { data: respostas } = await clienteSupabase
            .from('respostas_alunos')
            .select('aluno_id, prova_id, nota, nota_professor, revisada_professor')
            .in('prova_id', provasIds);
        if(respostas) respostasMatriz = respostas;
    }

    // 3. Montar Linhas
    tbody.innerHTML = '';
    alunosDaTurma.forEach(relacao => {
        const tr = document.createElement('tr');
        
        let nomeHtml = `<td><div style="font-weight: 500; color: #0f172a;">${relacao.perfis.nome}</div></td>`;
        let statusHtml = `<td><span class="badge badge-blue">Ativo</span></td>`;
        
        let colunasProvasHtml = '';
        let somaNotas = 0;
        let provasAvaliadas = 0;

        provasAtivas.forEach(prova => {
            // Soma as notas das questões desta prova para este aluno
            const respostasDaProva = respostasMatriz.filter(r => r.aluno_id === relacao.aluno_id && r.prova_id === prova.id);
            
            if (respostasDaProva.length === 0) {
                colunasProvasHtml += `<td style="color: #cbd5e1;">-</td>`;
            } else {
                let notaProva = 0;
                respostasDaProva.forEach(r => {
                    notaProva += parseFloat(r.revisada_professor ? r.nota_professor : r.nota) || 0;
                });
                somaNotas += notaProva;
                provasAvaliadas++;
                colunasProvasHtml += `<td><strong style="color: #059669;">${notaProva.toFixed(2)}</strong></td>`;
            }
        });

        // Cálculo da média (ou soma total, depende do critério do professor. Usaremos Soma Total das Provas Feitas)
        let mediaHtml = `<td><strong style="color: #2563eb; font-size: 1.1rem;">${somaNotas.toFixed(2)}</strong></td>`;

        tr.innerHTML = nomeHtml + statusHtml + colunasProvasHtml + mediaHtml;
        tbody.appendChild(tr);
    });
}


// ==========================================
// 5. MONITORAMENTO & REVISÃO (MODAIS EXISTENTES)
// ==========================================
document.getElementById('btn-fechar-modal').addEventListener('click', () => {
    document.getElementById('modal-respostas').classList.add('hidden');
    if (inscricaoRealtime) clienteSupabase.removeChannel(inscricaoRealtime);
});

function abrirMonitorRespostas(idProva) {
    document.getElementById('modal-respostas').classList.remove('hidden');
    const lista = document.getElementById('lista-respostas-vivo');
    lista.innerHTML = '<p class="loading-text" style="text-align: center; margin-top: 20px;">Escutando submissões em tempo real...</p>';

    if (inscricaoRealtime) clienteSupabase.removeChannel(inscricaoRealtime);

    inscricaoRealtime = clienteSupabase.channel('respostas_channel').on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'respostas_alunos', filter: `prova_id=eq.${idProva}` },
        (payload) => {
            const novaResposta = payload.new;
            if (lista.querySelector('.loading-text')) lista.innerHTML = '';

            const divCard = document.createElement('div');
            divCard.style = "background: white; border-left: 4px solid #8b5cf6; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);";
            divCard.innerHTML = `
                <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 5px;">Agora mesmo</p>
                <p style="font-size: 1rem; color: #1e293b; font-weight: 600; margin-bottom: 8px;">Nova resposta recebida!</p>
                <div style="background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-style: italic; color: #475569;">
                    "${novaResposta.transcricao}"
                </div>
            `;
            lista.prepend(divCard);
        }
    ).subscribe();
}

async function abrirResultadosProva(idProva) {
    const modal = document.getElementById('modal-resultados');
    const lista = document.getElementById('lista-resultados-alunos');
    modal.classList.remove('hidden');
    lista.innerHTML = '<p class="loading-text" style="text-align: center;">Buscando correções...</p>';

    const { data: respostas, error } = await clienteSupabase.from('respostas_alunos').select(`
        id, transcricao, nota, feedback_ia, nota_professor, revisada_professor,
        perfis ( nome ), perguntas ( pergunta, resposta_espelho, valor_pontos )
    `).eq('prova_id', idProva);

    if (error) { lista.innerHTML = '<p style="color: #ef4444;">Erro ao carregar dados.</p>'; return; }
    if (respostas.length === 0) { lista.innerHTML = '<p class="loading-text" style="text-align: center;">Nenhum aluno respondeu esta prova ainda.</p>'; return; }

    const agrupadoPorAluno = {};
    respostas.forEach(r => {
        const nome = r.perfis.nome;
        if (!agrupadoPorAluno[nome]) agrupadoPorAluno[nome] = [];
        agrupadoPorAluno[nome].push(r);
    });

    lista.innerHTML = '';
    Object.keys(agrupadoPorAluno).forEach(nomeAluno => {
        const respostasDoAluno = agrupadoPorAluno[nomeAluno];
        let notaTotalFinal = 0;

        const divAluno = document.createElement('div');
        divAluno.style = "background: white; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 2rem; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);";
        
        let htmlRespostas = '';
        respostasDoAluno.forEach((r, index) => {
            const notaAtual = r.revisada_professor ? r.nota_professor : r.nota;
            notaTotalFinal += parseFloat(notaAtual || 0);

            let solicitouRevisao = r.transcricao && r.transcricao.includes("[REVISÃO SOLICITADA]");
            let transcricaoLimpa = r.transcricao ? r.transcricao.replace("[REVISÃO SOLICITADA]", "").trim() : "";
            
            let badgeRevisao = solicitouRevisao && !r.revisada_professor
                ? `<div style="background: #fee2e2; color: #ef4444; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold; font-size: 0.9rem; border-left: 4px solid #ef4444;">⚠️ ALUNO SOLICITOU REVISÃO DESTA QUESTÃO</div>`
                : '';

            let statusCorrecao = r.revisada_professor 
                ? `<span class="badge badge-yellow">Revisada pelo Prof</span>` 
                : `<span class="badge badge-blue">Correção da IA</span>`;

            htmlRespostas += `
                <div style="border-top: 1px dashed #cbd5e1; padding-top: 1.5rem; margin-top: 1.5rem;">
                    <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">Questão ${index + 1}: ${r.perguntas.pergunta}</p>
                    <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 1rem;">Valor da questão: ${r.perguntas.valor_pontos} pts</p>
                    
                    ${badgeRevisao}
                    <div style="background: #f8fafc; border-left: 3px solid #64748b; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
                        <span style="font-size: 0.8rem; font-weight: bold; color: #64748b; display: block; margin-bottom: 4px;">RESPOSTA DO ALUNO (Transcrição)</span>
                        <p style="color: #334155;">"${transcricaoLimpa}"</p>
                    </div>
                    
                    <div style="background: #ecfdf5; border-left: 3px solid #10b981; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
                        <span style="font-size: 0.8rem; font-weight: bold; color: #059669; display: block; margin-bottom: 4px;">FEEDBACK DA IA</span>
                        <p style="color: #065f46;">${r.feedback_ia || 'Sem feedback registrado.'}</p>
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; background: #f1f5f9; padding: 1rem; border-radius: 8px;">
                        <div>
                            <strong style="color: #1e293b;">Nota:</strong> <span id="display-nota-${r.id}" style="font-size: 1.2rem; font-weight: bold; color: #059669;">${notaAtual}</span> / ${r.perguntas.valor_pontos}
                            <div style="margin-top: 5px;">${statusCorrecao}</div>
                        </div>
                        <div style="display: flex; gap: 8px; flex-direction: column; align-items: flex-end;">
                            <input type="number" id="input-nova-nota-${r.id}" placeholder="Nova Nota" step="0.1" style="width: 100px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;" max="${r.perguntas.valor_pontos}">
                            <button onclick="salvarRevisaoManual('${r.id}')" class="btn-primary" style="padding: 6px 12px; font-size: 0.85rem;">Sobrescrever Nota</button>
                        </div>
                    </div>
                </div>
            `;
        });

        divAluno.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 700;">👤 ${nomeAluno}</h3>
                <div style="background: #1e293b; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold;">
                    Nota Total: <span id="nota-final-${nomeAluno}">${notaTotalFinal.toFixed(2)}</span>
                </div>
            </div>
            ${htmlRespostas}
        `;
        lista.appendChild(divAluno);
    });
}

async function salvarRevisaoManual(idResposta) {
    const inputNovaNota = document.getElementById(`input-nova-nota-${idResposta}`);
    const novaNota = parseFloat(inputNovaNota.value);

    if (isNaN(novaNota)) { alert("Por favor, digite uma nota válida."); return; }

    try {
        const { error } = await clienteSupabase.from('respostas_alunos').update({ nota_professor: novaNota, revisada_professor: true }).eq('id', idResposta);
        if (error) throw error;
        
        alert("Nota atualizada com sucesso!");
        inputNovaNota.value = '';
        document.getElementById(`display-nota-${idResposta}`).innerText = novaNota;
        
        // Refazer o status badge no DOM exigiria um reload da seção ou manipulação direta. 
        // Por simplicidade, fecha e reabre o modal ou só avisa.
        // O professor verá a mudança visual ao reabrir.
    } catch (erro) {
        console.error(erro);
        alert("Erro ao salvar revisão.");
    }
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================
carregarDetalhesDaTurma();