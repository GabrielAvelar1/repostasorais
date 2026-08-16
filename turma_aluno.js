// ==========================================
// CONFIGURAÇÕES INICIAIS E SUPABASE
// ==========================================
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';

const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// ELEMENTOS DA TELA E ESTADO
// ==========================================
const parametrosUrl = new URLSearchParams(window.location.search);
const idTurmaAtual = parametrosUrl.get('id');

let alunoId = null;

// ==========================================
// NAVEGAÇÃO DE TABS
// ==========================================
document.querySelectorAll('#menu-tabs a[data-target]').forEach(link => {
    link.addEventListener('click', (e) => {
        document.querySelectorAll('#menu-tabs li').forEach(li => li.classList.remove('active'));
        e.target.parentElement.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(e.target.getAttribute('data-target')).classList.add('active');

        if (e.target.getAttribute('data-target') === 'tab-avisos') carregarAvisos();
        if (e.target.getAttribute('data-target') === 'tab-notas') carregarMinhasNotas();
    });
});

// ==========================================
// 1. VERIFICAR AUTENTICAÇÃO E MATRÍCULA
// ==========================================
async function checarSessaoEBuscarTurma() {
    const { data: { session } } = await clienteSupabase.auth.getSession();

    if (!session) { window.location.href = 'login.html'; return; }
    alunoId = session.user.id;

    if (!idTurmaAtual) {
        alert("Turma não encontrada na URL.");
        window.location.href = 'painel_aluno.html';
        return;
    }

    const { data: matricula, error: erroMatricula } = await clienteSupabase
        .from('turma_alunos')
        .select('turma_id')
        .eq('turma_id', idTurmaAtual)
        .eq('aluno_id', alunoId)
        .single();

    if (erroMatricula || !matricula) {
        alert("Você não tem permissão para acessar esta turma ou ela não existe.");
        window.location.href = 'painel_aluno.html';
        return;
    }

    const { data: turma } = await clienteSupabase.from('turmas').select('nome').eq('id', idTurmaAtual).single();
    if (turma) {
        document.getElementById('nome-turma-titulo').innerText = turma.nome;
    }

    carregarProvasLiberadas();
}

// ==========================================
// 2. PROVAS LIBERADAS
// ==========================================
async function carregarProvasLiberadas() {
    const listaProvasAluno = document.getElementById('lista-provas-aluno');
    listaProvasAluno.innerHTML = '<p class="loading-text">Buscando avaliações...</p>';

    const { data: provas, error } = await clienteSupabase
        .from('provas')
        .select(`id, nome, valor_total, perguntas(id)`)
        .eq('turma_id', idTurmaAtual)
        .eq('status', 'liberada')
        .order('created_at', { ascending: false });

    if (error) {
        listaProvasAluno.innerHTML = '<p style="color: red;">Erro ao carregar avaliações.</p>';
        return;
    }

    // Verifica quais provas o aluno já respondeu
    const provasIds = provas.map(p => p.id);
    let provasRespondidas = new Set();
    
    if (provasIds.length > 0) {
        const { data: respostas } = await clienteSupabase
            .from('respostas_alunos')
            .select('prova_id')
            .eq('aluno_id', alunoId)
            .in('prova_id', provasIds);
            
        if (respostas) {
            respostas.forEach(r => provasRespondidas.add(r.prova_id));
        }
    }

    if (provas.length === 0) {
        listaProvasAluno.innerHTML = '<p class="loading-text">Nenhuma prova liberada para esta turma no momento.</p>';
        return;
    }

    listaProvasAluno.innerHTML = '';

    provas.forEach(prova => {
        const divProva = document.createElement('div');
        const jaRespondeu = provasRespondidas.has(prova.id);
        
        const corBorda = jaRespondeu ? '#94a3b8' : '#3b82f6';
        const statusBadge = jaRespondeu 
            ? '<span class="badge badge-gray">CONCLUÍDA</span>' 
            : '<span class="badge badge-blue">DISPONÍVEL</span>';
            
        const acaoBtn = jaRespondeu
            ? `<button class="btn-secondary" style="width: 100%;" disabled>Prova já enviada</button>`
            : `<button class="btn-primary" style="width: 100%;" onclick="iniciarProva('${prova.id}')">🎤 Iniciar Avaliação</button>`;

        divProva.style = `background: white; padding: 1.5rem; border-radius: 8px; border-left: 5px solid ${corBorda}; box-shadow: 0 2px 8px rgba(0,0,0,0.1); opacity: ${jaRespondeu ? '0.7' : '1'};`;
        
        divProva.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                <div>
                    <h3 style="color: #2c3e50; margin-bottom: 5px;">${prova.nome}</h3>
                    <p style="font-size: 0.9rem; color: #7f8c8d;">${prova.perguntas.length} Questões • Valor: ${prova.valor_total || 10} pts</p>
                </div>
                ${statusBadge}
            </div>
            ${acaoBtn}
        `;
        listaProvasAluno.appendChild(divProva);
    });
}

function iniciarProva(idProva) {
    const confirmar = confirm("Você tem um ambiente silencioso? A gravação começará em breve.");
    if (confirmar) {
        window.location.href = `sala_prova.html?id=${idProva}`;
    }
}

// ==========================================
// 3. MURAL DE AVISOS
// ==========================================
function carregarAvisos() {
    const listaAvisos = document.getElementById('lista-avisos');
    const avisosStr = localStorage.getItem(`avisos_${idTurmaAtual}`);
    const avisos = avisosStr ? JSON.parse(avisosStr) : [];

    if (avisos.length === 0) {
        listaAvisos.innerHTML = '<p class="loading-text">Nenhum aviso no mural.</p>';
        return;
    }

    listaAvisos.innerHTML = '';
    avisos.reverse().forEach(aviso => {
        const dataFormatada = new Date(aviso.data).toLocaleString('pt-BR');
        const div = document.createElement('div');
        div.className = 'aviso-card';
        div.innerHTML = `
            <div class="aviso-data">Professor • ${dataFormatada}</div>
            <p style="color: #334155; line-height: 1.5;">${aviso.texto.replace(/\n/g, '<br>')}</p>
        `;
        listaAvisos.appendChild(div);
    });
}

// ==========================================
// 4. MINHAS NOTAS E REVISÃO
// ==========================================
async function carregarMinhasNotas() {
    const listaNotas = document.getElementById('lista-notas-aluno');
    listaNotas.innerHTML = '<p class="loading-text">Buscando notas...</p>';

    // Busca provas visíveis para o aluno
    const { data: provas, error } = await clienteSupabase
        .from('provas')
        .select(`id, nome, valor_total, status`)
        .eq('turma_id', idTurmaAtual)
        .neq('status', 'rascunho')
        .order('created_at', { ascending: false });

    if (error || provas.length === 0) {
        listaNotas.innerHTML = '<p class="loading-text">Nenhuma avaliação encontrada.</p>';
        return;
    }

    const provasIds = provas.map(p => p.id);
    const { data: respostas } = await clienteSupabase
        .from('respostas_alunos')
        .select('id, prova_id, nota, nota_professor, revisada_professor, transcricao, feedback_ia, perguntas(pergunta, valor_pontos)')
        .eq('aluno_id', alunoId)
        .in('prova_id', provasIds);

    listaNotas.innerHTML = '';
    let somaNotasTotais = 0;

    provas.forEach(prova => {
        const divNota = document.createElement('div');
        divNota.style = "background: white; border: 1px solid #e2e8f0; padding: 1.5rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;";
        
        const respostasDaProva = respostas ? respostas.filter(r => r.prova_id === prova.id) : [];
        
        let statusTexto = '';
        let notaRender = '';
        let btnDetalhes = '';

        if (respostasDaProva.length === 0) {
            statusTexto = `<span class="badge badge-red">Não Realizada / Ausente</span>`;
            notaRender = `<span style="color: #94a3b8; font-size: 1.2rem; font-weight: bold;">-- / ${prova.valor_total || 10}</span>`;
        } else {
            if (prova.status !== 'notas_liberadas') {
                statusTexto = `<span class="badge badge-gray">Enviada. Aguardando Prof.</span>`;
                notaRender = `<span style="color: #94a3b8; font-size: 1.2rem; font-weight: bold;">🔒 Oculta</span>`;
            } else {
                let notaFinalProva = 0;
                let algumaRevisada = false;
                
                respostasDaProva.forEach(r => {
                    notaFinalProva += parseFloat(r.revisada_professor ? r.nota_professor : r.nota) || 0;
                    if (r.revisada_professor) algumaRevisada = true;
                });
                
                somaNotasTotais += notaFinalProva;
                
                statusTexto = algumaRevisada 
                    ? `<span class="badge badge-yellow">Revisada pelo Prof</span>`
                    : `<span class="badge badge-blue">Correção IA</span>`;
                    
                notaRender = `<span style="color: #059669; font-size: 1.5rem; font-weight: bold;">${notaFinalProva.toFixed(2)}</span> <span style="color: #64748b;">/ ${prova.valor_total || 10}</span>`;
                
                // Botão para abrir os detalhes e contestar
                const respostasStr = encodeURIComponent(JSON.stringify(respostasDaProva));
                btnDetalhes = `<button class="btn-secondary" style="margin-top: 10px; font-size: 0.85rem;" onclick="abrirDetalhesCorrecao('${prova.nome}', '${respostasStr}')">Ver Detalhes da Correção</button>`;
            }
        }

        divNota.innerHTML = `
            <div>
                <h3 style="color: #1e293b; margin-bottom: 5px;">${prova.nome}</h3>
                <div>${statusTexto}</div>
                ${btnDetalhes}
            </div>
            <div style="text-align: right;">
                ${notaRender}
            </div>
        `;
        listaNotas.appendChild(divNota);
    });

    const divResumo = document.createElement('div');
    divResumo.style = "background: #f8fafc; border: 2px dashed #cbd5e1; padding: 1.5rem; border-radius: 8px; text-align: center; margin-bottom: 2rem;";
    divResumo.innerHTML = `
        <h3 style="color: #64748b; font-size: 1rem; margin-bottom: 5px; text-transform: uppercase;">Nota Acumulada (Apenas provas liberadas)</h3>
        <div style="color: #2563eb; font-size: 2.5rem; font-weight: 800;">${somaNotasTotais.toFixed(2)}</div>
    `;
    listaNotas.prepend(divResumo);
}

// ==========================================
// 5. DETALHES DA CORREÇÃO E CONTESTAÇÃO
// ==========================================
function abrirDetalhesCorrecao(nomeProva, respostasEncoded) {
    const respostas = JSON.parse(decodeURIComponent(respostasEncoded));
    document.getElementById('modal-detalhes-titulo').innerText = `Detalhes: ${nomeProva}`;
    const modal = document.getElementById('modal-detalhes');
    const conteudo = document.getElementById('conteudo-detalhes');
    
    conteudo.innerHTML = '';
    
    respostas.forEach((r, index) => {
        const notaAtual = r.revisada_professor ? r.nota_professor : r.nota;
        
        let solicitouRevisao = r.transcricao && r.transcricao.includes("[REVISÃO SOLICITADA]");
        let transcricaoLimpa = r.transcricao ? r.transcricao.replace("[REVISÃO SOLICITADA]", "").trim() : "";
        
        let acoesHtml = '';
        if (solicitouRevisao && !r.revisada_professor) {
            acoesHtml = `<div style="color: #ef4444; font-weight: bold; font-size: 0.9rem;">⏳ Revisão solicitada. Aguardando professor.</div>`;
        } else if (r.revisada_professor) {
            acoesHtml = `<div style="color: #059669; font-weight: bold; font-size: 0.9rem;">✅ Revisado pelo Professor</div>`;
        } else {
            acoesHtml = `<button class="btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;" onclick="solicitarRevisao('${r.id}', '${transcricaoLimpa.replace(/'/g, "\\'")}')">Solicitar Revisão desta Questão</button>`;
        }
        
        const divQuestao = document.createElement('div');
        divQuestao.style = "background: white; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 1.5rem; padding: 1.5rem;";
        divQuestao.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
                <h4 style="color: #1e293b; margin: 0; font-size: 1.1rem;">Questão ${index + 1}: ${r.perguntas.pergunta}</h4>
                <div style="text-align: right;">
                    <strong style="color: #059669; font-size: 1.2rem;">${notaAtual}</strong> / ${r.perguntas.valor_pontos} pts
                </div>
            </div>
            
            <div style="margin-bottom: 1rem;">
                <strong style="font-size: 0.85rem; color: #64748b; text-transform: uppercase;">Sua Resposta Transcrita:</strong>
                <div style="background: #f1f5f9; padding: 10px; border-radius: 4px; color: #334155; margin-top: 5px;">
                    "${transcricaoLimpa}"
                </div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <strong style="font-size: 0.85rem; color: #64748b; text-transform: uppercase;">Feedback da Avaliação:</strong>
                <div style="background: #ecfdf5; padding: 10px; border-radius: 4px; color: #065f46; margin-top: 5px; border-left: 3px solid #10b981;">
                    ${r.feedback_ia || 'Sem feedback disponível.'}
                </div>
            </div>
            
            <div style="text-align: right; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                ${acoesHtml}
            </div>
        `;
        conteudo.appendChild(divQuestao);
    });
    
    modal.classList.remove('hidden');
}

async function solicitarRevisao(idResposta, transcricaoAtual) {
    const confirmar = confirm("Tem certeza que deseja contestar a nota desta questão? O professor será notificado e fará uma avaliação manual (a nota pode aumentar ou diminuir).");
    if (!confirmar) return;
    
    try {
        const novaTranscricao = "[REVISÃO SOLICITADA] " + transcricaoAtual;
        
        const { error } = await clienteSupabase
            .from('respostas_alunos')
            .update({ transcricao: novaTranscricao })
            .eq('id', idResposta);
            
        if (error) throw error;
        
        alert("Revisão solicitada com sucesso! O professor irá avaliar.");
        
        // Atualiza a tela recarregando os dados para o aluno ver o status "Aguardando"
        document.getElementById('modal-detalhes').classList.add('hidden');
        carregarMinhasNotas();
        
    } catch (erro) {
        console.error(erro);
        alert("Erro ao solicitar revisão. Tente novamente.");
    }
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================
checarSessaoEBuscarTurma();