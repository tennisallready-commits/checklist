  
  /* ── EMPRESA HELPERS ── */
  function getEmpresasChecked(prefix) {
    const emps = ['editora','leia','gisella'].filter(e => {
      const cb = document.getElementById(prefix + e);
      return cb && cb.checked;
    });
    return emps.length > 0 ? emps : null;
  }
  
  function setEmpresasChecked(prefix, empresaStr) {
    const emps = (empresaStr || '').split(',');
    ['editora','leia','gisella'].forEach(e => {
      const cb = document.getElementById(prefix + e);
      if (cb) cb.checked = emps.includes(e);
    });
  }
  
  function getEmpresaStr(prefix, fallback) {
    const emps = getEmpresasChecked(prefix);
    return emps ? emps.join(',') : (fallback || 'editora');
  }
  
  
  
  function empBadgesHtml(empresaStr) {
    const EMP_B = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
    const EMP_L = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
    return (empresaStr||'editora').split(',').map(e =>
      `<span class="badge ${EMP_B[e]||'b-gray'}">${EMP_L[e]||e}</span>`
    ).join(' ');
  }
  
  
  /* ── DARK MODE ── */
  function toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('gc-dark-mode', isDark ? '0' : '1');
    updateDarkBtn(!isDark);
  }
  function updateDarkBtn(isDark) {
    const icon = document.getElementById('dark-mode-icon');
    const label = document.getElementById('dark-mode-label');
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    if (label) label.textContent = isDark ? 'Modo claro' : 'Modo escuro';
  }
  // Restaurar modo escuro
  (function() {
    if (localStorage.getItem('gc-dark-mode') === '1') {
      document.documentElement.setAttribute('data-theme', 'dark');
      updateDarkBtn(true);
    }
  })();
  
  
  /* ── DUPLICAR ── */
  function duplicarEvento(id) {
    const ev = events.find(x => x.id === id);
    if (!ev) return;
    const novoId = Date.now();
    const novo = {...ev, id: novoId, titulo: ev.titulo + ' (cópia)', arquivada: false};
    events.push(novo);
    save('gc-events', events);
    buildTarefas(); buildColabTarefas(); buildEventosList(); buildPrioridades();
    // Abrir modal de edição do novo item
    setTimeout(() => openEditEvent(novoId), 50);
  }
  
  function duplicarConteudo(id) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    // A cópia começa com um novo fluxo: nunca herda checks/etapas concluídas.
    const novo = {
      ...c,
      id: Date.now(),
      nome: c.nome + ' (cópia)',
      done: false,
      status: 'copy',
      etapasStatus: {},
      etapas: Array.isArray(c.etapas) ? c.etapas.map(etapa => ({ ...etapa, feito: false })) : c.etapas,
    };
    conteudos.push(novo);
    save('gc-conteudos', conteudos);
    renderConteudos();
  }
  
  function duplicarProjeto(id) {
    const p = projetos.find(x => x.id === id);
    if (!p) return;
    const novoId = Date.now();
    const novo = {...p, id: novoId, nome: p.nome + ' (cópia)', tarefas: (p.tarefas||[]).map(t => ({...t, eventId: null}))};
    projetos.push(novo);
    save('gc-projetos', projetos);
    renderProjetos();
  }
  
  function duplicarLivro(id) {
    const l = livros.find(x => x.id === id);
    if (!l) return;
    const novo = {...l, id: Date.now(), titulo: l.titulo + ' (cópia)', etapas: l.etapas.map(e => ({...e, feito: false, eventId: null}))};
    livros.push(novo);
    save('gc-livros', livros);
    renderLivros();
  }
  
  
  /* ── ETAPAS LIVRO ── */
  let etapaDragSrcLivro = null;
  let etapaDragSrcIdx = null;
  
  function etapaDragStart(e, livroId, idx) {
    etapaDragSrcLivro = livroId;
    etapaDragSrcIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
  }
  
  function etapaDrop(e, livroId, idx) {
    e.preventDefault();
    if (etapaDragSrcLivro !== livroId || etapaDragSrcIdx === idx) return;
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    const [moved] = l.etapas.splice(etapaDragSrcIdx, 1);
    l.etapas.splice(idx, 0, moved);
    save('gc-livros', livros);
    renderLivros();
    buildTarefas();
  }
  
  function openEditEtapa(livroId, idx) {
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    const e = l.etapas[idx];
    // Reutilizar o modal quickadd como editor de etapa
    editingEventId = null;
    openQuickAdd();
    window._editingEtapa = {livroId, idx};
    document.getElementById('qa-tipo').value = 'tarefa';
    updateQaFields();
    document.getElementById('qa-titulo').value = e.nome;
    document.getElementById('qa-prazo').value = e.prazo || '';
    document.getElementById('qa-responsavel').value = e.resp || '';
    setEmpresasChecked('qa-emp-', l.empresa || 'editora');
    document.getElementById('qa-modal-title').textContent = `Editar etapa · ${l.titulo}`;
    document.getElementById('qa-submit-btn').textContent = 'Salvar etapa';
  }
  
  function adicionarEtapa(livroId) {
    const nome = prompt('Nome da nova etapa:');
    if (!nome || !nome.trim()) return;
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    l.etapas.push({nome: nome.trim(), feito: false, prazo: '', resp: ''});
    save('gc-livros', livros);
    renderLivros();
    buildTarefas();
  }
  
  
  /* ── IA TAREFAS PROJETO ── */
  
  /* ── UNDO ── */
  let _undoStack = null;
  let _undoTimer = null;
  
  function pushUndo(label, restoreFn) {
    _undoStack = restoreFn;
    const msg = document.getElementById('undo-msg');
    const toast = document.getElementById('undo-toast');
    if (msg) msg.textContent = `"${label}" excluído`;
    if (toast) toast.classList.add('visible');
    if (_undoTimer) clearTimeout(_undoTimer);
    _undoTimer = setTimeout(() => {
      if (toast) toast.classList.remove('visible');
      _undoStack = null;
    }, 5000);
  }
  
  function undoDelete() {
    if (_undoStack) {
      _undoStack();
      _undoStack = null;
    }
    const toast = document.getElementById('undo-toast');
    if (toast) toast.classList.remove('visible');
    if (_undoTimer) clearTimeout(_undoTimer);
  }
  
  
  /* ── MENTEE LIVRO ── */
  function toggleNlMentee() {
    const val = document.querySelector('input[name="nl-mentee-opt"]:checked')?.value;
    const wrap = document.getElementById('nl-mentee-wrap');
    if (!wrap) return;
    wrap.style.display = val === 'sim' ? 'block' : 'none';
    if (val === 'sim') {
      // Preencher select com mentoradas
      const sel = document.getElementById('nl-mentee-id');
      if (sel) {
        const sorted = [...mentees].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
        sel.innerHTML = '<option value="">Selecione...</option>' +
          sorted.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
      }
    }
  }
  
  function switchMenteeTab(tab, btn) {
    document.querySelectorAll('#modal-mentee .modal-tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('#modal-mentee .modal-tab-content').forEach(c=>c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const el = document.getElementById('mtab-' + tab);
    if (el) el.classList.add('active');
    if (tab === 'livros') renderMenteeLivros();
  }
  
  function renderMenteeLivros() {
    const el = document.getElementById('mm-livros-list');
    if (!el) return;
    const m = mentees.find(x => x.id === currentMenteeId);
    if (!m) return;
    const livrosDaMentee = livros.filter(l => l.menteeId === m.id);
    if (livrosDaMentee.length === 0) {
      el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum livro vinculado a esta mentorada.</div>';
      return;
    }
    el.innerHTML = livrosDaMentee.map(l => {
      const done = (l.etapas||[]).filter(e=>e.feito).length;
      const pct = (l.etapas||[]).length ? Math.round(done/(l.etapas||[]).length*100) : 0;
      const navBtn = `Array.from(document.querySelectorAll('.nav-item')).find(b=>(b.getAttribute('onclick')||'').includes("'livros'"))`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;cursor:pointer;"
        onclick="closeModal('modal-mentee');setTimeout(()=>{const nb=${navBtn};showPage('livros',nb);setTimeout(()=>{toggleLivro(${l.id});const card=document.querySelector('[onclick*=\\'toggleLivro(${l.id})\\']');if(card){card.scrollIntoView({behavior:'smooth',block:'start'});}},250);},100);">
        <span style="font-size:16px;">📖</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.titulo}</div>
          <div style="font-size:11px;color:var(--text-soft);margin-top:2px;">${pct}% concluído</div>
        </div>
        <span style="font-size:12px;color:var(--gisella);font-weight:600;">abrir →</span>
      </div>`;
    }).join('');
  }
  
  /* ── UPLOAD LOCAL → FIREBASE ── */
  async function uploadLocalToFirebase() {
    if (!window.fbSave) {
      alert('Firebase não está conectado. Verifique sua conexão e tente novamente.');
      return;
    }
  
    const KEYS = ['gc-events','gc-livros','gc-conteudos','gc-projetos','gc-mentees','gc-mentees-marco0','gc-kanban','gc-steira','gc-colab-ordem','gc-links','gc-gisella-checks','gc-links-empresa','gc-fixed-gisella','gc-fixed-milena','gc-fixed-luiggi','gc-fixed-checks-gisella','gc-fixed-checks-milena','gc-fixed-checks-luiggi','gc-notas-gisella','gc-notas-milena','gc-notas-luiggi','gc-recurring-tasks'];
  
    // Verificar se há dados no localStorage
    const hasData = KEYS.some(k => localStorage.getItem(k));
    if (!hasData) {
      alert('Nenhum dado local encontrado para enviar.');
      return;
    }
  
    const btn = document.getElementById('upload-firebase-btn');
    if (btn) btn.innerHTML = '&#9729;&#65039; <span>Enviando...</span>';
  
    try {
      // Ler direto do localStorage — garante os dados originais
      const promises = KEYS.map(key => {
        const raw = localStorage.getItem(key);
        if (!raw) return Promise.resolve();
        try {
          const val = JSON.parse(raw);
          return window.fbSave(key, val);
        } catch(e) { return Promise.resolve(); }
      });
     const results = await Promise.all(promises);
  if (results.some(result => result === false)) {
    throw new Error('Os dados locais não foram enviados porque a nuvem possui uma versão mais recente.');
  }
  
      if (btn) btn.innerHTML = '&#10003; <span>Enviado com sucesso!</span>';
      const ind = document.getElementById('sync-indicator');
      if (ind) ind.style.display = 'flex';
      setTimeout(() => {
        if (btn) btn.innerHTML = '&#9729;&#65039; <span>Enviar dados locais &#8594; nuvem</span>';
      }, 4000);
    } catch(e) {
      if (btn) btn.innerHTML = '&#9729;&#65039; <span>Enviar dados locais &#8594; nuvem</span>';
      alert('Erro ao enviar: ' + e.message);
    }
  }
  
  
  function renderGisellaFixedTasks() { renderFixedTasks('gisella'); }
  function renderColabFixedTasks(key) { renderFixedTasks(key); }
  
  function toggleGisellaFixed(key, val) { toggleFixed('gisella', key, val); }
  
  
  /* ── BANCO DE LINKS ── */
  let links = load('gc-links', []);
  let editingLinkId = null;
  
  const LINK_ICONS = { ferramenta: '🛠', planilha: '📊', doc: '📄', outro: '🔗' };
  const LINK_LABELS = { ferramenta: 'Ferramenta', planilha: 'Planilha', doc: 'Documento', outro: 'Outro' };
  
  function renderLinks() {
    const el = document.getElementById('links-grid');
    if (!el) return;
  
    if (links.length === 0) {
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum link cadastrado. Use "+ adicionar link" para começar.</div>';
      return;
    }
  
    // Agrupar por categoria
    const grouped = {};
    links.forEach(l => {
      if (!grouped[l.categoria]) grouped[l.categoria] = [];
      grouped[l.categoria].push(l);
    });
  
    let out = '';
    Object.entries(grouped).forEach(([cat, items]) => {
      out += `<div style="margin-bottom:1.5rem;">
        <div style="font-size:11px;font-weight:600;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${LINK_ICONS[cat]||'🔗'} ${LINK_LABELS[cat]||cat}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      items.forEach(l => {
        out += `<div style="display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;">
          <a href="${l.url}" target="_blank" rel="noopener"
            style="font-size:13px;font-weight:500;color:var(--editora);text-decoration:none;"
            onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
            ${l.nome}
          </a>
          <button onclick="openEditLink(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0 2px;" title="Editar">✎</button>
          <button onclick="deleteLink(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:0 2px;" title="Excluir">×</button>
        </div>`;
      });
      out += `</div></div>`;
    });
    el.innerHTML = out;
  }
  
  function openAddLink() {
    editingLinkId = null;
    currentEmpLink = null;
    document.getElementById('modal-link-title').textContent = 'Novo link';
    document.getElementById('link-nome').value = '';
    document.getElementById('link-url').value = '';
    document.getElementById('link-categoria').value = 'ferramenta';
    openModal('modal-link');
    setTimeout(() => document.getElementById('link-nome').focus(), 50);
  }
  
  function openEditLink(id) {
    const l = links.find(x => x.id === id);
    if (!l) return;
    editingLinkId = id;
    document.getElementById('modal-link-title').textContent = 'Editar link';
    document.getElementById('link-nome').value = l.nome;
    document.getElementById('link-url').value = l.url;
    document.getElementById('link-categoria').value = l.categoria || 'outro';
    openModal('modal-link');
  }
  
  function saveLink() {
    const nome = document.getElementById('link-nome').value.trim();
    const url  = document.getElementById('link-url').value.trim();
    if (!nome || !url) { alert('Preencha nome e URL.'); return; }
    const cat = document.getElementById('link-categoria').value;
    const icons = {ferramenta:'🛠',planilha:'📊',doc:'📄',outro:'🔗'};
    const icon = icons[cat]||'🔗';
  
    if (currentEmpLink) {
      // Salvar no banco da empresa
      if (!linksEmpresa[currentEmpLink]) linksEmpresa[currentEmpLink] = [];
      if (editingEmpLink) {
        const i = linksEmpresa[currentEmpLink].findIndex(x => x.id === editingEmpLink);
        if (i > -1) linksEmpresa[currentEmpLink][i] = { ...linksEmpresa[currentEmpLink][i], nome, url, categoria: cat, icon };
      } else {
        linksEmpresa[currentEmpLink].push({ id: Date.now(), nome, url, categoria: cat, icon });
      }
      save('gc-links-empresa', linksEmpresa);
      const _emp = currentEmpLink;
      currentEmpLink = null;
      editingEmpLink = null;
      closeModal('modal-link');
      setTimeout(() => openLinksModal(_emp), 100);
      return;
    } else {
      // Salvar no banco geral
      if (editingLinkId) {
        const i = links.findIndex(x => x.id === editingLinkId);
        if (i > -1) links[i] = { ...links[i], nome, url, categoria: cat, icon };
      } else {
        links.push({ id: Date.now(), nome, url, categoria: cat, icon });
      }
      save('gc-links', links);
      renderLinks();
    }
    closeModal('modal-link');
  }
  
  function deleteLink(id) {
    const l = links.find(x => x.id === id);
    if (!l) return;
    const snap = [...links];
    links = links.filter(x => x.id !== id);
    save('gc-links', links);
    renderLinks();
    pushUndo(l.nome, () => { links = snap; save('gc-links', links); renderLinks(); });
  }
  
  
  /* ── LINKS POR EMPRESA ── */
  let linksEmpresa = load('gc-links-empresa', {editora:[], leia:[], gisella:[]});
  let editingEmpLink = null;
  let currentEmpLink = null;
  
  function toggleLinksEmpresa(emp) {
    const el = document.getElementById('links-empresa-' + emp);
    const arrow = document.getElementById('links-arrow-' + emp);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▾' : '▸';
    if (open) renderLinksEmpresa(emp);
  }
  
  function renderLinksEmpresa(emp) {
    const el = document.getElementById('links-empresa-grid-' + emp);
    if (!el) return;
    const items = (linksEmpresa[emp] || []);
    if (items.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-soft);padding:4px 0;">Nenhum link. Use "+ link" para adicionar.</div>';
      return;
    }
    el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
      items.map(function(l) { return '<div style="display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 10px;">' +
        '<a href="' + l.url + '" target="_blank" rel="noopener" style="font-size:13px;font-weight:500;color:var(--text);text-decoration:none;">' + (l.icon||'🔗') + ' ' + l.nome + '</a>' +
        '<button onclick="openEditLinkEmpresa(' + JSON.stringify(emp) + ',' + l.id + ')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0 2px;">✎</button>' +
        '<button onclick="deleteLinkEmpresa(' + JSON.stringify(emp) + ',' + l.id + ')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:0 2px;">×</button>' +
        '</div>'; }).join('') + '</div>';
  }
  
  function openAddLinkEmpresa(emp) {
    editingEmpLink = null;
    currentEmpLink = emp;
    document.getElementById('modal-link-title').textContent = 'Novo link';
    document.getElementById('link-nome').value = '';
    document.getElementById('link-url').value = '';
    document.getElementById('link-categoria').value = 'ferramenta';
    // Abrir painel se fechado
    const el = document.getElementById('links-empresa-' + emp);
    if (el && el.style.display === 'none') toggleLinksEmpresa(emp);
    openModal('modal-link');
    setTimeout(() => document.getElementById('link-nome').focus(), 50);
  }
  
  function openEditLinkEmpresa(emp, id) {
    const l = (linksEmpresa[emp]||[]).find(x => x.id === id);
    if (!l) return;
    editingEmpLink = id;
    currentEmpLink = emp;
    document.getElementById('modal-link-title').textContent = 'Editar link';
    document.getElementById('link-nome').value = l.nome;
    document.getElementById('link-url').value = l.url;
    document.getElementById('link-categoria').value = l.categoria || 'ferramenta';
    openModal('modal-link');
  }
  
  function deleteLinkEmpresa(emp, id) {
    const snap = JSON.parse(JSON.stringify(linksEmpresa));
    linksEmpresa[emp] = (linksEmpresa[emp]||[]).filter(x => x.id !== id);
    save('gc-links-empresa', linksEmpresa);
    renderLinksEmpresa(emp);
    pushUndo('Link', () => { linksEmpresa = snap; save('gc-links-empresa', linksEmpresa); renderLinksEmpresa(emp); });
  }
  
  
  function openLinksModal(emp) {
    currentEmpLink = emp;
    const titles = {editora:'Editora Cassol', leia:'Léia Cassol', gisella:'GC Estratégias'};
    const el = document.getElementById('modal-links-emp-title');
    if (el) el.textContent = '🔗 ' + (titles[emp]||emp);
    renderLinksEmpresaModal(emp);
    openModal('modal-links-empresa');
  }
  
  function renderLinksEmpresaModal(emp) {
    const el = document.getElementById('modal-links-emp-content');
    if (!el) return;
    const items = (linksEmpresa[emp] || []);
    if (items.length === 0) {
      el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum link cadastrado. Use "+ adicionar" para começar.</div>';
      return;
    }
    // Agrupar por categoria
    const grouped = {};
    items.forEach(l => {
      if (!grouped[l.categoria]) grouped[l.categoria] = [];
      grouped[l.categoria].push(l);
    });
    const ICONS = {ferramenta:'🛠',planilha:'📊',doc:'📄',outro:'🔗'};
    const LABELS = {ferramenta:'Ferramenta',planilha:'Planilha',doc:'Documento',outro:'Outro'};
    let out = '';
    Object.entries(grouped).forEach(([cat, catItems]) => {
      out += `<div style="margin-bottom:1rem;">
        <div style="font-size:11px;font-weight:600;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${ICONS[cat]||'🔗'} ${LABELS[cat]||cat}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      catItems.forEach(l => {
        out += `<div style="display:flex;align-items:center;gap:6px;background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:8px;padding:8px 12px;">
          <a href="${l.url}" target="_blank" rel="noopener"
            style="font-size:13px;font-weight:500;color:var(--text);text-decoration:none;"
            onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
            ${l.icon||'🔗'} ${l.nome}
          </a>
          <button onclick="openEditLinkEmpresa('${emp}',${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0 2px;">✎</button>
          <button onclick="deleteLinkEmpresaModal('${emp}',${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:0 2px;">×</button>
        </div>`;
      });
      out += `</div></div>`;
    });
    el.innerHTML = out;
  }
  
  function openAddLinkEmpresaFromModal() {
    const emp = currentEmpLink;
    closeModal('modal-links-empresa');
    setTimeout(() => openAddLinkEmpresa(emp), 100);
  }
  
  function deleteLinkEmpresaModal(emp, id) {
    const snap = JSON.parse(JSON.stringify(linksEmpresa));
    linksEmpresa[emp] = (linksEmpresa[emp]||[]).filter(x => x.id !== id);
    save('gc-links-empresa', linksEmpresa);
    renderLinksEmpresaModal(emp);
    pushUndo('Link', () => { linksEmpresa = snap; save('gc-links-empresa', linksEmpresa); renderLinksEmpresaModal(emp); });
  }
  
  /* ── TAREFAS AUTO MENTORIA ── */
  // Criação automática de tarefas por evento do calendário GC
  // Lista negra de gcalKeys excluídos manualmente — nunca recriar
  function getGcalBlacklist() {
    try { return new Set(JSON.parse(localStorage.getItem('gc-gcal-blacklist') || '[]')); }
    catch(e) { return new Set(); }
  }
  function getLegacyRecurringSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch (_) { return new Set(); }
  }
  function saveLegacyRecurringSet(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }
  function addToGcalBlacklist(key) {
    const bl = getGcalBlacklist();
    bl.add(key);
    localStorage.setItem('gc-gcal-blacklist', JSON.stringify([...bl]));
  }
  
  function criarTarefasEventos(allEvents) {
    let changed = false;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const hojeStr = hoje.toISOString().slice(0,10);
    allEvents.forEach(ev => {
      if (!ev.start || !ev.title) return;
      if (ev.start < hojeStr) return;
      const nome = ev.title.trim();
      const nomeKey = nome.replace(/\s+/g,'_').slice(0, 30);
      const diaEvento = new Date(ev.start + 'T12:00:00');
      const strEvento = diaEvento.toISOString().slice(0,10);
      const keyDia  = 'gcal-dia-'  + ev.start + '-' + nomeKey;
      const _bl = getGcalBlacklist();
      if (!events.some(e => e.gcalKey === keyDia) && !_bl.has(keyDia)) {
        events.push({ id: Date.now()+Math.floor(Math.random()*9999)+1,
          titulo: nome, empresa: 'gisella', tipo: 'tarefa',
          data: strEvento, responsavel: 'Gisella', gcalKey: keyDia, arquivada: false });
        changed = true;
      }
    });
    if (changed) {
      save('gc-events', events);
      buildTarefas(); buildColabTarefas(); buildPrioridades();
    }
  }
  
  function limparTarefasEventosRemovidos(allEvents) {
    const validKeys = new Set();
    allEvents.forEach(ev => {
      if (!ev.start || !ev.title) return;
      const nomeKey = ev.title.trim().replace(/\s+/g,'_').slice(0, 30);
      // A agenda Daily mantém somente a tarefa do próprio evento. As antigas
      // tarefas automáticas de preparar/encerrar deixam de ser válidas e são
      // removidas na próxima sincronização, sem afetar tarefas manuais.
      validKeys.add('gcal-dia-'  + ev.start + '-' + nomeKey);
    });
    const antes = events.length;
    events = events.filter(e => !e.gcalKey || validKeys.has(e.gcalKey));
    if (events.length < antes) {
      save('gc-events', events);
      buildTarefas(); buildColabTarefas(); buildPrioridades();
    }
  }
  
  
  
  function toggleColabFixed(key, taskKey, val) { toggleFixed(key, taskKey, val); }
  
  
  /* ── TAREFAS AUTOMÁTICAS RECORRENTES (GISELLA) ── */
  // Estas tarefas são criadas automaticamente como tarefas normais (aparecem
  // na aba "Tarefas", filtráveis por colaborador) com a data de hoje.
  const LUIGGI_RECORRENTES_DIARIAS = [];
  const GISELLA_RECORRENTES_SEGUNDA = ['Avisos da semana - Plano Diretor', 'Links da semana - Plano Diretor', 'Analisar Planilha de Métricas'];
  const GISELLA_RECORRENTES_SEXTA   = [];
  
  function ensureGisellaRecorrentes() {
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD horário local
    const dow = new Date().getDay(); // 0=dom,1=seg,...5=sex,6=sab
    let changed = false;
    let idCounter = 0;

    // A recorrência agora é configurada no formulário de tarefas. Removemos
    // apenas as duas cópias que eram criadas automaticamente pelo sistema,
    // reconhecidas pela chave interna, sem tocar em tarefas manuais.
    const retiredRecurringKeys = new Set([
      'diaria-0', 'diaria-1',
      'luiggi-diaria-0',
      'sexta-0', 'sexta-1',
    ]);
    const beforeRetiredCleanup = events.length;
    events = events.filter(event => !retiredRecurringKeys.has(event.recurKey));
    if (events.length !== beforeRetiredCleanup) changed = true;
    // As duas tarefas semanais do Plano Diretor passam a ser da Milena.
    const milenaWeeklyKeys = new Set(['segunda-0', 'segunda-1']);
    events.forEach(event => {
      if (milenaWeeklyKeys.has(event.recurKey) && event.responsavel !== 'Milena') {
        event.responsavel = 'Milena';
        changed = true;
      }
      const weeklyIndex = event.recurKey === 'segunda-0' ? 0 : event.recurKey === 'segunda-1' ? 1 : -1;
      if (weeklyIndex >= 0 && event.titulo !== GISELLA_RECORRENTES_SEGUNDA[weeklyIndex]) {
        event.titulo = GISELLA_RECORRENTES_SEGUNDA[weeklyIndex];
        changed = true;
      }
    });
  
    function ensureTask(label, recurKey, responsavel = 'Gisella') {
      const disabledKeys = getLegacyRecurringSet('gc-legacy-recur-disabled');
      const excludedOccurrences = getLegacyRecurringSet('gc-legacy-recur-exclusions');
      if (disabledKeys.has(recurKey) || excludedOccurrences.has(`${recurKey}:${todayStr}`)) return;
      const normalizedLabel = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const ja = events.some(e => {
        const sameTitle = String(e.titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === normalizedLabel;
        return e.data === todayStr && (e.recurKey === recurKey || sameTitle);
      });
      if (ja) return;
      events.push({
        id: Date.now() + (idCounter++),
        empresa: 'gisella',
        titulo: label,
        tipo: 'tarefa',
        data: todayStr,
        responsavel,
        arquivada: false,
        recurKey,
      });
      changed = true;
    }
  
    LUIGGI_RECORRENTES_DIARIAS.forEach((label, i) => ensureTask(label, 'luiggi-diaria-' + i, 'Luiggi'));
    if (dow === 1) GISELLA_RECORRENTES_SEGUNDA.forEach((label, i) => ensureTask(label, 'segunda-' + i, i < 2 ? 'Milena' : 'Gisella'));
    if (dow === 5) GISELLA_RECORRENTES_SEXTA.forEach((label, i) => ensureTask(label, 'sexta-' + i));
  
    if (changed) {
      save('gc-events', events);
      buildTarefas();
      buildColabTarefas();
      buildPrioridades();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Array.isArray(events)) ensureGisellaRecorrentes();
  });
  
  
  /* ── TAREFAS FIXAS EDITÁVEIS ── */
  
  // Dados padrão iniciais
  const FIXED_DEFAULTS = {
    gisella: {
      daily:  [{id:'g-d-1', label:'Whats'}, {id:'g-d-2', label:'Email'}, {id:'g-d-3', label:'Direct'}],
      weekly: [
        {id:'g-w-1', label:'Avisos da semana - Plano Diretor'},
        {id:'g-w-2', label:'Links da semana - Plano Diretor'},
        {id:'g-w-3', label:'Analisar planilha de métricas', link:'https://docs.google.com/spreadsheets/d/1ROG9DTW7jQemiMf8mwfDEvC2oOTrTP4TwDCxMN3KlKI/edit?gid=0#gid=0'},
        {id:'g-w-4', label:'Rodar novos anúncios'},
      ]
    },
    milena: { daily: [], weekly: [] },
    luiggi: { daily: [], weekly: [] },
  };
  // Itens aposentados do checklist fixo. Os IDs garantem que uma tarefa manual
  // com o mesmo texto não seja apagada.
  const RETIRED_FIXED_TASK_IDS = new Set(['g-w-5', 'g-w-6']);
  
  function getFixedData(colab) {
    const key = 'gc-fixed-' + colab;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const data = JSON.parse(stored);
        const weekly = Array.isArray(data.weekly) ? data.weekly : [];
        const activeWeekly = weekly.filter(task => !RETIRED_FIXED_TASK_IDS.has(task.id));
        if (activeWeekly.length !== weekly.length) {
          data.weekly = activeWeekly;
          localStorage.setItem(key, JSON.stringify(data));
        }
        return data;
      }
    } catch(e) {}
    // Primeira vez: usar defaults
    const def = JSON.parse(JSON.stringify(FIXED_DEFAULTS[colab] || {daily:[], weekly:[]}));
    localStorage.setItem(key, JSON.stringify(def));
    return def;
  }
  
  function saveFixedData(colab, data) {
    const key = 'gc-fixed-' + colab;
    localStorage.setItem(key, JSON.stringify(data));
    if (window.fbSave) window.fbSave(key, data);
  }
  
  function getFixedChecks(colab) {
    try { return JSON.parse(localStorage.getItem('gc-fixed-checks-' + colab) || '{}'); } catch(e) { return {}; }
  }
  function saveFixedChecks(colab, obj) {
    localStorage.setItem('gc-fixed-checks-' + colab, JSON.stringify(obj));
    if (window.fbSave) window.fbSave('gc-fixed-checks-' + colab, obj);
  }
  
  function resetFixedChecks(colab) {
    let checks = getFixedChecks(colab);
    const data = getFixedData(colab);
    // Use local Brazil timezone date to avoid UTC mismatch
    const now = new Date();
    const today = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD in local tz
    // Semana começa na segunda-feira
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const weekKey = monday.toLocaleDateString('sv-SE');
    let changed = false;
  
    // Store day/week keys INSIDE checks to survive Firebase sync
    if (checks['_day'] !== today) {
      data.daily.forEach(t => { checks['d-'+t.id] = false; });
      checks['_day'] = today;
      localStorage.setItem('gc-fixed-day-' + colab, today);
      changed = true;
    }
    if (checks['_week'] !== weekKey) {
      data.weekly.forEach(t => { checks['w-'+t.id] = false; });
      checks['_week'] = weekKey;
      localStorage.setItem('gc-fixed-week-' + colab, weekKey);
      changed = true;
    }
    if (changed) saveFixedChecks(colab, checks);
    return checks;
  }
  
  let fixedDragSrc = null;
  let fixedDragColab = null;
  let fixedDragType = null;
  
  function renderFixedTasks(colab) {
    const dailyEl  = document.getElementById(colab + '-daily-tasks');
    const weeklyEl = document.getElementById(colab + '-weekly-tasks');
    if (!dailyEl || !weeklyEl) return;
  
    const data = getFixedData(colab);
    const checks = resetFixedChecks(colab);
  
    function taskRow(t, type, prefix) {
      const checked = !!checks[prefix + t.id];
      const labelHtml = t.link
        ? '<a href="' + t.link + '" target="_blank" style="color:var(--editora);text-decoration:underline;text-underline-offset:2px;font-size:13px;' + (checked ? 'opacity:0.5;' : '') + '">' + t.label + ' ↗</a>'
        : '<span style="font-size:13px;flex:1;' + (checked ? 'text-decoration:line-through;opacity:0.5;' : '') + '">' + t.label + '</span>';
      const ds = 'fixedDragStart(event,' + JSON.stringify(colab) + ',' + JSON.stringify(type) + ',' + JSON.stringify(t.id) + ')';
      const dd = 'fixedDrop(event,' + JSON.stringify(colab) + ',' + JSON.stringify(type) + ',' + JSON.stringify(t.id) + ')';
      const onch = 'toggleFixed(' + JSON.stringify(colab) + ',' + JSON.stringify(prefix + t.id) + ',this.checked)';
      return '<div draggable="true"' +
        ' ondragstart="' + ds + '"' +
        ' ondragover="event.preventDefault()"' +
        ' ondrop="' + dd + '"' +
        ' style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);">' +
        '<span style="cursor:grab;color:var(--text-soft);font-size:11px;flex-shrink:0;">⠿</span>' +
        '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="' + onch + '" style="accent-color:var(--gisella);width:14px;height:14px;cursor:pointer;flex-shrink:0;">' +
        '<span style="flex:1;">' + labelHtml + '</span>' +
        `<button onclick="editFixedTask('${colab}','${type}','${t.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0 2px;">✎</button>` +
        `<button onclick="deleteFixedTask('${colab}','${type}','${t.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:0 2px;">×</button>` +
        '</div>';
    }
  
    const dailyTasks = data.daily.slice().sort((a,b) => Number(!!checks['d-'+a.id]) - Number(!!checks['d-'+b.id]));
    const weeklyTasks = data.weekly.slice().sort((a,b) => Number(!!checks['w-'+a.id]) - Number(!!checks['w-'+b.id]));
  
    dailyEl.innerHTML  = dailyTasks.map(t => taskRow(t,'daily','d-')).join('') +
      `<button onclick="addFixedTask('${colab}','daily')" style="margin-top:8px;font-size:11px;background:none;border:1px dashed var(--border-mid);border-radius:6px;padding:4px 8px;color:var(--text-soft);cursor:pointer;width:100%;">+ adicionar</button>`;
  
    weeklyEl.innerHTML = weeklyTasks.map(t => taskRow(t,'weekly','w-')).join('') +
      `<button onclick="addFixedTask('${colab}','weekly')" style="margin-top:8px;font-size:11px;background:none;border:1px dashed var(--border-mid);border-radius:6px;padding:4px 8px;color:var(--text-soft);cursor:pointer;width:100%;">+ adicionar</button>`;
  }
  
  function toggleFixed(colab, key, val) {
    const checks = getFixedChecks(colab);
    checks[key] = val;
    saveFixedChecks(colab, checks);
    renderFixedTasks(colab);
  }
  
  // Fixed task modal state
  let _fxtColab = null, _fxtType = null, _fxtId = null;
  
  function addFixedTask(colab, type) {
    _fxtColab = colab; _fxtType = type; _fxtId = null;
    document.getElementById('fxt-modal-title').textContent = 'Nova tarefa fixa';
    document.getElementById('fxt-label').value = '';
    openModal('modal-fixed-task');
    setTimeout(() => document.getElementById('fxt-label').focus(), 50);
  }
  
  function openFixedTaskModal(colab, type, existingId) {
    _fxtColab = colab; _fxtType = type; _fxtId = existingId;
    const data = getFixedData(colab);
    const list = type==='daily' ? data.daily : data.weekly;
    const existing = existingId ? list.find(t=>t.id===existingId) : null;
    document.getElementById('fxt-modal-title').textContent = existing ? 'Editar tarefa' : 'Nova tarefa fixa';
    document.getElementById('fxt-label').value = existing ? existing.label : '';
    openModal('modal-fixed-task');
    setTimeout(() => document.getElementById('fxt-label').focus(), 50);
  }
  
  function saveFixedTask() {
    const label = document.getElementById('fxt-label').value.trim();
    if (!label) { document.getElementById('fxt-label').focus(); return; }
    const link = '';
    const data = getFixedData(_fxtColab);
    const list = _fxtType==='daily' ? data.daily : data.weekly;
    if (_fxtId) {
      const t = list.find(x=>x.id===_fxtId);
      if (t) { t.label = label; t.link = link||undefined; }
    } else {
      const id = _fxtColab[0] + '-' + _fxtType[0] + '-' + Date.now();
      list.push({id, label, link: link||undefined});
    }
    saveFixedData(_fxtColab, data);
    renderFixedTasks(_fxtColab);
    closeModal('modal-fixed-task');
  }
  
  function editFixedTask(colab, type, id) {
    openFixedTaskModal(colab, type, id);
  }
  
  function deleteFixedTask(colab, type, id) {
    const data = getFixedData(colab);
    const snap = JSON.parse(JSON.stringify(data));
    data[type] = data[type].filter(x => x.id !== id);
    saveFixedData(colab, data);
    renderFixedTasks(colab);
    pushUndo('Tarefa fixa', () => { saveFixedData(colab, snap); renderFixedTasks(colab); });
  }
  
  function fixedDragStart(e, colab, type, id) {
    fixedDragSrc = id;
    fixedDragColab = colab;
    fixedDragType = type;
    e.dataTransfer.effectAllowed = 'move';
  }
  
  function fixedDrop(e, colab, type, targetId) {
    e.preventDefault();
    if (fixedDragColab !== colab || fixedDragType !== type || fixedDragSrc === targetId) return;
    const data = getFixedData(colab);
    const arr = data[type];
    const fromIdx = arr.findIndex(x => x.id === fixedDragSrc);
    const toIdx   = arr.findIndex(x => x.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    saveFixedData(colab, data);
    renderFixedTasks(colab);
  }
  
  
  /* ── CONTEÚDOS VISÃO GERAL ── */
  function buildVisaoConteudos() {
    const el = document.getElementById('visao-conteudos');
    if (!el) return;
    const hoje = new Date().toISOString().slice(0,10);
    const fim = new Date(); fim.setDate(fim.getDate()+7);
    const fimStr = fim.toISOString().slice(0,10);
    const lista = conteudos.filter(c => !isConteudoFinalizado(c) && c.dataPost >= hoje && c.dataPost <= fimStr);
    lista.sort((a,b)=>(a.dataPost||'').localeCompare(b.dataPost||''));
    if (lista.length === 0) {
      el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum conteúdo programado para os próximos 7 dias.</div>';
      return;
    }
    const empColors = {editora:'var(--editora)',leia:'var(--leia)',gisella:'var(--gisella)'};
    el.innerHTML = lista.map(c => {
      const emp = c.empresa||'editora';
      const cor = empColors[emp]||'var(--text-soft)';
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);">' +
        '<div style="width:3px;min-height:28px;background:'+cor+';border-radius:2px;flex-shrink:0;"></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:500;font-size:13px;">'+c.nome+'</div>' +
          '<div style="font-size:11px;color:var(--text-soft);">'+fmtDate(c.dataPost||'')+' · '+(c.rede||'')+'</div>' +
        '</div>' +
        '<span class="badge b-'+emp+'" style="font-size:10px;">'+(emp==='editora'?'Editora':emp==='leia'?'Léia':'GC')+'</span>' +
      '</div>';
    }).join('');
  }
  
  
  
  /* ── GOOGLE CALENDAR LÉIA ── */
  let gcalLeiaCache = [];
  
  async function loadGcalLeia() {
    const rangeStart = new Date(); rangeStart.setMonth(rangeStart.getMonth() - 2); rangeStart.setDate(1);
    const rangeEnd   = new Date(); rangeEnd.setMonth(rangeEnd.getMonth() + 4); rangeEnd.setDate(1);
  
    const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(GCAL_ID_LEIA) + '/events'
      + '?key=' + GCAL_API_KEY
      + '&timeMin=' + rangeStart.toISOString()
      + '&timeMax=' + rangeEnd.toISOString()
      + '&singleEvents=true&orderBy=startTime&maxResults=250';
  
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      gcalLeiaCache = (data.items || []).map(ev => {
        const title = (ev.summary && ev.summary.trim()) ? ev.summary.trim() : (ev.description ? ev.description.slice(0,30) : '(evento)');
        const start = ev.start ? (ev.start.dateTime ? ev.start.dateTime.slice(0,10) : ev.start.date) : '';
        const end   = ev.end   ? (ev.end.dateTime   ? ev.end.dateTime.slice(0,10)   : ev.end.date)   : start;
        return {
          title,
          start,
          end,
          startTime: ev.start && ev.start.dateTime ? ev.start.dateTime.slice(11,16) : null,
          endTime:   ev.end   && ev.end.dateTime   ? ev.end.dateTime.slice(11,16)   : null,
          description: ev.description || '',
          link: ev.htmlLink || '',
          empresa: 'leia',
        };
      });
      // Injetar no calendário da Léia
      refreshCalendars();
      buildEventosList();
    } catch(e) {
      console.warn('loadGcalLeia erro:', e);
    }
  }
  
  /* ── STORAGE ── */
  function load(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch(e) { return def; }
  }
  const _lastLocalSave = {};
  const CHECKLIST_SYNC_URL = 'https://piwsavppaabjygaolldb.supabase.co/functions/v1/sync-cassol-dashboard';
  const CHECKLIST_SYNCED_DOCUMENTS = new Set(['gc-events','gc-conteudos','gc-livros','gc-projetos']);
  let checklistDirectSyncTimer = null;
  function checklistRecipientsForChanges(key, items) {
    const names = [];
    const add = value => { if (value) names.push(String(value)); };
    items.forEach(item => {
      if (key === 'gc-events') add(item?.responsavel);
      if (key === 'gc-conteudos') Object.values(item?.etapasStatus || {}).forEach(stage => add(stage?.resp));
      if (key === 'gc-livros') {
        add(item?.responsavel);
        (item?.etapas || []).forEach(stage => add(stage?.resp));
      }
      if (key === 'gc-projetos') (item?.tarefas || []).forEach(task => add(task?.resp));
    });
    const normalized = names.map(name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase());
    return ['luiggi','gisella','milena'].filter(recipient => normalized.some(name => name === recipient || name.includes(recipient)));
  }
  function scheduleChecklistCentralSync(key, changedItems, previousChangedItems = []) {
    const token = sessionStorage.getItem('gc-dashboard-session-token');
    if (!token || !CHECKLIST_SYNCED_DOCUMENTS.has(key) || !changedItems.length) return;
    clearTimeout(checklistDirectSyncTimer);
    checklistDirectSyncTimer = setTimeout(async () => {
      try {
        // Inclui responsáveis antigos e novos. Assim, uma transferência não
        // deixa a tarefa presa no Checklist da pessoa anterior.
        const recipients = [...new Set([
          ...checklistRecipientsForChanges(key, previousChangedItems),
          ...checklistRecipientsForChanges(key, changedItems),
        ])];
        if (!recipients.length) return;
        const results = await Promise.allSettled(recipients.map(async recipient => {
          const response = await fetch(CHECKLIST_SYNC_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json','x-cassol-dashboard-session':token},
            body:JSON.stringify({operation:'dashboard_session_pull',source_document:key,document_value:changedItems,recipients:[recipient]}),
          });
          if (!response.ok) throw new Error(`${recipient}: HTTP ${response.status}`);
        }));
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      } catch (error) {
        console.warn('Sincronização central indisponível; o mecanismo de segurança tentará novamente.', error);
      }
  }, 0);
}
async function syncChecklistAfterDashboardDeletion(key, previousItems) {
  const token = sessionStorage.getItem('gc-dashboard-session-token');
  const recipients = checklistRecipientsForChanges(key, previousItems);
  if (!token || !recipients.length) return;
  await Promise.allSettled(recipients.map(recipient => fetch(CHECKLIST_SYNC_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','x-cassol-dashboard-session':token},
    body:JSON.stringify({operation:'dashboard_session_pull',recipients:[recipient]}),
  })));
}
function save(key, val) {
  const previousValue = load(key, []);
  const previousById = new Map((Array.isArray(previousValue) ? previousValue : []).map(item => [String(item?.id ?? ''), JSON.stringify(item)]));
  const changedItems = (Array.isArray(val) ? val : []).filter(item => previousById.get(String(item?.id ?? '')) !== JSON.stringify(item));
  const nextIds = new Set((Array.isArray(val) ? val : []).map(item => String(item?.id ?? '')));
  const removedItems = (Array.isArray(previousValue) ? previousValue : []).filter(item => !nextIds.has(String(item?.id ?? '')));
  const changedIds = new Set(changedItems.map(item => String(item?.id ?? '')));
  const previousChangedItems = (Array.isArray(previousValue) ? previousValue : []).filter(item => changedIds.has(String(item?.id ?? '')));
  localStorage.setItem(key, JSON.stringify(val));
  _lastLocalSave[key] = Date.now();
  // Cópia local da última lista não vazia: se uma lista vazia aparecer nesta
  // Central, a pessoa recebe a opção de restaurar os livros imediatamente.
  if (key === 'gc-livros' && Array.isArray(val) && val.length > 0) {
    localStorage.setItem('gc-livros-last-nonempty', JSON.stringify(val));
  }
  // O Checklist recebe a alteração imediatamente. A persistência no Firebase
  // continua em paralelo como cópia compartilhada do Dashboard.
  scheduleChecklistCentralSync(key, changedItems, previousChangedItems);
  if (window.fbSave) window.fbSave(key, val)
    .then(savedAt => {
      if (!savedAt) console.warn('Firebase não confirmou a gravação:', key);
      else if (removedItems.length) syncChecklistAfterDashboardDeletion(key, removedItems);
    })
    .catch(e => console.warn('fbSave err:', key, e));
    autoSave();
  }
  
  /* ── DATA ── */
  let events = load('gc-events', []).map(e => ({...e, tipo: e.tipo || 'tarefa'}));
  let recurringTasks = load('gc-recurring-tasks', []);

  function dashboardDate(value = new Date()) {
    return new Date(value).toLocaleDateString('sv-SE');
  }

  function addDashboardDays(dateStr, amount) {
    const date = new Date(`${dateStr}T12:00:00`);
    date.setDate(date.getDate() + Number(amount || 0));
    return dashboardDate(date);
  }

  function isMentoringCalendarEvent(event) {
    return /mentoria|mentoring/i.test([
      event?.title, event?.titulo, event?.description, event?.descricao,
      event?.location, event?.local,
    ].filter(Boolean).join(' '));
  }

  function isMentoringFeedbackTask(item) {
    const title = String(item?.titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return title === 'devolutivas da mentoria';
  }

  function ensureCustomRecurringTasks(calendarEvents = []) {
    const today = dashboardDate();
    const horizon = addDashboardDays(today, 120);
    let changed = false;
    let templatesChanged = false;
    recurringTasks.forEach(template => {
      if (isMentoringFeedbackTask(template) && template.responsavel !== 'Milena') {
        template.responsavel = 'Milena';
        templatesChanged = true;
      }
    });
    const feedbackTemplateIds = new Set(recurringTasks.filter(isMentoringFeedbackTask).map(template => template.id));
    events.forEach(event => {
      if (feedbackTemplateIds.has(event.recurrenceTemplateId) && event.responsavel !== 'Milena') {
        event.responsavel = 'Milena';
        changed = true;
      }
    });
    const createOccurrence = (template, date, sourceKey) => {
      if (!date || date < today) return;
      const recurrenceKey = `custom-recurrence-${template.id}-${sourceKey}`;
      if ((template.excludedOccurrenceKeys || []).includes(recurrenceKey)) return;
      if (events.some(event => event.recurrenceKey === recurrenceKey)) return;
      events.push({
        id: Date.now() + Math.floor(Math.random() * 100000),
        titulo: template.titulo,
        empresa: template.empresa,
        tipo: 'tarefa',
        data: date,
        responsavel: template.responsavel,
        observacao: template.observacao || '',
        urgente: Boolean(template.urgente),
        arquivada: false,
        recurrenceKey,
        recurrenceTemplateId: template.id,
      });
      changed = true;
    };
    const calendarSources = [...calendarEvents, ...(window.gcalEventsCache || [])];
    const knownCalendarEvents = [...new Map(calendarSources.map(event => {
      const date = String(event?.start || event?.data || '').slice(0, 10);
      const title = String(event?.title || event?.titulo || '').trim().toLowerCase();
      return [`${date}|${title}|${String(event?.link || '')}`, event];
    })).values()];
    recurringTasks.forEach(template => {
      if (template.kind === 'interval15') {
        const anchor = template.anchorDate || today;
        let date = anchor >= today ? anchor : today;
        const elapsed = Math.round((new Date(`${date}T12:00:00`) - new Date(`${anchor}T12:00:00`)) / 86400000);
        if (elapsed > 0) date = addDashboardDays(date, (15 - (elapsed % 15)) % 15);
        while (date <= horizon) {
          createOccurrence(template, date, date);
          date = addDashboardDays(date, 15);
        }
      } else if (template.kind === 'weekdays') {
        const selectedDays = (template.weekdays || []).map(Number);
        for (let offset = 0; offset <= 120; offset++) {
          const date = addDashboardDays(today, offset);
          if (selectedDays.includes(new Date(`${date}T12:00:00`).getDay())) createOccurrence(template, date, date);
        }
      } else if (['googleMentoring', 'googleCalendarMentoring', 'mentoring'].includes(template.kind)) {
        knownCalendarEvents.filter(isMentoringCalendarEvent).forEach(event => {
          const eventDate = String(event.start || event.data || '').slice(0, 10);
          if (!eventDate) return;
          const date = addDashboardDays(eventDate, template.mentoringOffset);
          createOccurrence(template, date, `${eventDate}-${String(event.title || event.titulo || '').trim().toLowerCase()}`);
        });
      }
    });
    if (changed) {
      save('gc-events', events);
      buildTarefas(); buildColabTarefas(); buildPrioridades(); refreshCalendars();
    }
    if (templatesChanged) save('gc-recurring-tasks', recurringTasks);
  }
  const MENTEES_DEFAULT = [
    {id:1,  name:'Dionysio Ofra',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1SGsDhwGmimnuiQk06NQqiS6bvi2HRwE3_VDAm85VAYc/edit?usp=sharing'},
    {id:2,  name:'Ângela Basso',            status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1VpQVSkAmtufEFSTwG9mkHe9jsUfi0KEAGqDR9NmyGkU/edit?usp=sharing'},
    {id:3,  name:'Hellen Quinta',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/10dKwyQVmCXfHBhlvB2uMSOPuW77mHDuyggP0sGypBXU/edit?usp=sharing'},
    {id:4,  name:'Jacqueline Gisler',       status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1uHaDvfzAGTSUFSdT-sd4ptbL2kUQ0TffaBTMpSe2IDA/edit?usp=sharing'},
    {id:5,  name:'Jessica Colvara Chacon',  status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://drive.google.com/drive/folders/1VaNQTaLbvkg32k-oAQc2vI7BzUJzgvua?usp=sharing'},
    {id:6,  name:'Juh Araujo',              status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/18QsOg5rRUF-uYampX0ZwhHArmENBtKQKYV_KX-RyeNc/edit?usp=sharing'},
    {id:7,  name:'Lauren Vargas',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1wSn_Nb2P_6xHOXW4dDVMgKDizRFwGBzTN_wxDNSn5X4/edit?usp=sharing'},
    {id:8,  name:'Liliana Madril',          status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1TeRxlkedAOhZTLTFiilRvEAL5Taa35zscKkWa5MJsA4/edit?usp=sharing'},
    {id:9,  name:'Marilia Santos Ribeiro',  status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1jamtnbLHaV_0WG8nHAUajMfHiHxbzN6QWBKtWDs59RE/edit?usp=sharing'},
    {id:10, name:'Martina Kirst',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1OjYYhf-Slk6fdgpzuYNpIh6gWSRseLi1xnzTWzZgeUg/edit?usp=sharing'},
    {id:11, name:'Michele Melo',            status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1WT6gbvQ9hoznBGmFf1ItVe3TmdfF3PoPH4Lf-RI9B74/edit?usp=sharing'},
    {id:12, name:'Nathiele Fagundes',       status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1p3_DLCevkLsYHTMmaJ7O90G0crY_v9sTdE9Mbn1i6iA/edit?usp=sharing'},
    {id:13, name:'Priscila Cunha',          status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1UzZ4a9OQphe0hA62QZyfqQASbBYDv4UzYl_k-IL99wI/edit?usp=sharing'},
    {id:14, name:'Regina Vieira',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/17DxYV8MinQJ5SYx1EoD8qqPvTK8C2Z2xuTBxrHX0hJI/edit?usp=sharing'},
    {id:15, name:'Tetê Amodeo',             status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/17btvt710XxKuOQx4Ezk1ocyZM5CHFJKzqXdS3mMrXfY/edit?usp=sharing'},
    {id:16, name:'Ana Elisa Coelho Pinho',  status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1cnHtrvLdCLgnw3qvkhBcfW2XhjqOhRQ5-vnSrXEULWc/edit?usp=drive_link'},
    {id:17, name:'Gabi Prado',              status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1KtdxNtXgChIMfGdMfC5Gy9MaQTGsiotBsimoLwCxzNA/edit?usp=drive_link'},
    {id:18, name:'Ni Cordeiro',             status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1tTEuRTAruDtkOMW-KMOv5OlH7u-YSpV29ggygzXJO2E/edit?usp=drive_link'},
    {id:19, name:'Patrícia Lima',           status:'ok', notes:'', sessions:[], tasks:[], docsLink:'https://docs.google.com/document/d/1CZDs8GCY7tDRfNmmY5W8m4YdfYhWk0H1NV2wpqiI0SE/edit?usp=drive_link'}
  ];
  
  // Mesclar com dados salvos: preserva notas/sessões/tarefas existentes, garante que todos os 19 estejam presentes
  function mergeMentees(saved) {
    const result = MENTEES_DEFAULT.map(def => {
      const existing = saved.find(s => s.name === def.name);
      return existing ? {...def, notes: existing.notes||'', sessions: existing.sessions||[], tasks: existing.tasks||[], status: existing.status||'ok'} : def;
    });
    // Adicionar quaisquer extras cadastrados manualmente que não estejam na lista default
    saved.forEach(s => {
      if (!result.find(r => r.name === s.name)) {
        result.push(s);
      }
    });
    return result;
  }
  
  let mentees      = load('gc-mentees',       MENTEES_DEFAULT);
  let menteesMarco0 = load('gc-mentees-marco0', []);
  let livros = load('gc-livros', []);
  function offerLivrosRecovery() {
    const backup = load('gc-livros-last-nonempty', []);
    if (livros.length || !Array.isArray(backup) || !backup.length) return;
    if (sessionStorage.getItem('gc-livros-recovery-offered')) return;
    sessionStorage.setItem('gc-livros-recovery-offered', '1');
    if (window.confirm(`A Central está sem livros, mas existe uma cópia de segurança neste dispositivo com ${backup.length} livro(s). Deseja restaurá-la agora?`)) {
      livros = backup;
      save('gc-livros', livros);
      renderLivros();
    }
  }
  let conteudos = load('gc-conteudos', []);
  let steiraData = load('gc-steira', {});
  let kanbanData = load('gc-kanban', {});
  
  const ETAPAS_DEFAULT = [
    'Briefing',
    'Texto em andamento',
    'Texto preparado',
    'Texto finalizado',
    'Escolha do ilustrador',
    'Reunião de alinhamento de conceito',
    'Pré-diagramação',
    'Esboços',
    'Estado da arte — coloração',
    'Finalização das ilustrações',
    'ISBN + Código de barras + Ficha catalográfica',
    'Diagramação final',
    'Revisão',
    'Revisão final',
    'UV',
    'Envio para gráfica',
    'Boneco',
    'Ajuste fino',
    'Contrato',
    'Aprovação para impressão',
    'Recebimento do estoque',
    'Cadastro no sistema',
    'Liberação no site',
  ];
  
  const ETAPAS_REIMP = [
    'Pedir orçamento',
    'Reler impresso',
    'Localizar arquivos',
    'Enviar para revisão',
    'Fazer alterações',
    'Enviar para gráfica',
    'Prova digital',
    'Liberar para impressão',
  ];
  
  /* ── NAV ── */
  
  /* ── CALENDÁRIO SEMANAL CONTEÚDO ── */
  let _conteudoCalView = 'semana';
  let _conteudoWeekOffset = 0;
  
  function setConteudoCalView(view) {
    _conteudoCalView = view;
    const wrap = document.getElementById('cal-conteudo-wrap');
    if (wrap) wrap.dataset.view = view;
    document.getElementById('btn-cal-semana').classList.toggle('active', view === 'semana');
    document.getElementById('btn-cal-mes').classList.toggle('active', view === 'mes');
    if (view === 'semana') {
      buildConteudoCalSemana();
    } else {
      const wrap2 = document.getElementById('cal-conteudo-wrap');
      if (wrap2) wrap2.innerHTML = '<div class="cal-wrap" id="cal-conteudo"></div>';
      buildCalendar('cal-conteudo', getFilter('conteudo-menu'));
    }
  }
  
  function buildConteudoCalSemana() {
    const wrap = document.getElementById('cal-conteudo-wrap');
    if (!wrap) return;
    wrap.dataset.view = 'semana';
  
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - hoje.getDay() + (_conteudoWeekOffset * 7));
    const dias = Array.from({length:7}, (_,i) => {
      const d = new Date(inicioSemana);
      d.setDate(inicioSemana.getDate() + i);
      return d;
    });
  
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const dows = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
    const filter = getFilter('conteudo-menu');
  
    const inicioStr = dias[0].toISOString().slice(0,10);
    const fimStr = dias[6].toISOString().slice(0,10);
    const label = `${dias[0].getDate()} ${meses[dias[0].getMonth()]} — ${dias[6].getDate()} ${meses[dias[6].getMonth()]} ${dias[6].getFullYear()}`;
  
    let html = `<div class="cal-header">
      <button class="cal-nav" onclick="_conteudoWeekOffset--;buildConteudoCalSemana()">‹</button>
      <div class="cal-month">${label}</div>
      <button class="cal-nav" onclick="_conteudoWeekOffset++;buildConteudoCalSemana()">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:8px;">`;
  
    dias.forEach((dia, idx) => {
      const ds = dia.toISOString().slice(0,10);
      const isToday = ds === hoje.toISOString().slice(0,10);
      const dayConts = conteudos.filter(c =>
        !isConteudoFinalizado(c) && c.dataPost === ds &&
        (filter === 'all' || (c.empresa||'').split(',').includes(filter))
      );
  
      html += `<div style="background:var(--surface);border-radius:10px;padding:8px;min-height:90px;border:1px solid ${isToday?'var(--gisella)':'var(--border)'}">
        <div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${dows[idx]}</div>
        <div style="font-size:${isToday?'16px':'14px'};font-weight:${isToday?'700':'500'};color:${isToday?'var(--gisella)':'var(--text)'};margin-bottom:6px;">${dia.getDate()}</div>`;
  
      dayConts.forEach(c => {
        const cor = c.empresa==='editora'?'var(--editora)':c.empresa==='leia'?'var(--leia)':'var(--gisella)';
        html += `<div onclick="openConteudo(${c.id})" style="font-size:10px;padding:2px 5px;border-radius:4px;margin-bottom:2px;background:${cor}15;color:${cor};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2px solid ${cor};" title="Postagem: ${c.nome}">📤 ${c.nome}</div>`;
      });
  
      html += '</div>';
    });
  
    html += '</div>';
    wrap.innerHTML = html;
  }
  
  /* ── CALENDÁRIO SEMANAL DE TAREFAS DOS LIVROS (aba Livros) ── */
  let _livrosCalWeekOffset = 0;
  let _livroCalDragSrc = null;
  
  function buildLivrosCalSemana() {
    const wrap = document.getElementById('cal-livros-semana-wrap');
    if (!wrap) return;
  
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - hoje.getDay() + (_livrosCalWeekOffset * 7));
    const dias = Array.from({length:7}, (_,i) => {
      const d = new Date(inicioSemana);
      d.setDate(inicioSemana.getDate() + i);
      return d;
    });
  
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const dows = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
    const filter = getFilter('livros');
    const hojeStr = hoje.toISOString().slice(0,10);
    const label = `${dias[0].getDate()} ${meses[dias[0].getMonth()]} — ${dias[6].getDate()} ${meses[dias[6].getMonth()]} ${dias[6].getFullYear()}`;
  
    // Montar lista de etapas (tarefas de livros) que têm prazo definido
    const todasEtapas = [];
    livros.forEach(l => {
      if (filter !== 'all' && !(l.empresa||'').split(',').includes(filter)) return;
      (l.etapas||[]).forEach((e,i) => {
        if (!e.prazo) return;
        todasEtapas.push({ livroId: l.id, idx: i, livroTitulo: l.titulo, empresa: l.empresa, nome: e.nome, prazo: e.prazo, feito: e.feito });
      });
    });
  
    let html = `<div class="cal-header" style="padding:0 0 10px;border-bottom:none;">
      <button class="cal-nav" onclick="_livrosCalWeekOffset--;buildLivrosCalSemana()">‹</button>
      <div class="cal-month">${label}</div>
      <button class="cal-nav" onclick="_livrosCalWeekOffset++;buildLivrosCalSemana()">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">`;
  
    dias.forEach((dia, idx) => {
      const ds = dia.toISOString().slice(0,10);
      const isToday = ds === hojeStr;
      const dayEtapas = todasEtapas.filter(e => e.prazo === ds);
  
      html += `<div class="livros-cal-day" ondragover="event.preventDefault();this.style.background='var(--gisella-bg)';" ondragleave="this.style.background='var(--surface)';" ondrop="livroCalDrop(event,'${ds}')"
        style="background:var(--surface);border-radius:10px;padding:8px;min-height:110px;border:1px solid ${isToday?'var(--gisella)':'var(--border)'};transition:background 0.1s;">
        <div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${dows[idx]}</div>
        <div style="font-size:${isToday?'16px':'14px'};font-weight:${isToday?'700':'500'};color:${isToday?'var(--gisella)':'var(--text)'};margin-bottom:6px;">${dia.getDate()}</div>`;
  
      if (dayEtapas.length === 0) {
        html += `<div style="font-size:10px;color:var(--text-soft);opacity:0.5;">—</div>`;
      }
      dayEtapas.forEach(e => {
        const primeiraEmp = (e.empresa||'').split(',')[0];
        const cor = primeiraEmp==='editora'?'var(--editora)':primeiraEmp==='leia'?'var(--leia)':'var(--gisella)';
        html += `<div draggable="true"
          ondragstart="livroCalDragStart(event,${e.livroId},${e.idx})"
          onclick="openEditEtapa(${e.livroId},${e.idx})"
          title="${e.livroTitulo} — ${e.nome}"
          style="font-size:10px;padding:4px 6px;border-radius:4px;margin-bottom:3px;background:${cor}15;color:${cor};cursor:grab;border-left:2px solid ${cor};${e.feito?'opacity:0.45;':''}">
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${e.feito?'text-decoration:line-through;':''}">${e.nome}</span>
          <span style="display:block;font-size:9px;opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.livroTitulo}</span>
        </div>`;
      });
  
      html += '</div>';
    });
  
    html += '</div>';
    wrap.innerHTML = html;
  }
  
  function livroCalDragStart(e, livroId, idx) {
    _livroCalDragSrc = { livroId, idx };
    e.dataTransfer.effectAllowed = 'move';
  }
  
  function livroCalDrop(e, novaData) {
    e.preventDefault();
    e.currentTarget.style.background = 'var(--surface)';
    if (!_livroCalDragSrc) return;
    const { livroId, idx } = _livroCalDragSrc;
    _livroCalDragSrc = null;
    updateEtapaPrazoInline(livroId, idx, novaData);
  }
  
  /* ── CALENDÁRIO SEMANAL DE TAREFAS (aba Tarefas) ── */
  let _tarefasCalWeekOffset = 0;
  let _tarefaCalDragSrc = null;
  
  /* ── TIPO TAREFA ── */
  const _TIPO_EMOJI = { burocracia:'⚙️', criativo:'💡', estrategia:'🎯' };
  const _TIPO_ORDER = { burocracia:2, criativo:1, estrategia:0, '':3 };
  function _sortTipo(arr) {
    return arr.slice().sort((a,b) => {
      // Pendentes sempre ficam acima das concluídas. Dentro de cada bloco,
      // urgentes vêm primeiro; o tipo e o título só desempatarem depois.
      const completedDiff = Number(!!a.arquivada) - Number(!!b.arquivada);
      if (completedDiff !== 0) return completedDiff;
      const urgentDiff = Number(!!b.urgente) - Number(!!a.urgente);
      if (urgentDiff !== 0) return urgentDiff;
      const oa = _TIPO_ORDER[a.tipoTarefa||''] ?? 3;
      const ob = _TIPO_ORDER[b.tipoTarefa||''] ?? 3;
      return oa !== ob ? oa - ob : (a.titulo||'').localeCompare(b.titulo||'');
    });
  }
  /* _fds: move sábado→sexta, domingo→segunda */
  function _fds(ds) {
    if (!ds) return ds;
    const d = new Date(ds + 'T00:00:00');
    const dw = d.getDay();
    if (dw === 6) { d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
    if (dw === 0) { d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
    return ds;
  }
  
  function buildTarefasCalSemana() {
    const wrap  = document.getElementById('cal-tarefas-semana-wrap');
    const wrapV = document.getElementById('cal-visao-semana-wrap');
    const wrapC1 = document.getElementById('colab-cal-semana-gisella');
    const wrapC2 = document.getElementById('colab-cal-semana-milena');
    const wrapC3 = document.getElementById('colab-cal-semana-luiggi');
    if (!wrap && !wrapV && !wrapC1 && !wrapC2 && !wrapC3) return;
  
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const inicioSemana = new Date(hoje);
    const _dow0 = hoje.getDay();
    const _dm   = _dow0 === 0 ? -6 : 1 - _dow0; // segunda é o primeiro dia
    inicioSemana.setDate(hoje.getDate() + _dm + (_tarefasCalWeekOffset * 7));
    const dias = Array.from({length:7}, (_,i) => {
      const d = new Date(inicioSemana);
      d.setDate(inicioSemana.getDate() + i);
      return d;
    });
  
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const dows  = ['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
    const hojeStr = hoje.toISOString().slice(0,10);
    const label = `${dias[0].getDate()} ${meses[dias[0].getMonth()]} — ${dias[6].getDate()} ${meses[dias[6].getMonth()]} ${dias[6].getFullYear()}`;
  
    const _tf  = getFilter('tarefas');
    const _tfc = getFilterColab('tarefas');
  
    const etapaEvents = [];
    livros.forEach(l => {
      (l.etapas||[]).forEach((e,i) => {
        const empMatch = _tf==='all'||(l.empresa||'').split(',').includes(_tf);
        if (!empMatch) return;
        if (_tfc!=='all' && (e.resp||'')!==_tfc) return;
        etapaEvents.push({
          _isEtapa:true, livroId:l.id, etapaIdx:i,
          titulo:`[${l.titulo}] ${e.nome}`, empresa:l.empresa,
          data:e.prazo||'', responsavel:e.resp||'', arquivada:!!e.feito, urgente:false, tipoTarefa:'',
        });
      });
    });
    // Etapas de conteúdos como tarefas virtuais no calendário semanal
    conteudos.forEach(c => {
      if (isConteudoFinalizado(c)) return;
      const empMatch = _tf==='all'||(c.empresa||'').split(',').includes(_tf);
      if (!empMatch) return;
      const etapas = getConteudoEtapasLiberadas(c);
      etapas.forEach(e => {
        if (!e.prazo) return; // só aparece no cal se tiver prazo
        if (_tfc!=='all' && (e.resp||'')!==_tfc) return;
        etapaEvents.push({
          _isEtapa:false, _conteudoId:c.id, _conteudoKey:e.key,
          id:`cont-${c.id}-${e.key}`,
          titulo:`[${c.nome}] ${e.nome}`, empresa:c.empresa,
          data:e.prazo, responsavel:e.resp||'', arquivada:!!e.feito, urgente:false, tipoTarefa:'',
        });
      });
    });
    const todas = [
      ...events.filter(e => e.tipo==='tarefa' && (_tf==='all'||(e.empresa||'').split(',').includes(_tf)) && (_tfc==='all'||(e.responsavel||'')===_tfc))
        .map(e => ({ _isEtapa:false, id:e.id, titulo:e.titulo, empresa:e.empresa, data:e.data||'', responsavel:e.responsavel||'', arquivada:!!e.arquivada, urgente:!!e.urgente, tipoTarefa:e.tipoTarefa||'' })),
      ...etapaEvents,
    ];
  
    function _chipHtml(t, cor) {
      const dragStart = t._isEtapa ? `tarefaCalDragStart(event,'etapa',${t.livroId},${t.etapaIdx})` : `tarefaCalDragStart(event,'evento',${t.id},null)`;
      const clickAction = t._isEtapa ? `openEditEtapa(${t.livroId},${t.etapaIdx})` : (t._conteudoId ? `openConteudoEtapasPrazos(${t._conteudoId})` : `openEditEvent(${t.id})`);
      const _chk = t._isEtapa ? `toggleEtapa(${t.livroId},${t.etapaIdx})` : (t._conteudoId ? `toggleConteudoEtapa(${t._conteudoId},'${t._conteudoKey}')` : `toggleTarefaArquivada(${t.id})`);
      return `<div style="font-size:10px;padding:4px 6px;border-radius:4px;margin-bottom:3px;background:${cor}15;color:${cor};border-left:2px solid ${cor};${t.arquivada?'opacity:0.45;':''}display:flex;align-items:flex-start;gap:4px;">
        <input type="checkbox" ${t.arquivada?'checked':''} onchange="${_chk}" onclick="event.stopPropagation();" style="accent-color:${cor};flex-shrink:0;margin-top:2px;width:11px;height:11px;cursor:pointer;">
        <div draggable="true" ondragstart="${dragStart}" onclick="${clickAction}" style="flex:1;min-width:0;cursor:pointer;">
          <span style="display:block;word-break:break-word;line-height:1.3;${t.arquivada?'text-decoration:line-through;':''}">${t.urgente?'❗ ':''}${_TIPO_EMOJI[t.tipoTarefa]?_TIPO_EMOJI[t.tipoTarefa]+' ':''}${t.titulo}</span>
          ${t.responsavel?`<span style="display:block;font-size:9px;opacity:0.8;">${t.responsavel}</span>`:''}
        </div>
      </div>`;
    }
  
    if (wrap) {
      let html = `<div class="cal-header" style="padding:0 0 10px;border-bottom:none;">
        <button class="cal-nav" onclick="_tarefasCalWeekOffset--;buildTarefasCalSemana()">‹</button>
        <div class="cal-month">${label}</div>
        <button class="cal-nav" onclick="_tarefasCalWeekOffset++;buildTarefasCalSemana()">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;align-items:start;">`;
      dias.forEach((dia,idx) => {
        const ds = dia.toISOString().slice(0,10);
        const isToday = ds === hojeStr;
        const dayTarefas = _sortTipo(todas.filter(t => t.data === ds));
        const cor = 'var(--gisella)';
        html += `<div class="tarefas-cal-day" ondragover="event.preventDefault();this.style.background='var(--gisella-bg)';" ondragleave="this.style.background='var(--surface)';" ondrop="tarefaCalDrop(event,'${ds}')"
          style="background:var(--surface);border-radius:10px;padding:8px;min-height:110px;border:1px solid ${isToday?'var(--gisella)':'var(--border)'};transition:background 0.1s;">
          <div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${dows[idx]}</div>
          <div style="font-size:${isToday?'16px':'14px'};font-weight:${isToday?'700':'500'};color:${isToday?'var(--gisella)':'var(--text)'};margin-bottom:6px;">${dia.getDate()}</div>`;
        if (dayTarefas.length===0) html += `<div style="font-size:10px;color:var(--text-soft);opacity:0.5;">—</div>`;
        dayTarefas.forEach(t => {
          const pr = (t.empresa||'').split(',')[0];
          const c = pr==='editora'?'var(--editora)':pr==='leia'?'var(--leia)':'var(--gisella)';
          html += _chipHtml(t, c);
        });
        html += '</div>';
      });
      html += '</div>';
      wrap.innerHTML = html;
    }
  
    if (wrapV) {
      let hVG = `<div class="cal-header" style="padding:0 0 10px;border-bottom:none;">
        <button class="cal-nav" onclick="_tarefasCalWeekOffset--;buildTarefasCalSemana()">‹</button>
        <div class="cal-month">${label}</div>
        <button class="cal-nav" onclick="_tarefasCalWeekOffset++;buildTarefasCalSemana()">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;align-items:start;">`;
      dias.forEach((dia,idx) => {
        const ds = dia.toISOString().slice(0,10);
        const isToday = ds === hojeStr;
        const dayTarefas = _sortTipo(todas.filter(t => t.data === ds));
        hVG += `<div style="background:var(--surface);border-radius:10px;padding:8px;min-height:90px;border:1px solid ${isToday?'var(--gisella)':'var(--border)'};">
          <div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;margin-bottom:4px;">${dows[idx]}</div>
          <div style="font-size:${isToday?'16px':'14px'};font-weight:${isToday?700:500};color:${isToday?'var(--gisella)':'var(--text)'};margin-bottom:6px;">${dia.getDate()}</div>`;
        if (dayTarefas.length===0) hVG += `<div style="font-size:10px;color:var(--text-soft);opacity:0.5;">—</div>`;
        dayTarefas.forEach(t => {
          const pr = (t.empresa||'').split(',')[0];
          const c = pr==='editora'?'var(--editora)':pr==='leia'?'var(--leia)':'var(--gisella)';
          hVG += _chipHtml(t, c);
        });
        hVG += '</div>';
      });
      hVG += '</div>';
      wrapV.innerHTML = hVG;
    }
  
    [wrapC1,wrapC2,wrapC3].filter(Boolean).forEach(w => {
      const key = w.id.replace('colab-cal-semana-','');
      _buildColabCal(key);
    });
  }
  
  function tarefaCalDragStart(e, kind, a, b) {
    _tarefaCalDragSrc = kind === 'etapa' ? { kind:'etapa', livroId:a, idx:b } : { kind:'evento', id:a };
    e.dataTransfer.effectAllowed = 'move';
  }
  
  function tarefaCalDrop(e, novaData) {
    e.preventDefault();
    e.currentTarget.style.background = 'var(--surface)';
    if (!_tarefaCalDragSrc) return;
    const src = _tarefaCalDragSrc;
    _tarefaCalDragSrc = null;
    if (src.kind === 'etapa') {
      updateEtapaPrazoInline(src.livroId, src.idx, novaData);
    } else {
      const ev = events.find(x => x.id === src.id);
      if (!ev) return;
      ev.data = novaData;
      save('gc-events', events);
      buildTarefas();
      buildColabTarefas();
      buildPrioridades();
      refreshCalendars();
    }
  }
  
  /* ── MOBILE NAV ── */
  function toggleMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobile-nav-overlay');
    const isOpen = sidebar && sidebar.classList.contains('mobile-open');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.style.display = isOpen ? 'none' : 'block';
  }
  function closeMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.style.display = 'none';
  }
  
  function showPage(id, btn) {
    closeMobileNav();
    let el = document.getElementById('page-' + id);
    // Fallback de segurança: se a página não existir (ex: link antigo/salvo
    // para uma aba removida), cai na aba Tarefas em vez de deixar tela em branco.
    if (!el) {
      id = 'tarefas';
      el = document.getElementById('page-tarefas');
      btn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes("'tarefas'"));
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    if (btn) btn.classList.add('active');
    localStorage.setItem('gc-current-page', id);
    if (id === 'visao') { buildPrioridades(); window.scrollTo({top:0,behavior:'instant'}); }
    if (id === 'tarefas') { buildTarefas(); }
  
  
    if (id === 'colab-gisella') { loadGcal(); renderNotas('gisella'); setTimeout(() => renderNotas('gisella'), 300); setTimeout(countMentoriasSemana, 800); buildColabTarefas(); }
    if (id === 'colab-milena')  { renderNotas('milena');  buildColabTarefas(); }
    if (id === 'colab-luiggi') { renderNotas('luiggi'); buildColabTarefas(); }
    if (id === 'conteudo-menu') { buildConteudoCalSemana(); }
    if (id === 'eventos') { buildCalendar('cal-eventos', getFilter('eventos')); buildEventosList(); }
    if (id === 'links') { renderLinks(); }
  }
  
  function showPageSection(pageId, sectionId) {
    const navBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes("'"+pageId+"'"));
    showPage(pageId, navBtn);
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }
  
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }
  
  function updateQaFields() {
    const tipo = document.getElementById('qa-tipo').value;
    if (tipo === 'livro' && !window._editingEtapa) {
      const empresa = ['editora','leia','gisella'].find(key => document.getElementById('qa-emp-'+key)?.checked) || 'editora';
      document.getElementById('qa-tipo').value = 'tarefa';
      closeModal('modal-quickadd');
      setTimeout(() => openAddLivro(empresa), 60);
      return;
    }
    ['tarefa','evento','projeto','conteudo','livro'].forEach(t => {
      const el = document.getElementById('qa-fields-' + t);
      if (el) el.style.display = t === tipo ? 'block' : 'none';
    });
    if (tipo === 'conteudo') updateQaConteudoRede();
    if (tipo === 'tarefa') updateQaRecorrenciaFields();
  }

  function updateQaRecorrenciaFields() {
    const kind = getQaVal('qa-recorrencia') || 'none';
    const weekdays = document.getElementById('qa-recorrencia-weekdays');
    const mentoring = document.getElementById('qa-recorrencia-mentoring');
    if (weekdays) weekdays.style.display = kind === 'weekdays' ? 'block' : 'none';
    if (mentoring) mentoring.style.display = kind === 'googleMentoring' ? 'block' : 'none';
  }
  
  function updateQaConteudoRede() {
    const rede = document.getElementById('qa-c-rede')?.value;
    const isEmanda = rede === 'emanda';
    const organico = document.getElementById('qa-c-organico-wrap');
    const tipoWrap = document.getElementById('qa-c-tipo-wrap');
    const copyWrap = document.getElementById('qa-c-copy-wrap');
    if (organico) organico.style.display = isEmanda ? 'none' : '';
    if (tipoWrap) tipoWrap.style.display = isEmanda ? 'none' : '';
    if (copyWrap) copyWrap.style.display = isEmanda ? 'none' : '';
    if (isEmanda) {
      const tipoSel = document.getElementById('qa-c-tipo');
      if (tipoSel) tipoSel.value = 'emailmkt';
    }
  }
  
  function updateMcRede() {
    const rede = document.getElementById('mc-rede')?.value;
    const isEmanda = rede === 'emanda';
    const organico = document.getElementById('mc-organico-wrap');
    const tipoWrap = document.getElementById('mc-tipo-wrap');
    const copyWrap = document.getElementById('mc-copy-wrap');
    if (organico) organico.style.display = isEmanda ? 'none' : '';
    if (tipoWrap) tipoWrap.style.display = isEmanda ? 'none' : '';
    if (copyWrap) copyWrap.style.display = isEmanda ? 'none' : '';
    if (isEmanda) {
      const tipoSel = document.getElementById('mc-tipo');
      if (tipoSel) tipoSel.value = 'emailmkt';
    }
  }
  
  function updateDocsLink() {
    const val = document.getElementById('mm-docs').value.trim();
    const link = document.getElementById('mm-docs-open');
    if (link) { link.href = val; link.style.display = val ? 'inline' : 'none'; }
  }
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  
  // Modal não fecha ao clicar fora (mantém informações)
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
      // Não fecha ao clicar fora para não perder dados
    });
  });
  
  /* ── CHECKLIST ── */
  function toggleCheck(cb) {
    const label = cb.closest('.check-item');
    cb.checked ? label.classList.add('done') : label.classList.remove('done');
    autoSave();
  }
  function addCheckItem(listId) {
    const list = document.getElementById(listId);
    const label = document.createElement('label');
    label.className = 'check-item';
    label.innerHTML = '<input type="checkbox" onchange="toggleCheck(this)"> <span contenteditable="true">Nova tarefa</span>';
    list.appendChild(label);
    label.querySelector('span').focus();
  }
  
  function addAlert() {
    const div = document.createElement('div');
    div.className = 'alert-item normal';
    div.innerHTML = `<div class="alert-left"><div class="alert-empresa" contenteditable="true">Empresa</div><div class="alert-title" contenteditable="true">Descreva o alerta</div></div><span class="alert-prazo" contenteditable="true">prazo</span><span class="badge b-gray">novo</span>`;
    document.getElementById('alerts-list').appendChild(div);
    div.querySelector('.alert-title').focus();
  }
  
  /* ── CALENDAR ── */
  const CAL_STATE = {};
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const DOWS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  
  function buildCalendar(id, filter) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!CAL_STATE[id]) { const n = new Date(); CAL_STATE[id] = {y:n.getFullYear(), m:n.getMonth(), filter}; }
    else { CAL_STATE[id].filter = filter; }
    const {y, m} = CAL_STATE[id];
    const today = new Date(); today.setHours(0,0,0,0);
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m+1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
  
    // Eventos do Google Calendar em memória (não salvos)
    const gcalEventsNative = [
      ...(window.gcalEventsCache || []).map(ev => ({
        id: 'gcal-' + ev.start + '-' + ev.title.slice(0,10).replace(/\s/g,''),
        titulo: ev.title,
        empresa: 'gisella',
        tipo: 'evento',
        data: ev.start,
        dataFim: ev.end,
        startTime: ev.startTime,
        gcal: true,
        link: ev.link,
        _sharedCal: ev._sharedCal || null,
      })),
      ...(gcalLeiaCache || []).map(ev => ({
        id: 'gcal-leia-' + ev.start + '-' + (ev.title||'x').slice(0,10).replace(/\s/g,''),
        titulo: ev.title || ev.summary || '(sem título)',
        empresa: 'leia',
        tipo: 'evento',
        data: ev.start,
        dataFim: ev.end || ev.start,
        gcal: true,
        startTime: ev.startTime,
        endTime: ev.endTime,
      })),
    ];
  
    let html = `<div class="cal-header"><button class="cal-nav" onclick="calNav('${id}',-1)">‹</button><div class="cal-month">${MESES[m]} ${y}</div><button class="cal-nav" onclick="calNav('${id}',1)">›</button></div><div class="cal-grid">`;
    DOWS.forEach(d => html += `<div class="cal-dow">${d}</div>`);
    for (let i = first-1; i >= 0; i--) html += `<div class="cal-day other-month"><div class="cal-num">${prevDays-i}</div></div>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = new Date(y,m,d).getTime() === today.getTime();
      const feriadoNome = isFeriado(ds) ? getFeriadoNome(ds) : null;
      const showConteudos = (id === 'cal-conteudo' || id === 'cal-visao');
      const showEventos = (id !== 'cal-conteudo');
      const _calFilter = CAL_STATE[id] ? CAL_STATE[id].filter : filter;
      const dayConteudos = showConteudos
        ? conteudos.filter(c => !isConteudoFinalizado(c) && c.dataPost === ds && (_calFilter === 'all' || (c.empresa||'').split(',').includes(_calFilter)))
        : [];
      const allEventsRaw = showEventos ? [...events, ...gcalEventsNative] : [];
      // Deduplicar por id (gcal ids são strings como 'gcal-...')
      const seenIds = new Set();
      const allEvents = allEventsRaw.filter(e => {
        const k = String(e.id);
        if (seenIds.has(k)) return false;
        seenIds.add(k);
        return true;
      });
      const _evFilter = CAL_STATE[id] ? CAL_STATE[id].filter : filter;
      const dayEvs = showEventos ? allEvents.filter(e => {
        if (e.tipo !== 'evento') return false;          // só eventos, nunca tarefas/projetos/etc
        const eStart = e.data || '';
        const eEnd = e.dataFim || e.data || '';
        if (!eStart) return false;
        if (!(ds >= eStart && ds <= eEnd)) return false;
        if (id === 'cal-eventos' && _evFilter !== 'all' && !(e.empresa||'').split(',').includes(_evFilter)) return false;
        if (id !== 'cal-visao' && id !== 'cal-eventos' && filter !== 'all' && !(e.empresa||'').split(',').includes(filter)) return false;
        return true;
      }) : [];
      let evHtml = '';
      if (feriadoNome) evHtml += `<div class="cal-event" style="background:#FEF3DA;color:#7A5200;font-size:9px;" title="${feriadoNome}">🏖 ${feriadoNome.split(' ')[0]}</div>`;
      const contColors = {editora:{bg:'rgba(120,20,20,0.12)',color:'#7b1414'},leia:{bg:'rgba(60,10,80,0.12)',color:'#3c0a50'},gisella:{bg:'rgba(100,100,100,0.15)',color:'#111111'}};
      const _maxItems = (id === 'cal-visao') ? 99 : 3;
      evHtml += dayConteudos.slice(0,_maxItems).map(c => {
        const cc = contColors[c.empresa||'editora']||contColors.editora;
        return `<div class="cal-event" style="background:${cc.bg};color:${cc.color};cursor:pointer;font-style:italic;" onclick="event.stopPropagation();openConteudo(${c.id})">✏ ${c.nome}</div>`;
      }).join('');
      evHtml += dayEvs.slice(0,_maxItems).map(e => {
        if (e._gcal || e.gcal) {
          const time = e.startTime ? `${e.startTime} ` : '';
          let gcalBg, gcalColor, gcalBorder;
          if (e._sharedCal) {
            gcalBg = e._sharedCal.bg; gcalColor = e._sharedCal.color; gcalBorder = e._sharedCal.color;
          } else if (e.empresa === 'leia') {
            gcalBg = 'var(--leia-bg)'; gcalColor = 'var(--leia)'; gcalBorder = 'var(--leia)';
          } else {
            gcalBg = 'var(--gisella-bg)'; gcalColor = 'var(--gisella)'; gcalBorder = 'var(--gisella)';
          }
          const calLabel = e._sharedCal ? `[${e._sharedCal.label}] ` : '';
          return `<div class="cal-event" style="background:${gcalBg};color:${gcalColor};border-left:2px solid ${gcalBorder};cursor:default;" title="${e.titulo}${e._sharedCal?' ['+e._sharedCal.label+']':''} (Google Calendar)">${time}${calLabel}${e.titulo}</div>`;
        }
        return `<div class="cal-event ev-${e.empresa}" onclick="event.stopPropagation();openEditEvent(${e.id})" style="cursor:pointer;">${e.titulo}</div>`;
      }).join('');
      const total = dayConteudos.length + dayEvs.length;
      // Collect ALL events for this day for modal
      const allDayEvs = [...dayConteudos.map(c=>({type:'conteudo',c})), ...dayEvs.map(e=>({type:'evento',e}))];
      const moreCount = (id === 'cal-visao') ? 0 : allDayEvs.length - 3;
      // Store day data in global cache keyed by calId+date
      if (!window._calDayCache) window._calDayCache = {};
      window._calDayCache[id+'_'+ds] = allDayEvs;
      if (moreCount > 0) evHtml += `<div onclick="event.stopPropagation();openDayModalFromCache('${id}','${ds}')" style="font-size:10px;color:var(--text-soft);padding:1px 4px;cursor:pointer;border-radius:4px;background:var(--bg);">+${moreCount} mais</div>`;
      html += `<div class="cal-day${isToday?' today':''}${feriadoNome?' feriado-day':''}" onclick="quickAddDate('${ds}')" title="${feriadoNome||''}"><div class="cal-num">${d}</div>${evHtml}</div>`;
    }
    const rem = (first + days) % 7;
    if (rem > 0) for (let i = 1; i <= 7-rem; i++) html += `<div class="cal-day other-month"><div class="cal-num">${i}</div></div>`;
    html += '</div>';
    const sharedLegend = GCAL_SHARED_CALS.map(cal =>
      `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:${cal.color};"></div>${cal.label}</div>`
    ).join('');
    if (filter === 'all') html += `<div class="cal-legend"><div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--editora);"></div>Editora</div><div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--leia);"></div>Léia</div><div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--gisella);"></div>GC</div><div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--gisella);opacity:0.5;border:1px solid var(--gisella);"></div>Google Cal</div>${sharedLegend}</div>`;
    el.innerHTML = html;
  }
  
  function calNav(id, dir) {
    CAL_STATE[id].m += dir;
    if (CAL_STATE[id].m > 11) { CAL_STATE[id].m = 0; CAL_STATE[id].y++; }
    if (CAL_STATE[id].m < 0) { CAL_STATE[id].m = 11; CAL_STATE[id].y--; }
    buildCalendar(id, CAL_STATE[id].filter);
    if (id === 'cal-eventos') buildEventosList();
  }
  
  function initCalendars() {
    buildCalendar('cal-visao','all');
    buildCalendar('cal-editora','editora');
    buildCalendar('cal-leia','leia');
    buildCalendar('cal-gisella','gisella');
    buildCalendar('cal-eventos','all');
    buildCalendar('cal-conteudo','all');
  }
  function refreshCalendars() { Object.keys(CAL_STATE).forEach(id => buildCalendar(id, CAL_STATE[id].filter)); }
  
  /* ── QUICK ADD ── */
  function quickAddDate(ds) { openQuickAdd(); document.getElementById('qa-prazo').value = ds; }
  
  function fmtDate(val) {
    if (!val) return '—';
    const [y,m,d] = val.split('-').map(Number);
    const ms = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((new Date(y,m-1,d) - today) / 86400000);
    if (diff === 0) return 'hoje'; if (diff === 1) return 'amanhã';
    if (diff < 0) return `${d} ${ms[m-1]}`;
    if (diff <= 7) return `${diff} dias`;
    return `${d} ${ms[m-1]}`;
  }
  
  function fmtDateTarefa(val) {
    if (!val) return '—';
    const [y,m,d] = val.split('-').map(Number);
    const ms = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((new Date(y,m-1,d) - today) / 86400000);
    if (diff === 0) return 'hoje'; if (diff === 1) return 'amanhã';
    if (diff < 0) return `${d} ${ms[m-1]} (atrasado)`;
    if (diff <= 7) return `${diff} dias`;
    return `${d} ${ms[m-1]}`;
  }
  
  function automaticTaskOwner(title, fallback = '') {
    const normalized = String(title || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
    if (normalized.includes('devolutiva')) return 'Milena';
    if (/ajustes? no sistema/.test(normalized)) return 'Luiggi';
    return fallback;
  }
  
  // Corrige também registros antigos. Assim, ao abrir o dashboard, tarefas de
  // devolutiva passam para a agenda da Milena e ajustes do sistema para Luiggi.
  function applyAutomaticTaskOwners() {
    let eventsChanged = false;
    events.forEach(event => {
      if (event.tipo !== 'tarefa') return;
      const owner = automaticTaskOwner(event.titulo, event.responsavel || '');
      if (owner !== (event.responsavel || '')) {
        event.responsavel = owner;
        eventsChanged = true;
      }
    });
    if (eventsChanged) save('gc-events', events);
  
    let booksChanged = false;
    livros.forEach(book => (book.etapas || []).forEach(stage => {
      const owner = automaticTaskOwner(stage.nome, stage.resp || '');
      if (owner !== (stage.resp || '')) {
        stage.resp = owner;
        booksChanged = true;
      }
    }));
    if (booksChanged) save('gc-livros', livros);
  
    let projectsChanged = false;
    projetos.forEach(project => (project.tarefas || []).forEach(task => {
      const owner = automaticTaskOwner(task.nome, task.resp || '');
      if (owner !== (task.resp || '')) {
        task.resp = owner;
        projectsChanged = true;
      }
    }));
    if (projectsChanged) save('gc-projetos', projetos);
  }
  
  let editingEventId = null;
  
  function openQuickAdd() {
    editingEventId = null;
    window._editingEtapa = null;
    document.getElementById('qa-modal-title').textContent = 'Adicionar item';
    const delBtnQa = document.getElementById('qa-delete-btn');
    if (delBtnQa) delBtnQa.style.display = 'none';
    document.getElementById('qa-submit-btn').textContent = 'Adicionar';
    window._addingToProjetoId = null;
    window._addingToMenteeId = null;
    document.getElementById('qa-titulo').value = '';
    document.getElementById('qa-titulo').placeholder = 'Descreva...';
    setEmpresasChecked('qa-emp-', 'editora');
    // Auto-detect tipo from current active page
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id : '';
    let defaultTipo = 'tarefa';
    if (pageId === 'page-tarefas') defaultTipo = 'tarefa';
    else if (pageId === 'page-conteudo-menu') defaultTipo = 'conteudo';
    else if (pageId === 'page-eventos') defaultTipo = 'evento';
    else if (pageId === 'page-livros') defaultTipo = 'livro';
    else if (pageId === 'page-projetos') defaultTipo = 'projeto';
    document.getElementById('qa-tipo').value = defaultTipo;
    const urgenteEl = document.getElementById('qa-urgente');
    if (urgenteEl) urgenteEl.checked = false;
    const recurrenceEl = document.getElementById('qa-recorrencia');
    if (recurrenceEl) recurrenceEl.value = 'none';
    document.querySelectorAll('.qa-recorrencia-day').forEach(day => { day.checked = false; });
    const mentoringOffset = document.getElementById('qa-mentoring-offset');
    if (mentoringOffset) mentoringOffset.value = '1';
    // Reset all fields
    ['qa-l-autor','qa-l-ilustrador','qa-l-publico','qa-l-faixa','qa-l-paginas',
     'qa-l-tiragem','qa-l-isbn','qa-l-formato','qa-l-colecao','qa-l-editora','qa-l-sinopse'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    ['editora','leia','gisella'].forEach(e => { const cb = document.getElementById('qa-l-emp-'+e); if(cb) cb.checked = false; });
    const lcb = document.getElementById('qa-l-lancamento'); if(lcb) lcb.value = '';
    ['qa-prazo','qa-evento-inicio','qa-hora-inicio','qa-data-fim','qa-hora-fim',
     'qa-proj-inicio','qa-proj-fim','qa-c-dataprod','qa-c-datapost','qa-c-hora','qa-c-link'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    ['qa-observacao','qa-observacao-evento','qa-observacao-projeto','qa-observacao-conteudo',
     'qa-c-copy','qa-c-legenda'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    ['qa-responsavel','qa-responsavel-evento','qa-responsavel-projeto','qa-responsavel-conteudo'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    // Auto-fill responsavel com o usuário logado
    const _cuKey = window._currentUser || localStorage.getItem('gc-session-user') || '';
    const _cuName = (LOGIN_USERS[_cuKey] && LOGIN_USERS[_cuKey].name) || window._currentUserName || '';
    if (_cuName) {
      ['qa-responsavel','qa-responsavel-evento','qa-responsavel-projeto','qa-responsavel-conteudo'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = _cuName;
      });
    }
    updateQaFields();
    // Esconder comentários ao criar nova tarefa
    const comWrapNew = document.getElementById('qa-comentarios-wrap');
    if (comWrapNew) comWrapNew.style.display = 'none';
    // Populate livro tipo-autoria selector (if livro tab is opened)
    const tipoAutoriaSel2 = document.getElementById('nl-tipo-autoria');
    if (tipoAutoriaSel2 && mentees && mentees.length > 0 && tipoAutoriaSel2.options.length <= 1) {
      const ms2 = [...mentees].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
      tipoAutoriaSel2.innerHTML = '<option value="">Não se aplica</option>' +
        ms2.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
    }
    openModal('modal-quickadd');
    setTimeout(() => document.getElementById('qa-titulo').focus(), 50);
  }
  
  function openEditEvent(id) {
    const ev = events.find(x => x.id === id);
    if (!ev) return;
    editingEventId = id;
    document.getElementById('qa-modal-title').textContent = 'Editar item';
    document.getElementById('qa-submit-btn').textContent = 'Salvar';
    const delBtn = document.getElementById('qa-delete-btn');
    if (delBtn) delBtn.style.display = 'inline-block';
    document.getElementById('qa-titulo').value = ev.titulo || '';
    setEmpresasChecked('qa-emp-', ev.empresa || 'editora');
    document.getElementById('qa-tipo').value = ev.tipo || 'evento';
    document.getElementById('qa-prazo').value = ev.data || '';
    document.getElementById('qa-hora-inicio').value = ev.horaInicio || '';
    document.getElementById('qa-data-fim').value = ev.dataFim || '';
    document.getElementById('qa-hora-fim').value = ev.horaFim || '';
    document.getElementById('qa-responsavel').value = ev.responsavel || '';
    document.getElementById('qa-observacao').value = ev.observacao || '';
    const urgenteEdit = document.getElementById('qa-urgente');
    if (urgenteEdit) urgenteEdit.checked = !!ev.urgente;
    const recurrenceEl = document.getElementById('qa-recorrencia');
    if (recurrenceEl) recurrenceEl.value = 'none';
    updateQaFields();
    // Mostrar e popular comentários
    const comWrap = document.getElementById('qa-comentarios-wrap');
    if (comWrap) {
      comWrap.style.display = 'block';
      renderComentariosTarefa(ev);
      document.getElementById('qa-comentario-texto').value = '';
    }
    openModal('modal-quickadd');
    setTimeout(() => document.getElementById('qa-titulo').focus(), 50);
  }
  
  /* ── COMENTÁRIOS DE TAREFA ── */
  function renderComentariosTarefa(ev) {
    const lista = document.getElementById('qa-comentarios-lista');
    if (!lista) return;
    const comentarios = ev.comentarios || [];
    if (comentarios.length === 0) {
      lista.innerHTML = '<div style="font-size:12px;color:var(--text-soft);text-align:center;padding:8px 0;">Nenhum comentário ainda.</div>';
      return;
    }
    const cores = { Gisella: 'var(--gisella)', Milena: 'var(--leia)', Luiggi: 'var(--editora)' };
    lista.innerHTML = comentarios.map((c, i) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:600;color:${cores[c.autor]||'var(--text-mid)'};">${c.autor}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--text-soft);">${c.data}</span>
            <button onclick="deleteComentarioTarefa(${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0;line-height:1;" title="Excluir">x</button>
          </div>
        </div>
        <div style="font-size:13px;color:var(--text);white-space:pre-wrap;line-height:1.5;">${c.texto}</div>
      </div>`).join('');
    lista.scrollTop = lista.scrollHeight;
  }
  
  function addComentarioTarefa() {
    if (!editingEventId) return;
    const ev = events.find(x => x.id === editingEventId);
    if (!ev) return;
    const texto = (document.getElementById('qa-comentario-texto').value || '').trim();
    if (!texto) { document.getElementById('qa-comentario-texto').focus(); return; }
    const autor = document.getElementById('qa-comentario-autor').value || 'Gisella';
    const agora = new Date();
    const data = agora.getDate().toString().padStart(2,'0') + '/' + (agora.getMonth()+1).toString().padStart(2,'0') + ' ' + agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
    if (!ev.comentarios) ev.comentarios = [];
    ev.comentarios.push({ autor, texto, data });
    save('gc-events', events);
    document.getElementById('qa-comentario-texto').value = '';
    renderComentariosTarefa(ev);
  }
  
  function deleteComentarioTarefa(idx) {
    if (!editingEventId) return;
    const ev = events.find(x => x.id === editingEventId);
    if (!ev || !ev.comentarios) return;
    ev.comentarios.splice(idx, 1);
    save('gc-events', events);
    renderComentariosTarefa(ev);
  }
  
  let recurringDeleteEventId = null;

  function deleteEventDirect(id) {
    const ev = events.find(x => x.id === id);
    if (!ev) return;
    if (ev.recurrenceTemplateId || ev.recurKey) {
      recurringDeleteEventId = id;
      openModal('modal-excluir-recorrencia');
      return;
    }
    deleteEventNow(id);
  }

  function cancelRecurringDeletion() {
    recurringDeleteEventId = null;
    closeModal('modal-excluir-recorrencia');
  }

  function deleteOnlyRecurringOccurrence() {
    const ev = events.find(x => x.id === recurringDeleteEventId);
    if (!ev) return cancelRecurringDeletion();
    const template = recurringTasks.find(item => item.id === ev.recurrenceTemplateId);
    if (template && ev.recurrenceKey) {
      template.excludedOccurrenceKeys = [...new Set([...(template.excludedOccurrenceKeys || []), ev.recurrenceKey])];
      save('gc-recurring-tasks', recurringTasks);
    } else if (ev.recurKey) {
      const exclusions = getLegacyRecurringSet('gc-legacy-recur-exclusions');
      exclusions.add(`${ev.recurKey}:${ev.data}`);
      saveLegacyRecurringSet('gc-legacy-recur-exclusions', exclusions);
    }
    cancelRecurringDeletion();
    deleteEventNow(ev.id);
  }

  function deleteAllRecurringOccurrences() {
    const ev = events.find(x => x.id === recurringDeleteEventId);
    if (!ev) return cancelRecurringDeletion();
    if (!ev.recurrenceTemplateId && ev.recurKey) {
      const disabled = getLegacyRecurringSet('gc-legacy-recur-disabled');
      disabled.add(ev.recurKey);
      saveLegacyRecurringSet('gc-legacy-recur-disabled', disabled);
      const removedEvents = events.filter(item => item.recurKey === ev.recurKey);
      events = events.filter(item => item.recurKey !== ev.recurKey);
      cancelRecurringDeletion();
      save('gc-events', events);
      refreshCalendars(); buildCalendar('cal-eventos', 'all');
      buildTarefas(); buildColabTarefas(); buildPrioridades();
      pushUndo(ev.titulo || 'Tarefas recorrentes', () => {
        disabled.delete(ev.recurKey);
        saveLegacyRecurringSet('gc-legacy-recur-disabled', disabled);
        events = [...events, ...removedEvents];
        save('gc-events', events);
        buildTarefas(); buildColabTarefas(); buildPrioridades();
      });
      return;
    }
    const templateId = ev.recurrenceTemplateId;
    const removedTemplate = recurringTasks.find(item => item.id === templateId);
    const removedEvents = events.filter(item => item.recurrenceTemplateId === templateId);
    recurringTasks = recurringTasks.filter(item => item.id !== templateId);
    events = events.filter(item => item.recurrenceTemplateId !== templateId);
    cancelRecurringDeletion();
    save('gc-recurring-tasks', recurringTasks);
    save('gc-events', events);
    refreshCalendars(); buildCalendar('cal-eventos', 'all');
    buildTarefas(); buildColabTarefas(); buildPrioridades(); renderProjetos();
    pushUndo(ev.titulo || 'Tarefas recorrentes', () => {
      if (removedTemplate) recurringTasks.push(removedTemplate);
      events = [...events, ...removedEvents];
      save('gc-recurring-tasks', recurringTasks);
      save('gc-events', events);
      buildTarefas(); buildColabTarefas(); buildPrioridades();
    });
  }

  function deleteEventNow(id) {
    const ev = events.find(x => x.id === id);
    if (!ev) return;
    const snapEv = [...events];
    const snapPr = projetos.map(p => ({...p, tarefas: [...(p.tarefas||[])]}));
    const snapMentees = mentees.map(m => ({...m, tasks: [...(m.tasks||[])]}));
  
    // If this is a gcal auto-task, blacklist its key so it's never recreated
    if (ev.gcalKey) addToGcalBlacklist(ev.gcalKey);
  
    // Remove from mentee tasks
    mentees.forEach(m => {
      if (m.tasks) m.tasks = m.tasks.filter(t => t.id !== id.toString());
    });
    events = events.filter(x => x.id !== id);
    projetos.forEach(p => { if (p.tarefas) p.tarefas = p.tarefas.filter(t => t.eventId !== id); });
  
    // Salvar localmente imediatamente — localStorage é a fonte da verdade
    localStorage.setItem('gc-events',   JSON.stringify(events));
    localStorage.setItem('gc-projetos', JSON.stringify(projetos));
    localStorage.setItem('gc-mentees',  JSON.stringify(mentees));
    localStorage.setItem('gc-mentees-marco0', JSON.stringify(menteesMarco0));
    _lastLocalSave['gc-events'] = _lastLocalSave['gc-projetos'] = _lastLocalSave['gc-mentees'] = Date.now();
  
    // Atualizar UI imediatamente
    buildTarefas(); buildColabTarefas(); renderProjetos(); buildHomeCards(); buildPrioridades();
    ['editora','leia','gisella'].forEach(emp => { if (document.getElementById('tarefas-empresa-'+emp)) buildTarefasEmpresa(emp); });
  
    // Undo disponível imediatamente
    pushUndo(ev.titulo || 'Tarefa', () => {
      events = snapEv; projetos = snapPr; mentees = snapMentees;
      localStorage.setItem('gc-events',   JSON.stringify(events));
      localStorage.setItem('gc-projetos', JSON.stringify(projetos));
      localStorage.setItem('gc-mentees',  JSON.stringify(mentees));
      if (window.fbSave) {
        window.fbSave('gc-events',   events);
        window.fbSave('gc-projetos', projetos);
        window.fbSave('gc-mentees',  mentees);
      }
      buildTarefas(); buildColabTarefas(); renderProjetos(); buildHomeCards();
      ['editora','leia','gisella'].forEach(emp => { if (document.getElementById('tarefas-empresa-'+emp)) buildTarefasEmpresa(emp); });
    });
  
    // Firebase em background — quando confirmar, atualiza _fbts_ com o ts real
    if (window.fbSave) {
      Promise.all([
        window.fbSave('gc-events',   events),
        window.fbSave('gc-projetos', projetos),
        window.fbSave('gc-mentees',  mentees),
      ]).catch(e => console.warn('fbSave delete error:', e));
      // fbSave já atualiza _fbts_ após confirmar — nada mais necessário
    }
  }
  
  function deleteCurrentEvent() {
    if (!editingEventId) return;
    const id = editingEventId;
    closeModal('modal-quickadd');
    editingEventId = null;
    deleteEventDirect(id);
  }
  
  function getQaVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  
  async function submitQuickAdd() {
    const empresa = getEmpresaStr('qa-emp-', 'editora');
    const tipo = getQaVal('qa-tipo');
    const titulo = getQaVal('qa-titulo').trim();
    if (!titulo) { document.getElementById('qa-titulo').focus(); return; }
  
    // Se estamos editando uma etapa de livro
    if (window._editingEtapa) {
      const {livroId, idx} = window._editingEtapa;
      const l = livros.find(x => x.id === livroId);
      if (l && l.etapas[idx]) {
        const previousPrazo = l.etapas[idx].prazo || '';
        const nextPrazo = getQaVal('qa-prazo');
        l.etapas[idx].nome = titulo;
        l.etapas[idx].resp = getQaVal('qa-responsavel');
        if (previousPrazo !== nextPrazo) await updateEtapaPrazoInline(livroId, idx, nextPrazo);
        else {
          save('gc-livros', livros);
          renderLivros();
          buildTarefas();
        }
        buildColabTarefas();
      }
      window._editingEtapa = null;
      closeModal('modal-quickadd');
      return;
    }
  
    if (tipo === 'projeto') {
      const proj = {
        id: Date.now(), tarefas: [], expandido: true, nome: titulo, empresa,
        status: getQaVal('qa-proj-status')||'pendente',
        responsavel: getQaVal('qa-responsavel-projeto'),
        inicio: getQaVal('qa-proj-inicio'), fim: getQaVal('qa-proj-fim'),
        observacao: getQaVal('qa-observacao-projeto'),
      };
      if (editingEventId) {
        const i = projetos.findIndex(x => x.id === editingEventId);
        if (i > -1) projetos[i] = {...projetos[i], ...proj};
        editingEventId = null;
      } else { projetos.push(proj); }
      save('gc-projetos', projetos); renderProjetos();
      closeModal('modal-quickadd'); return;
    }
  
    if (tipo === 'livro') {
      const emps = ['editora','leia','gisella'].filter(e => {
        const cb = document.getElementById('qa-l-emp-'+e); return cb && cb.checked;
      });
      const empresaStr = emps.length > 0 ? emps.join(',') : getQaVal('qa-empresa');
      const tipopubEl = document.querySelector('input[name="qa-l-tipopub"]:checked');
      const tipopub = tipopubEl ? tipopubEl.value : 'lancamento';
      const etapasUsar = tipopub === 'reimpressao' ? ETAPAS_REIMP : ETAPAS_DEFAULT;
      const lancamentoDate = getQaVal('qa-l-lancamento');
      const livro = {
        id: Date.now(), titulo, empresa: empresaStr, expandido: true, tipopub,
        info: {
          autor: getQaVal('qa-l-autor'), ilustrador: getQaVal('qa-l-ilustrador'),
          publico: getQaVal('qa-l-publico'), faixa: getQaVal('qa-l-faixa'),
          paginas: getQaVal('qa-l-paginas'), tiragem: getQaVal('qa-l-tiragem'),
          isbn: getQaVal('qa-l-isbn'), formato: getQaVal('qa-l-formato'),
          colecao: getQaVal('qa-l-colecao'), editora: getQaVal('qa-l-editora'),
          lancamento: lancamentoDate, sinopse: getQaVal('qa-l-sinopse'),
          os: getQaVal('qa-l-os'), ano: getQaVal('qa-l-ano'),
        },
        etapas: etapasUsar.map(nome => ({nome, feito: false, prazo: ''}))
      };
      livros.push(livro);
      // Auto-criar evento de lançamento
      if (lancamentoDate) {
        const primeiraEmp = empresaStr.split(',')[0] || 'editora';
        events.push({
          id: Date.now() + 1,
          empresa: primeiraEmp,
          titulo: 'Lançamento ' + titulo,
          tipo: 'evento',
          data: lancamentoDate,
          dataFim: lancamentoDate,
          observacao: 'Criado automaticamente ao cadastrar livro',
        });
        save('gc-events', events);
        refreshCalendars();
      }
      save('gc-livros', livros);
      renderLivros();
      buildPrioridades();
      closeModal('modal-quickadd');
      return;
    }
  
    if (tipo === 'conteudo') {
      const c = {
        id: Date.now(), done: false, nome: titulo, empresa,
        rede: getQaVal('qa-c-rede'), tipo: getQaVal('qa-c-tipo'),
        status: getQaVal('qa-c-status'), responsavel: getQaVal('qa-responsavel-conteudo'),
        dataProd: getQaVal('qa-c-dataprod'), dataPost: getQaVal('qa-c-datapost'),
        hora: getQaVal('qa-c-hora'), link: getQaVal('qa-c-link'), copy: getQaVal('qa-c-copy'),
        legenda: getQaVal('qa-c-legenda'), observacao: getQaVal('qa-observacao-conteudo'),
      };
      if (editingEventId) {
        const i = conteudos.findIndex(x => x.id === editingEventId);
        if (i > -1) conteudos[i] = {...conteudos[i], ...c};
        editingEventId = null;
      } else {
        c.etapasStatus = prazosIniciaisDoConteudo(c.rede, c.dataPost, c.empresa);
        conteudos.push(c);
      }
      save('gc-conteudos', conteudos); renderConteudos();
      refreshCalendars();
      buildConteudoCalSemana();
      buildCalendar('cal-conteudo', 'all');
      buildVisaoConteudos();
      buildTarefas();
      buildColabTarefas();
      buildPrioridades();
      closeModal('modal-quickadd'); return;
    }
  
    const selectedResponsavel = tipo === 'evento' ? getQaVal('qa-responsavel-evento') : getQaVal('qa-responsavel');
    const responsavel = tipo === 'tarefa' ? automaticTaskOwner(titulo, selectedResponsavel) : selectedResponsavel;
    const observacao = tipo === 'evento' ? getQaVal('qa-observacao-evento') : getQaVal('qa-observacao');
    const urgenteVal = document.getElementById('qa-urgente') ? document.getElementById('qa-urgente').checked : false;
    const recurrenceKind = tipo === 'tarefa' ? (getQaVal('qa-recorrencia') || 'none') : 'none';
    if (!editingEventId && recurrenceKind !== 'none') {
      const weekdays = [...document.querySelectorAll('.qa-recorrencia-day:checked')].map(day => Number(day.value));
      const anchorDate = getQaVal('qa-prazo');
      if (recurrenceKind === 'interval15' && !anchorDate) {
        alert('Informe a primeira data para repetir esta tarefa a cada 15 dias.');
        return;
      }
      if (recurrenceKind === 'weekdays' && weekdays.length === 0) {
        alert('Selecione pelo menos um dia da semana.');
        return;
      }
      recurringTasks.push({
        id: `rec-${Date.now()}`,
        titulo, empresa, responsavel, observacao, urgente: urgenteVal,
        kind: recurrenceKind, anchorDate, weekdays,
        mentoringOffset: Number(getQaVal('qa-mentoring-offset') || 1),
      });
      save('gc-recurring-tasks', recurringTasks);
      ensureCustomRecurringTasks(window.gcalEventsCache || []);
      closeModal('modal-quickadd');
      return;
    }
    const eventData = {
      empresa, titulo, tipo,
      data: tipo === 'tarefa' ? getQaVal('qa-prazo') : getQaVal('qa-evento-inicio'),
      horaInicio: getQaVal('qa-hora-inicio'),
      dataFim: getQaVal('qa-data-fim'), horaFim: getQaVal('qa-hora-fim'),
      responsavel, observacao,
      urgente: tipo === 'tarefa' ? urgenteVal : undefined,
    };
  
    if (editingEventId) {
      const i = events.findIndex(x => x.id === editingEventId);
      if (i > -1) events[i] = {...events[i], ...eventData};
      editingEventId = null;
    } else {
      const newEv = { id: Date.now(), ...eventData };
      events.push(newEv);
      if (tipo === 'tarefa' && window._addingToProjetoId) {
        const p = projetos.find(x => x.id === window._addingToProjetoId);
        if (p) {
          if (!p.tarefas) p.tarefas = [];
          p.tarefas.push({nome: titulo, feito: false, resp: responsavel, eventId: newEv.id});
          newEv.projetoId = window._addingToProjetoId;
          save('gc-projetos', projetos);
          save('gc-events', events);
          buildTarefas();
          buildColabTarefas();
          buildPrioridades();
          renderProjetos();
          closeModal('modal-quickadd');
          window._addingToProjetoId = null;
          window._addingToMenteeId = null;
          return;
        }
      }
      if (tipo === 'tarefa' && window._addingToMenteeId) {
        const prog = window._addingToMenteeProgram || 'planodiretor';
        const arr  = prog === 'marco0' ? menteesMarco0 : mentees;
        const m    = arr.find(x => x.id === window._addingToMenteeId);
        if (m) {
          if (!m.tasks) m.tasks = [];
          m.tasks.push({id: newEv.id.toString(), titulo, done: false,
            resp: newEv.responsavel || '', prazo: newEv.data || ''});
          newEv.menteeId = window._addingToMenteeId;
          save('gc-events', events);
          if (prog === 'marco0') save('gc-mentees-marco0', menteesMarco0);
          else save('gc-mentees', mentees);
          buildTarefas(); buildColabTarefas(); buildPrioridades();
          renderMenteeList(); renderMarco0List();
          window._addingToMenteeId = null;
          window._addingToMenteeProgram = null;
          window._addingToProjetoId = null;
          closeModal('modal-quickadd');
          return;
        }
      }
    } // end else (new event)
    window._addingToProjetoId = null;
    window._addingToMenteeId = null;
  
    save('gc-events', events);
    refreshCalendars();
    buildCalendar('cal-eventos', 'all');
    buildTarefas();
    buildColabTarefas();
    buildPrioridades();
    // Notify if task assigned to someone
    if (tipo === 'tarefa' && !editingEventId) {
      const resp = automaticTaskOwner(getQaVal('qa-titulo').trim(), getQaVal('qa-responsavel'));
      if (resp) notifyTaskAssigned(getQaVal('qa-titulo').trim(), resp);
    }
    // Se for edição de tarefa vinculada a projeto, sincronizar nome e responsável
    if (editingEventId && tipo === 'tarefa') {
      projetos.forEach(p => {
        (p.tarefas||[]).forEach(t => {
          if (t.eventId === editingEventId) {
            t.nome = titulo;
            t.resp = responsavel;
            t.feito = !!(events.find(x=>x.id===editingEventId)||{}).arquivada;
          }
        });
      });
      save('gc-projetos', projetos);
      renderProjetos();
    } else {
      renderProjetos();
    }
    editingEventId = null;
    closeModal('modal-quickadd');
  }
  
  
  /* ── LIVROS ── */
  let addLivroEmpresa = 'editora';
  let editingLivroId = null;
  const CRONOGRAMA_EDITORIAL = [
    ['Briefing', -110, 'Gisella'],
    ['Escolha do ilustrador', -103, 'Gisella'],
    ['Texto em andamento', -98, 'Gisella'],
    ['Reunião de alinhamento de conceito', -94, 'Gisella'],
    ['Pré-diagramação', -92, 'Gisella'],
    ['Texto preparado', -88, 'Gisella'],
    ['Esboços', -74, 'Gisella'],
    ['Texto finalizado', -68, 'Gisella'],
    ['Estado da arte — coloração', -63, 'Gisella'],
    ['Finalização das ilustrações', -38, 'Gisella'],
    ['ISBN + Código de barras + Ficha catalográfica', -36, 'Gisella'],
    ['Diagramação final', -34, 'Gisella'],
    ['UV', -33, 'Gisella'],
    ['Envio para gráfica (boneco)', -32, 'Gisella'],
    ['Plano de divulgação e lançamento', -30, 'Milena'],
    ['Receber boneco', -29, 'Gisella'],
    ['Revisar boneco', -27, 'Gisella'],
    ['Aplicar revisão final', -25, 'Gisella'],
    ['Ajuste fino', -24, 'Gisella'],
    ['Reenviar para gráfica', -23, 'Gisella'],
    ['Enviar contrato para assinatura', -22, 'Gisella'],
    ['Aprovar para impressão', -20, 'Gisella'],
    ['Fazer marca-página', -18, 'Milena'],
    ['Enviar marca-página para gráfica', -16, 'Milena'],
    ['Receber o estoque', -5, 'Milena'],
    ['Receber o marca-página', -5, 'Milena'],
    ['Cadastrar no sistema', -5, 'Milena'],
    ['Lançamento', 0, ''],
    ['Liberar no site', 1, 'Milena'],
    ['Post avisando sobre o novo livro', 1, 'Milena'],
  ];

  function parseDashboardDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
  }
  function dashboardDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function addCalendarDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + Number(days || 0));
    return next;
  }
  function moveToNextWeekday(date) {
    const next = new Date(date);
    if (next.getDay() === 6) next.setDate(next.getDate() + 2);
    if (next.getDay() === 0) next.setDate(next.getDate() + 1);
    return next;
  }
  function nextAvailableEditorialDate(candidate, previousDate, occupied) {
    let next = moveToNextWeekday(candidate);
    if (previousDate && next <= previousDate) next = moveToNextWeekday(addCalendarDays(previousDate, 1));
    while (occupied.has(dashboardDateString(next))) next = moveToNextWeekday(addCalendarDays(next, 1));
    return next;
  }
  function criarCronogramaEditorial(lancamentoDate) {
    const lancamento = parseDashboardDate(lancamentoDate);
    if (!lancamento) return [];
    const occupied = new Set();
    let previousDate = null;
    return CRONOGRAMA_EDITORIAL.map(([nome, offsetDays, resp]) => {
      const prazoDate = nextAvailableEditorialDate(addCalendarDays(lancamento, offsetDays), previousDate, occupied);
      const prazo = dashboardDateString(prazoDate);
      occupied.add(prazo);
      previousDate = prazoDate;
      return { nome, feito: false, prazo, resp, offsetDays };
    });
  }
  function openAddLivroTodos() {
    openAddLivro('editora');
  }
  
  function openAddLivro(emp) {
    addLivroEmpresa = emp;
    editingLivroId = null;
    document.querySelector('#modal-livro .modal-title').textContent = 'Novo livro · Ficha Técnica';
    document.querySelector('#modal-livro .btn-primary').textContent = 'Criar livro';
    ['nl-titulo','nl-autor','nl-ilustrador','nl-publico','nl-faixa','nl-paginas','nl-tiragem','nl-valor','nl-isbn','nl-formato','nl-colecao','nl-editora','nl-sinopse','nl-os','nl-ano','nl-lancamento'].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });
    ['editora','leia','gisella'].forEach(e => {
      const cb = document.getElementById('nl-emp-'+e);
      if (cb) cb.checked = (e === emp);
    });
    // Populate tipo de autoria
    const tas = document.getElementById('nl-tipo-autoria');
    if (tas) {
      const ms = [...(mentees||[])].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
      tas.innerHTML = '<option value="">Não se aplica</option>' + ms.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
      tas.value = '';
    }
    openModal('modal-livro');
    setTimeout(() => document.getElementById('nl-titulo').focus(), 50);
  }
  
  
  function submitAddLivro() {
    const titulo = document.getElementById('nl-titulo').value.trim();
    if (!titulo) { document.getElementById('nl-titulo').focus(); return; }
    const autor = document.getElementById('nl-autor').value.trim();
    const ano = document.getElementById('nl-ano')?.value.trim() || '';
    const lancamentoDate = document.getElementById('nl-lancamento').value;
    if (!autor) { document.getElementById('nl-autor').focus(); return; }
    if (!ano) { document.getElementById('nl-ano').focus(); return; }
    if (!lancamentoDate) { document.getElementById('nl-lancamento').focus(); return; }
    // Get selected empresas from checkboxes (or fall back to addLivroEmpresa)
    const checkboxes = ['editora','leia','gisella'].filter(e => {
      const cb = document.getElementById('nl-emp-'+e);
      return cb && cb.checked;
    });
    const empresas = checkboxes.length > 0 ? checkboxes : [addLivroEmpresa || 'editora'];
    const empresaStr = empresas.join(',');
    const tipopub = document.querySelector('input[name="nl-tipopub"]:checked')?.value || 'lancamento';
    const menteeOpt = document.querySelector('input[name="nl-mentee-opt"]:checked')?.value;
    const menteeIdSel = menteeOpt === 'sim' ? parseInt(document.getElementById('nl-mentee-id')?.value||'0')||null : null;
    const tipoAutoriaVal = document.getElementById('nl-tipo-autoria')?.value || '';
    const tipoAutoriaMenteeId = tipoAutoriaVal ? parseInt(tipoAutoriaVal)||null : null;
    const livro = {
      id: editingLivroId || 0, titulo, empresa: empresaStr, expandido: true,
      tipopub, menteeId: menteeIdSel, tipoAutoriaMenteeId: tipoAutoriaMenteeId,
      info: {
        autor,
        ilustrador: document.getElementById('nl-ilustrador').value.trim(),
        publico: document.getElementById('nl-publico').value.trim(),
        faixa: document.getElementById('nl-faixa').value.trim(),
        paginas: document.getElementById('nl-paginas').value.trim(),
        tiragem: document.getElementById('nl-tiragem').value.trim(),
        valor: document.getElementById('nl-valor').value.trim(),
        isbn: document.getElementById('nl-isbn').value.trim(),
        formato: document.getElementById('nl-formato').value.trim(),
        colecao: document.getElementById('nl-colecao').value.trim(),
        editora: document.getElementById('nl-editora').value.trim(),
        lancamento: lancamentoDate,
        sinopse: document.getElementById('nl-sinopse').value.trim(),
        os: document.getElementById('nl-os')?.value.trim()||'',
        ano,
      },
      etapas: editingLivroId ? (livros.find(x=>x.id===editingLivroId)||{etapas:[]}).etapas : criarCronogramaEditorial(lancamentoDate)
    };
    const _wasEditing = !!editingLivroId;
    let _newLivroId = null;
    if (editingLivroId) {
      const i = livros.findIndex(x=>x.id===editingLivroId);
      if (i>-1) {
        const livroExistente = livros[i];
        const lancamentoAnterior = livroExistente.info?.lancamento || '';
        if (lancamentoAnterior !== lancamentoDate) {
          const conclusaoPorNome = new Map((livroExistente.etapas || []).map(etapa => [etapa.nome, !!etapa.feito]));
          livroExistente.etapas = criarCronogramaEditorial(lancamentoDate).map(etapa => ({
            ...etapa,
            feito: conclusaoPorNome.get(etapa.nome) || false,
          }));
        }
        livroExistente.titulo = livro.titulo;
        livroExistente.empresa = livro.empresa;
        livroExistente.info = livro.info;
        livroExistente.tipopub = tipopub;
        livroExistente.tipoAutoriaMenteeId = tipoAutoriaMenteeId;
      }
      editingLivroId = null;
    } else {
      livro.id = Date.now();
      _newLivroId = livro.id;
      livros.push(livro);
      console.log('Novo livro criado, id:', livro.id, '_newLivroId:', _newLivroId);
    }
    save('gc-livros', livros);
    renderLivros();
    buildPrioridades();
    closeModal('modal-livro');
    if (_newLivroId) setTimeout(() => openEtapasPrazos(_newLivroId), 800);
    // Reset modal
    document.querySelector('#modal-livro .modal-title').textContent = 'Novo livro · Ficha Técnica';
    document.querySelector('#modal-livro .btn-primary').textContent = 'Criar livro';
    ['nl-titulo','nl-autor','nl-ilustrador','nl-publico','nl-faixa','nl-paginas','nl-tiragem','nl-valor','nl-isbn','nl-formato','nl-colecao','nl-editora','nl-sinopse','nl-os','nl-ano'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('nl-lancamento').value = '';
    const lancRad = document.getElementById('nl-tipopub-lanc'); if(lancRad) lancRad.checked=true;
    const naoRad = document.querySelector('input[name="nl-mentee-opt"][value="nao"]'); if(naoRad) naoRad.checked=true;
    const menteeWrap = document.getElementById('nl-mentee-wrap'); if(menteeWrap) menteeWrap.style.display='none';
    // Populate tipo-autoria with mentees
    const tipoAutoriaSel = document.getElementById('nl-tipo-autoria');
    if (tipoAutoriaSel) {
      const ms = [...(mentees||[])].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
      tipoAutoriaSel.innerHTML = '<option value="">Não se aplica</option>' +
        ms.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
      tipoAutoriaSel.value = '';
    }
  }
  
  const EMP_BADGE_L = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
  const EMP_SHORT_L = {editora:'Editora',leia:'Léia',gisella:'GC'};
  
  function renderLivroEtapas(l) {
    const sorted = l.etapas.map((e,i)=>({e,i})).sort((a,b)=> a.e.feito===b.e.feito?0:a.e.feito?-1:1);
    const today2 = new Date(); today2.setHours(0,0,0,0);
    return sorted.map(({e,i}) => {
      const prazoColor = e.prazo && !e.feito ? (() => {
        const diff = Math.round((new Date(e.prazo+'T00:00:00')-today2)/86400000);
        return diff<0?'var(--danger)':diff===0?'var(--gisella)':diff<=7?'var(--warn)':'var(--text-soft)';
      })() : 'var(--text-soft)';
      return '<div class="livro-etapa-row" style="'+(e.feito?'opacity:0.6;':'')+'">' +
        '<input type="checkbox" '+(e.feito?'checked':'')+' onchange="toggleEtapa('+l.id+','+i+')" onclick="event.stopPropagation()">' +
        '<span class="livro-etapa-nome'+(e.feito?' done':'')+'" style="flex:1;">['+l.titulo+'] '+e.nome+'</span>' +
        '<span style="font-size:11px;color:'+(prazoColor||'var(--text-soft)')+';font-weight:'+(e.prazo?'500':'400')+';">'+(e.prazo?fmtDate(e.prazo):'—')+'</span>' +
        '<select onchange="setEtapaResp('+l.id+','+i+',this.value)" onclick="event.stopPropagation()" '+
          'style="font-size:10px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:'+(e.resp?'#000':'var(--text-soft)')+';cursor:pointer;max-width:80px;">' +
          '<option value="" '+((!e.resp)?'selected':'')+'>—</option>' +
          '<option value="Gisella" '+(e.resp==='Gisella'?'selected':'')+'>Gisella</option>' +
          '<option value="Milena" '+(e.resp==='Milena'?'selected':'')+'>Milena</option>' +
          '<option value="Luiggi" '+(e.resp==='Luiggi'?'selected':'')+'>Luiggi</option>' +
        '</select>' +
      '</div>';
    }).join('');
  }
  
  function livroCardHtml(l, draggable) {
    const done = l.etapas.filter(e => e.feito).length;
    const pct = Math.round(done / l.etapas.length * 100);
    const proxima = l.etapas.find(e => !e.feito);
    const emps = (l.empresa||'editora').split(',');
    const empBadges = emps.map(e => `<span class="badge ${EMP_BADGE_L[e]||'b-gray'}" style="font-size:10px;">${EMP_SHORT_L[e]||e}</span>`).join(' ');
    const dragAttrs = draggable ? `draggable="true" ondragstart="livrosDragStart(event,${l.id})" ondragover="livrosDragOver(event,${l.id})" ondrop="livrosDrop(event,${l.id})"` : '';
    return `<div class="livro-card" ${dragAttrs} onclick="toggleLivro(${l.id})" style="cursor:pointer;">
      <div class="livro-header">
        ${draggable ? '<span onclick="event.stopPropagation()" style="cursor:grab;color:var(--text-soft);font-size:14px;padding-right:4px;" title="Arrastar para reordenar">⠿</span>' : ''}
        <div class="livro-titulo" onclick="event.stopPropagation();openLivroFicha(${l.id})" style="cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-mid);" title="Abrir ficha técnica">${l.titulo}</div>
        ${empBadges}
        <div class="livro-progress-wrap">
          <div class="livro-progress"><div class="livro-progress-fill" style="width:${pct}%;"></div></div>
          <span style="font-size:11px;color:var(--text-soft);">${pct}%</span>
        </div>
        ${proxima ? `<span style="font-size:11px;color:var(--text-soft);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${proxima.nome}</span>` : '<span class="badge b-ok" style="font-size:10px;">concluído</span>'}
        <button onclick="event.stopPropagation();openEtapasPrazos(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:2px 6px;" title="Definir prazos das etapas">📅</button>
        <button onclick="event.stopPropagation();openLivroFicha(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 6px;" title="Editar ficha">✎</button>
        <button onclick="event.stopPropagation();duplicarLivro(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 6px;" title="Duplicar">⧉</button>
        <button onclick="event.stopPropagation();deleteLivro(${l.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:2px 6px;" title="Excluir">×</button>
        <span class="livro-toggle" onclick="event.stopPropagation();toggleLivro(${l.id})">${l.expandido ? '▾' : '▸'}</span>
      </div>
      <div class="livro-body${l.expandido?' open':''}">
        ${l.info ? `<div style="padding:8px 0 4px;display:flex;flex-wrap:wrap;gap:6px;">${l.info.autor?`<span class="badge b-gray">Autor: ${l.info.autor}</span>`:''}${l.info.valor?`<span class="badge b-ok">Valor: ${l.info.valor}</span>`:''}${l.info.lancamento?`<span class="badge b-info">Lançamento: ${fmtDate(l.info.lancamento)}</span>`:''}${l.tipopub?`<span class="badge ${l.tipopub==='reimpressao'?'b-warn':'b-editora'}">${l.tipopub==='reimpressao'?'Reimpressão':'Lançamento'}</span>`:''}${l.info.os?`<span class="badge b-gray">OS: ${l.info.os}</span>`:''}${l.info.ano?`<span class="badge b-gray">Ano: ${l.info.ano}</span>`:''}</div>` : ''}
        ${renderLivroEtapas(l)}
        <button class="add-btn" style="margin-top:8px;font-size:12px;" onclick="adicionarEtapa(${l.id})">+ etapa</button>
      </div>
    </div>`;
  }
  
  function renderLivros() {
    const _lf = getFilter('livros');
    let livrosFiltrados = _lf==='all' ? livros : livros.filter(l=>(l.empresa||'').split(',').includes(_lf));
  
    // Separar ativos (< 100%) e arquivados (100%)
    function isPct100(l) {
      if (!l.etapas || l.etapas.length === 0) return false;
      return l.etapas.every(e => e.feito);
    }
    const ativos = livros.filter(l => !isPct100(l));
    const arquivados100 = livros.filter(l => isPct100(l));
    const ativosFilt = livrosFiltrados.filter(l => !isPct100(l));
    const arqFilt = livrosFiltrados.filter(l => isPct100(l));
  
    // Render visao geral
    const visaoLivrosEl = document.getElementById('livros-visao');
    if (visaoLivrosEl) {
      visaoLivrosEl.innerHTML = ativosFilt.length===0
        ? '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum livro em produção.</div>'
        : ativosFilt.map(l => livroCardHtml(l, true)).join('');
    }
    // Arquivados da visão geral
    const visaoArqEl = document.getElementById('livros-visao-arquivados');
    const visaoArqBtn = document.getElementById('livros-visao-arq-btn');
    const visaoArqCnt = document.getElementById('livros-visao-arq-count');
    if (visaoArqEl) visaoArqEl.innerHTML = arqFilt.map(l => livroCardHtml(l, true)).join('');
    if (visaoArqBtn) visaoArqBtn.style.display = arqFilt.length > 0 ? 'flex' : 'none';
    if (visaoArqCnt) visaoArqCnt.textContent = arqFilt.length;
  
    // Render unified todos page
    const todosEl = document.getElementById('livros-todos');
    if (todosEl) {
      todosEl.innerHTML = ativosFilt.length===0
        ? '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum livro em produção. Use "+ novo livro" para adicionar.</div>'
        : ativosFilt.map(l => livroCardHtml(l, true)).join('');
    }
    // Arquivados 100% na página livros
    const arqListEl = document.getElementById('livros-arquivados-list');
    const arqBtn = document.getElementById('livros-arq-btn');
    const arqCnt = document.getElementById('livros-arq-count');
    if (arqListEl) arqListEl.innerHTML = arqFilt.map(l => livroCardHtml(l, true)).join('');
    if (arqBtn) arqBtn.style.display = arqFilt.length > 0 ? 'flex' : 'none';
    if (arqCnt) arqCnt.textContent = arqFilt.length;
  
    ['editora','leia','gisella'].forEach(emp => {
      const el = document.getElementById('livros-' + emp);
      if (!el) return;
      const lista = livros.filter(l => (l.empresa||'').split(',').includes(emp));
      const ativos = lista.filter(l => !isPct100(l));
      const arq    = lista.filter(l => isPct100(l));
      if (ativos.length === 0 && arq.length === 0) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum livro em produção. Use "+ novo livro" para adicionar.</div>';
        return;
      }
      let out = ativos.map(l => livroCardHtml(l, true)).join('');
      if (arq.length > 0) {
        out += `<button class="archived-toggle" onclick="toggleArqEmpresa('${emp}')" style="margin-top:8px;"><span id="arq-emp-arrow-${emp}">▸</span> Arquivados (${arq.length})</button>
        <div id="arq-emp-${emp}" style="display:none;margin-top:8px;">${arq.map(l => livroCardHtml(l, true)).join('')}</div>`;
      }
      el.innerHTML = out;
    });
  
    buildLivrosCalSemana();
  }
  
  function toggleArqEmpresa(emp) {
    const el = document.getElementById('arq-emp-' + emp);
    const arrow = document.getElementById('arq-emp-arrow-' + emp);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▾' : '▸';
  }
  
  function toggleLivro(id) { const l = livros.find(x => x.id===id); if(l) { l.expandido=!l.expandido; save('gc-livros',livros); renderLivros(); } }
  
  function openLivroFicha(id) {
    const l = livros.find(x=>x.id===id);
    if (!l) return;
    editingLivroId = id;
    addLivroEmpresa = (l.empresa||'editora').split(',')[0];
    const emps = (l.empresa||'editora').split(',');
    ['editora','leia','gisella'].forEach(e => {
      const cb = document.getElementById('nl-emp-'+e);
      if (cb) cb.checked = emps.includes(e);
    });
    const info = l.info||{};
    document.getElementById('nl-titulo').value = l.titulo||'';
    const tipopubEdit = l.tipopub || 'lancamento';
    const lancRad = document.getElementById('nl-tipopub-lanc');
    const reimpRad = document.getElementById('nl-tipopub-reimp');
    if (lancRad) lancRad.checked = tipopubEdit === 'lancamento';
    if (reimpRad) reimpRad.checked = tipopubEdit === 'reimpressao';
    const nlOs = document.getElementById('nl-os'); if(nlOs) nlOs.value = info.os||'';
    const nlAno = document.getElementById('nl-ano'); if(nlAno) nlAno.value = info.ano||'';
    document.getElementById('nl-autor').value = info.autor||'';
    document.getElementById('nl-ilustrador').value = info.ilustrador||'';
    document.getElementById('nl-publico').value = info.publico||'';
    document.getElementById('nl-faixa').value = info.faixa||'';
    document.getElementById('nl-paginas').value = info.paginas||'';
    document.getElementById('nl-tiragem').value = info.tiragem||'';
    document.getElementById('nl-valor').value = info.valor||'';
    document.getElementById('nl-isbn').value = info.isbn||'';
    document.getElementById('nl-formato').value = info.formato||'';
    document.getElementById('nl-colecao').value = info.colecao||'';
    document.getElementById('nl-editora').value = info.editora||'';
    document.getElementById('nl-lancamento').value = info.lancamento||'';
    document.getElementById('nl-sinopse').value = info.sinopse||'';
    document.querySelector('#modal-livro .modal-title').textContent = 'Ficha Técnica · ' + l.titulo;
    document.querySelector('#modal-livro .btn-primary').textContent = 'Salvar alterações';
    // Populate and set tipo de autoria
    const tasEdit = document.getElementById('nl-tipo-autoria');
    if (tasEdit) {
      const ms = [...(mentees||[])].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
      tasEdit.innerHTML = '<option value="">Não se aplica</option>' + ms.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
      tasEdit.value = l.tipoAutoriaMenteeId ? l.tipoAutoriaMenteeId.toString() : '';
    }
    openModal('modal-livro');
  }
  function deleteLivro(id) {
    const l = livros.find(x=>x.id===id);
    if (!l) return;
    const snap = [...livros];
    livros = livros.filter(x=>x.id!==id);
    save('gc-livros', livros); renderLivros();
    pushUndo(l.titulo||'Livro', ()=>{ livros=snap; save('gc-livros',livros); renderLivros(); });
  }
  function toggleEtapa(id, i) { 
    const l=livros.find(x=>x.id===id); 
    if(l) { 
      const wasFeito = l.etapas[i].feito;
      l.etapas[i].feito=!l.etapas[i].feito; 
      save('gc-livros',livros); renderLivros(); buildTarefas(); buildColabTarefas(); buildPrioridades(); 
      if (!wasFeito && l.etapas[i].feito) {
        const userName = window._currentUserName || localStorage.getItem('gc-session-name') || '';
        notifyTaskCompleted(`[${l.titulo}] ${l.etapas[i].nome}`, userName);
      }
    } 
  }
  function setPrazoEtapa(id,i,val) { updateEtapaPrazoInline(id, i, val); }
  function deleteEtapa(id,i) { const l=livros.find(x=>x.id===id); if(l) { l.etapas.splice(i,1); save('gc-livros',livros); renderLivros(); } }
  function setEtapaResp(id,i,resp) { const l=livros.find(x=>x.id===id); if(l) { l.etapas[i].resp=resp; save('gc-livros',livros); buildColabTarefas(); } }
  
  /* ── MENTEES ── */
  let currentMenteeId = null;
  let currentMenteeProgram = 'planodiretor'; // 'planodiretor' | 'marco0'
  
  function getMenteeArray() {
    return currentMenteeProgram === 'marco0' ? menteesMarco0 : mentees;
  }
  function saveMenteeArray() {
    if (currentMenteeProgram === 'marco0') {
      save('gc-mentees-marco0', menteesMarco0);
    } else {
      save('gc-mentees', mentees);
    }
  }
  
  function getInitials(name) { return name.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase(); }
  
  const S_BADGE = {'ok':'b-ok','indiv. pend.':'b-warn','sem contato':'b-danger','aguardando':'b-gray'};
  
  function renderMenteeList() {
    const el = document.getElementById('mentee-list-rendered');
    if (!el) return;
    const cntM2 = document.getElementById('cnt-mentoradas'); if(cntM2) cntM2.textContent = mentees.length;
    const menteesSorted = [...mentees].sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
    el.innerHTML = menteesSorted.map(m => {
      return `<div class="mentee-list-item" onclick="openMenteeModal(${m.id})">
        <div class="avatar">${getInitials(m.name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="mentee-name">${m.name}</div>
          ${m.docsLink ? `<a href="${m.docsLink}" target="_blank" onclick="event.stopPropagation();" style="font-size:11px;color:var(--gisella);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">📄 docs</a>` : ''}
        </div>
        <button class="mentee-delete-btn" onclick="event.stopPropagation();deleteMentee(${m.id},'planodiretor')" title="Descadastrar">×</button>
      </div>`;
    }).join('');
    renderMarco0List();
  }
  
  function renderMarco0List() {
    const el = document.getElementById('marco0-list-rendered');
    if (!el) return;
    const menteesSorted = [...menteesMarco0].sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (menteesSorted.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:var(--text-soft);padding:8px;">Nenhuma mentorada cadastrada.</div>';
      return;
    }
    el.innerHTML = menteesSorted.map(m => {
      return `<div class="mentee-list-item" onclick="openMenteeModal(${m.id},'marco0')">
        <div class="avatar">${getInitials(m.name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="mentee-name">${m.name}</div>
        </div>
        <button class="mentee-delete-btn" onclick="event.stopPropagation();deleteMentee(${m.id},'marco0')" title="Descadastrar">×</button>
      </div>`;
    }).join('');
  }
  
  function openMenteeModal(id, program) {
    currentMenteeProgram = program || 'planodiretor';
    const arr = getMenteeArray();
    const m = arr.find(x=>x.id===id);
    if (!m) return;
    currentMenteeId = id;
    document.getElementById('mm-avatar').textContent = getInitials(m.name);
    document.getElementById('mm-name').textContent = m.name;
    document.getElementById('mm-notes').value = m.notes||'';
    document.getElementById('mm-docs').value = m.docsLink||'';
    updateDocsLink();
    document.getElementById('mm-sdate').value = new Date().toISOString().slice(0,10);
    document.getElementById('mm-snotes').value = '';
    renderMenteeSessions(m);
    renderMenteeLivros();
    // Reset tabs
    document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.modal-tab-content').forEach(t=>t.classList.remove('active'));
    document.querySelector('.modal-tab').classList.add('active');
    document.getElementById('mtab-notas').classList.add('active');
    openModal('modal-mentee');
  }
  
  function saveMenteeField() {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m) return;
    m.notes = document.getElementById('mm-notes').value;
    m.docsLink = document.getElementById('mm-docs').value.trim();
    saveMenteeArray();
    if (currentMenteeProgram === 'marco0') renderMarco0List(); else renderMenteeList();
  }
  
  const MS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  function fmtDatePt(val) { if(!val) return '—'; const [y,mo,d]=val.split('-').map(Number); return `${d} ${MS[mo-1]} ${y}`; }
  
  function renderMenteeSessions(m) {
    const el = document.getElementById('mm-sessions-list');
    if (!m.sessions||m.sessions.length===0) { el.innerHTML='<div style="font-size:13px;color:var(--text-soft);">Nenhuma sessão registrada.</div>'; return; }
    el.innerHTML = [...m.sessions].sort((a,b)=>b.date.localeCompare(a.date)).map(s=>`
      <div class="session-item">
        <div class="session-date">${fmtDatePt(s.date)}<button class="session-delete" onclick="deleteSession('${s.id}')">×</button></div>
        <div class="session-notes">${s.notes}</div>
      </div>`).join('');
  }
  
  function addMenteeSession() {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m) return;
    const notes = document.getElementById('mm-snotes').value.trim();
    if (!notes) { document.getElementById('mm-snotes').focus(); return; }
    if (!m.sessions) m.sessions=[];
    m.sessions.push({id:Date.now().toString(), date:document.getElementById('mm-sdate').value, notes});
    saveMenteeArray();
    document.getElementById('mm-snotes').value='';
    renderMenteeSessions(m);
  }
  
  function deleteSession(sid) {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m) return;
    m.sessions = m.sessions.filter(s=>s.id!==sid);
    saveMenteeArray();
    renderMenteeSessions(m);
  }
  
  function renderMenteeTasks(m) {
    const el = document.getElementById('mm-tasks-list');
    if (!el) return;
    if (!m.tasks||m.tasks.length===0) { el.innerHTML='<div style="font-size:13px;color:var(--text-soft);margin-bottom:8px;">Nenhuma tarefa vinculada.</div>'; return; }
    el.innerHTML = m.tasks.map(t => {
      // Sync done state from global events
      const ev = events.find(x => x.id.toString() === t.id);
      const done = ev ? !!ev.arquivada : !!t.done;
      const resp  = t.resp  || ev?.responsavel || '';
      const prazo = t.prazo || ev?.data        || '';
      const prazoLabel = prazo ? ` · <span style="color:var(--text-soft);font-size:11px;">${prazo}</span>` : '';
      const respLabel  = resp  ? ` · <span style="font-size:11px;font-weight:500;color:var(--gisella);">${resp}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <input type="checkbox" ${done?'checked':''} onclick="event.stopPropagation();" onchange="toggleMenteeTask('${t.id}')" style="accent-color:var(--gisella);width:14px;height:14px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;${done?'text-decoration:line-through;color:var(--text-soft);':''}">${t.titulo}${respLabel}${prazoLabel}</span>
        <button onclick="deleteMenteeTask('${t.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0 2px;">×</button>
      </div>`;
    }).join('');
  }
  
  function openAddMenteeTask() {
    if (!currentMenteeId) return;
    const m = getMenteeArray().find(x => x.id === currentMenteeId);
    if (!m) return;
    window._addingToMenteeId = currentMenteeId;
    window._addingToMenteeProgram = currentMenteeProgram;
    closeModal('modal-mentee');
    openQuickAdd();
    setTimeout(() => {
      document.getElementById('qa-tipo').value = 'tarefa';
      document.getElementById('qa-emp-gisella').checked = true;
      updateQaFields();
      const titulo = document.getElementById('qa-titulo');
      if (titulo) { titulo.placeholder = `Tarefa para ${m.name}...`; titulo.focus(); }
      window._postQuickAddMenteeId = currentMenteeId;
      window._postQuickAddMenteeProgram = currentMenteeProgram;
    }, 80);
  }
  
  function cancelMenteeTaskAdd() {
    const row = document.getElementById('mm-task-add-row');
    if (row) row.remove();
  }
  
  function addMenteeTaskInline() {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m) return;
    const input = document.getElementById('mm-task-input-inline');
    const titulo = (input?.value||'').trim();
    if (!titulo) { input?.focus(); return; }
    const resp  = document.getElementById('mm-task-resp-inline')?.value || '';
    const prazo = document.getElementById('mm-task-prazo-inline')?.value || '';
    if (!m.tasks) m.tasks=[];
    const newEv = {id:Date.now(), empresa:'gisella', titulo:`[${m.name}] ${titulo}`, tipo:'tarefa',
      data:prazo, responsavel:resp, menteeId:m.id};
    events.push(newEv);
    m.tasks.push({id:newEv.id.toString(), titulo, done:false, resp, prazo});
    saveMenteeArray(); save('gc-events',events);
    cancelMenteeTaskAdd();
    renderMenteeTasks(m);
    buildTarefas(); buildColabTarefas();
    renderMarco0List();
  }
  
  function addMenteeTask() {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m) return;
    const titulo = document.getElementById('mm-task-input').value.trim();
    if (!titulo) return;
    if (!m.tasks) m.tasks=[];
    const task = {id:Date.now().toString(), titulo, done:false};
    m.tasks.push(task);
    // Also add to global events
    events.push({id:Date.now()+1, empresa:'gisella', titulo:`[${m.name}] ${titulo}`, data:'', menteeId:m.id});
    saveMenteeArray(); save('gc-events',events);
    document.getElementById('mm-task-input').value='';
    renderMenteeTasks(m); buildTarefas();
  buildColabTarefas();
  renderProjetos();
  initKanban();
  }
  
  function toggleMenteeTask(tid) {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m||!m.tasks) return;
    const t = m.tasks.find(x=>x.id===tid);
    if (t) {
      t.done=!t.done;
      // Sync with global events
      const ev = events.find(x=>x.id.toString()===tid);
      if (ev) { ev.arquivada = t.done; save('gc-events',events); buildTarefas(); buildColabTarefas(); }
      save('gc-mentees',mentees);
      renderMenteeTasks(m);
    }
  }
  
  function deleteMenteeTask(tid) {
    const m = getMenteeArray().find(x=>x.id===currentMenteeId);
    if (!m||!m.tasks) return;
    m.tasks = m.tasks.filter(x=>x.id!==tid);
    events = events.filter(x=>x.id.toString()!==tid);
    saveMenteeArray(); save('gc-events',events);
    renderMenteeTasks(m); buildTarefas(); buildColabTarefas();
  }
  
  let _addingMenteeProgram = 'planodiretor';
  
  function openAddMentee(program) {
    _addingMenteeProgram = program || 'planodiretor';
    document.getElementById('new-mentee-name').value = '';
    document.getElementById('new-mentee-docs').value = '';
    const title = document.querySelector('#modal-add-mentee .modal-title');
    if (title) title.textContent = program === 'marco0' ? 'Cadastrar mentorada · Marco 0' : 'Cadastrar mentorada · Plano Diretor';
    openModal('modal-add-mentee');
    setTimeout(() => document.getElementById('new-mentee-name').focus(), 80);
  }
  
  function submitAddMentee() {
    const name = document.getElementById('new-mentee-name').value.trim();
    if (!name) { document.getElementById('new-mentee-name').focus(); return; }
    const docsLink = document.getElementById('new-mentee-docs').value.trim();
    const newMentee = { id: Date.now(), name, status: 'ok', notes: '', sessions: [], tasks: [], docsLink };
    if (_addingMenteeProgram === 'marco0') {
      menteesMarco0.push(newMentee);
      save('gc-mentees-marco0', menteesMarco0);
      renderMarco0List();
    } else {
      mentees.push(newMentee);
      save('gc-mentees', mentees);
      renderMenteeList();
    }
    closeModal('modal-add-mentee');
  }
  
  function deleteMentee(id, program) {
    const prog = program || 'planodiretor';
    const arr  = prog === 'marco0' ? menteesMarco0 : mentees;
    const m    = arr.find(x=>x.id===id);
    if (!m) return;
    const snap = [...arr];
    if (prog === 'marco0') {
      menteesMarco0 = menteesMarco0.filter(x=>x.id!==id);
      save('gc-mentees-marco0', menteesMarco0);
      renderMarco0List();
    } else {
      mentees = mentees.filter(x=>x.id!==id);
      save('gc-mentees', mentees);
      renderMenteeList();
    }
    pushUndo(m.name, () => {
      if (prog === 'marco0') {
        menteesMarco0 = snap; save('gc-mentees-marco0', menteesMarco0); renderMarco0List();
      } else {
        mentees = snap; save('gc-mentees', mentees); renderMenteeList();
      }
    });
  }
  
  /* ── CONTEUDO ── */
  let currentConteudoId = null;
  const ST_MAP = {copy:{l:'Copy criada',c:'s-copy'},gravado:{l:'Gravado',c:'s-gravado'},edicao:{l:'Para editar',c:'s-edicao'},aprovado:{l:'Para aprovar',c:'s-aprovado'},agendado:{l:'Para agendar',c:'s-agendado'},postado:{l:'Para postar',c:'s-postado'}};
  const REDE_L = {instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',substack:'Substack',emanda:'Emanda'};
  const TIPO_L = {reel:'Reel',foto:'Foto',dump:'Dump',card:'Card',carrossel:'Carrossel',story:'Story',emailmkt:'Email mkt',video:'Vídeo'};
  const EMP_B = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
  const EMP_S = {editora:'Editora',leia:'Léia',gisella:'GC'};
  
  // Etapas padrão de um conteúdo (baseadas no fluxo de status)
  const CONTEUDO_ETAPAS_PADRAO = ['Copy criada','Gravado','Para editar','Para aprovar','Para agendar','Para postar'];
  const CONTEUDO_ETAPAS_KEYS   = ['copy','gravado','edicao','aprovado','agendado','postado'];
  const EMANDA_ETAPAS_PADRAO = ['Definir o tema do e-mail','Criar o gancho principal','Planejar a estrutura do e-mail','Escrever o email','Providenciar os banners','Definir CTAs','Organizar links de destino','Criar o email mkt','Enviar um teste','Testar os botões e links','Disparar para a base'];
  const EMANDA_ETAPAS_KEYS   = ['tema','gancho','estrutura','escrever','banners','ctas','links','criar','teste','testar','disparar'];
  
  // Na criação de um conteúdo, os prazos do fluxo padrão acompanham a data de
  // postagem. Tarefas atribuídas nunca ficam no fim de semana: sábado vai
  // para sexta e domingo vai para a segunda-feira seguinte.
  function prazoUtilAntesDaPostagem(dataPostagem, diasAntes) {
    if (!dataPostagem || !/^\d{4}-\d{2}-\d{2}$/.test(dataPostagem)) return '';
  
    const [ano, mes, dia] = dataPostagem.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    data.setDate(data.getDate() - diasAntes);
  
    if (data.getDay() === 6) data.setDate(data.getDate() - 1); // sábado → sexta
    if (data.getDay() === 0) data.setDate(data.getDate() + 1); // domingo → segunda
  
    const y = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, '0');
    const d = String(data.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  function prazosIniciaisDoConteudo(rede, dataPostagem, empresa = '') {
    // O fluxo de e-mail tem etapas próprias e não usa Edição/Aprovação/Agendamento.
    if (rede === 'emanda') return {};

    // Conteúdos da GC Estratégias já nascem com todo o fluxo organizado:
    // uma etapa por dia, terminando na data de postagem. A liberação para cada
    // pessoa continua sequencial em getConteudoEtapasLiberadas / Checklist.
    if (String(empresa).split(',').includes('gisella')) {
      const prazoEm = diasAntes => dataPostagem ? prazoUtilAntesDaPostagem(dataPostagem, diasAntes) : '';
      return {
        copy:     { prazo: prazoEm(5), resp: 'Gisella' },
        gravado:  { prazo: prazoEm(4), resp: 'Gisella' },
        edicao:   { prazo: prazoEm(3), resp: 'Luiggi' },
        aprovado: { prazo: prazoEm(2), resp: 'Gisella' },
        agendado: { prazo: prazoEm(1), resp: 'Milena' },
        postado:  { prazo: prazoEm(0), resp: 'Milena' },
      };
    }
  
    return {
      edicao: {
        prazo: dataPostagem ? prazoUtilAntesDaPostagem(dataPostagem, 2) : '',
        resp: 'Luiggi',
      },
      aprovado: {
        prazo: dataPostagem ? prazoUtilAntesDaPostagem(dataPostagem, 1) : '',
        resp: 'Milena',
      },
      agendado: {
        prazo: dataPostagem ? prazoUtilAntesDaPostagem(dataPostagem, 1) : '',
        resp: 'Milena',
      },
      postado: {
        prazo: dataPostagem ? prazoUtilAntesDaPostagem(dataPostagem, 0) : '',
        resp: 'Milena',
      },
    };
  }
  
  function getConteudoEtapasByRede(c) {
    if ((c.rede||'') === 'emanda') {
      if (!c.etapasStatus) c.etapasStatus = {};
      return EMANDA_ETAPAS_PADRAO.map((nome, i) => ({
        key: EMANDA_ETAPAS_KEYS[i], nome,
        feito: !!c.etapasStatus[EMANDA_ETAPAS_KEYS[i]]?.feito,
        resp:  c.etapasStatus[EMANDA_ETAPAS_KEYS[i]]?.resp  || '',
        prazo: c.etapasStatus[EMANDA_ETAPAS_KEYS[i]]?.prazo || '',
      }));
    }
    return null; // use default
  }
  
  function getConteudoEtapas(c) {
    const etapasDaRede = getConteudoEtapasByRede(c);
    if (etapasDaRede) return etapasDaRede;
    // Fluxo padrão com o estado salvo em c.etapasStatus.
    if (!c.etapasStatus) c.etapasStatus = {};
    return CONTEUDO_ETAPAS_PADRAO.map((nome, i) => ({
      key: CONTEUDO_ETAPAS_KEYS[i],
      nome,
      feito: !!c.etapasStatus[CONTEUDO_ETAPAS_KEYS[i]]?.feito,
      resp:  c.etapasStatus[CONTEUDO_ETAPAS_KEYS[i]]?.resp  || '',
      prazo: c.etapasStatus[CONTEUDO_ETAPAS_KEYS[i]]?.prazo || '',
    }));
  }

  // No fluxo de conteúdo, apenas a próxima etapa pendente vira uma tarefa
  // ativa. As etapas já concluídas permanecem disponíveis como histórico.
  function getConteudoEtapasLiberadas(c) {
    const etapas = getConteudoEtapas(c);
    const nextPendingIndex = etapas.findIndex(etapa => !etapa.feito);
    if (nextPendingIndex < 0) return etapas;
    return etapas.filter((etapa, index) => etapa.feito || index === nextPendingIndex);
  }
  
  // Conteúdo não possui check próprio: ele é concluído automaticamente quando
  // todas as tarefas/etapas do seu fluxo estiverem concluídas.
  function isConteudoFinalizado(c) {
    const etapas = getConteudoEtapas(c);
    return etapas.length > 0 && etapas.every(etapa => etapa.feito === true);
  }
  
  function atualizarConclusaoConteudo(c) {
    const etapas = getConteudoEtapas(c);
    const finalizado = etapas.length > 0 && etapas.every(etapa => etapa.feito === true);
    c.done = finalizado;
  
    if (finalizado) {
      c.status = 'encerrar';
    } else if (c.status === 'encerrar') {
      const ultimaEtapaConcluida = [...etapas].reverse().find(etapa => etapa.feito);
      c.status = ultimaEtapaConcluida?.key || 'copy';
    }
    return finalizado;
  }
  
  function conteudoCardHtml(c, showEmpresa) {
    const etapas = getConteudoEtapas(c);
    const done = etapas.filter(e => e.feito).length;
    const pct = etapas.length > 0 ? Math.round(done / etapas.length * 100) : 0;
    const proxima = etapas.find(e => !e.feito);
    const finalizado = isConteudoFinalizado(c);
    const empBadges = empBadgesHtml(c.empresa);
    const isOpen = c.expandido;
  
    return `<div class="conteudo-card${finalizado?' style="opacity:0.55;"':''}">
      <div class="conteudo-header" onclick="toggleConteudo(${c.id})">
        <span class="conteudo-titulo" title="${c.nome}">${c.nome}</span>
        ${showEmpresa ? empBadges : ''}
        <span class="rede-badge rede-${c.rede}" style="flex-shrink:0;font-size:10px;">${REDE_L[c.rede]||c.rede||''}</span>
        <span style="font-size:11px;color:var(--text-soft);flex-shrink:0;">${TIPO_L[c.tipo]||c.tipo||''}</span>
        <div class="conteudo-progress-wrap">
          <div class="conteudo-progress"><div class="conteudo-progress-fill" style="width:${pct}%;"></div></div>
          <span style="font-size:11px;color:var(--text-soft);">${pct}%</span>
        </div>
        ${proxima && !finalizado ? `<span style="font-size:11px;color:var(--text-soft);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;">${proxima.nome}</span>` : (finalizado ? '<span class="badge b-ok" style="font-size:10px;">concluído</span>' : '')}
        <button onclick="event.stopPropagation();openConteudoEtapasPrazos(${c.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;" title="Editar prazos e responsáveis">📅</button>
        <button onclick="event.stopPropagation();openConteudo(${c.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0;" title="Editar">✎</button>
        <button onclick="event.stopPropagation();duplicarConteudo(${c.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0;" title="Duplicar">⧉</button>
        <button onclick="event.stopPropagation();deleteConteudo(${c.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0;" title="Excluir">×</button>
        <span class="conteudo-toggle">${isOpen?'▾':'▸'}</span>
      </div>
      <div class="conteudo-body${isOpen?' open':''}">
        ${renderConteudoEtapasInline(c, etapas)}
      </div>
    </div>`;
  }
  
  function contentStageLink(c, key) {
    if (key === 'edicao') return String(c.link || '').trim();
    if (key === 'gravado') return String(c.observacao || '').trim();
    return '';
  }

  function validContentStageLink(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function contentStageLinkButton(c, key) {
    const link = validContentStageLink(contentStageLink(c, key));
    if (!link) return '';
    return `<a href="${link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Abrir link" style="color:var(--gisella);font-size:14px;text-decoration:none;line-height:1;">🔗</a>`;
  }

  function requestContentStageLink(c, key) {
    if (key !== 'edicao' && key !== 'gravado') return true;
    const current = contentStageLink(c, key);
    const label = key === 'edicao' ? 'Link da edição' : 'Link do gravado';
    const value = window.prompt(`${label}:`, current);
    if (value === null) return false;
    const link = validContentStageLink(value);
    if (!link) {
      alert('Informe um link válido, começando com http:// ou https://.');
      return false;
    }
    if (key === 'edicao') c.link = link;
    else c.observacao = link;
    return true;
  }

  function renderConteudoEtapasInline(c, etapas) {
    // Feitas sobem pro topo
    const sorted = [...etapas].sort((a,b) => {
      if (a.feito && !b.feito) return -1;
      if (!a.feito && b.feito) return 1;
      return 0;
    });
    return sorted.map(e => {
      const cor = e.feito ? 'var(--text-soft)' : (e.prazo ? (() => {
        const diff = Math.round((new Date(e.prazo+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        return diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--warn)' : 'var(--text)';
      })() : 'var(--text)');
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);${e.feito?'opacity:0.55;':''}">
        <input type="checkbox" ${e.feito?'checked':''} onchange="toggleConteudoEtapa(${c.id},'${e.key}')"
          style="accent-color:var(--gisella);width:15px;height:15px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;font-size:13px;color:${cor};${e.feito?'text-decoration:line-through;':''}">${e.nome} ${contentStageLinkButton(c, e.key)}</span>
        <select onchange="setConteudoEtapaResp(${c.id},'${e.key}',this.value)"
          style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:var(--text-soft);">
          <option value="" ${!e.resp?'selected':''}>—</option>
          <option value="Gisella" ${e.resp==='Gisella'?'selected':''}>Gisella</option>
          <option value="Milena" ${e.resp==='Milena'?'selected':''}>Milena</option>
          <option value="Luiggi" ${e.resp==='Luiggi'?'selected':''}>Luiggi</option>
        </select>
        <input type="date" value="${e.prazo||''}" onchange="setConteudoEtapaPrazo(${c.id},'${e.key}',this.value)"
          style="font-size:12px;border:1px solid var(--border);border-radius:6px;padding:3px 6px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;width:130px;">
      </div>`;
    }).join('');
  }
  
  function toggleConteudo(id) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    c.expandido = !c.expandido;
    save('gc-conteudos', conteudos);
    renderConteudos();
  }
  
  function toggleConteudoEtapa(id, key) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    if (!c.etapasStatus) c.etapasStatus = {};
    if (!c.etapasStatus[key]) c.etapasStatus[key] = {};
    const wasFeito = c.etapasStatus[key].feito;
    if (!wasFeito && !requestContentStageLink(c, key)) {
      renderConteudos();
      buildTarefas();
      buildColabTarefas();
      return;
    }
    c.etapasStatus[key].feito = !c.etapasStatus[key].feito;
    const etapas = getConteudoEtapas(c);
    // A próxima pessoa nunca recebe uma etapa vencida. Quando a etapa anterior
    // for concluída depois do prazo, a nova tarefa passa para hoje (ou para a
    // segunda-feira quando hoje for domingo).
    if (c.etapasStatus[key].feito) {
      const proxima = etapas.find(etapa => !etapa.feito);
      const dataDeLiberacao = prazoUtilAntesDaPostagem(dashboardDate(), 0);
      if (proxima && (!proxima.prazo || proxima.prazo < dataDeLiberacao)) {
        c.etapasStatus[proxima.key].prazo = dataDeLiberacao;
      }
    }
    const ultimaEtapaConcluida = [...etapas].reverse().find(etapa => etapa.feito);
    c.status = c.etapasStatus[key].feito ? key : (ultimaEtapaConcluida?.key || 'copy');
    atualizarConclusaoConteudo(c);
    save('gc-conteudos', conteudos);
    renderConteudos();
    buildTarefas();
    buildColabTarefas();
    // Notify if completed
    if (!wasFeito && c.etapasStatus[key].feito) {
      const etapaNome = CONTEUDO_ETAPAS_PADRAO[CONTEUDO_ETAPAS_KEYS.indexOf(key)] || key;
      const userName = window._currentUserName || localStorage.getItem('gc-session-name') || '';
      notifyTaskCompleted(`[${c.nome}] ${etapaNome}`, userName);
    }
  }
  
  function setConteudoEtapaResp(id, key, resp) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    if (!c.etapasStatus) c.etapasStatus = {};
    if (!c.etapasStatus[key]) c.etapasStatus[key] = {};
    c.etapasStatus[key].resp = resp;
    save('gc-conteudos', conteudos);
    buildTarefas();
    buildColabTarefas();
  }
  
  function setConteudoEtapaPrazo(id, key, prazo) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    if (!c.etapasStatus) c.etapasStatus = {};
    if (!c.etapasStatus[key]) c.etapasStatus[key] = {};
    c.etapasStatus[key].prazo = prazo;
    save('gc-conteudos', conteudos);
    buildTarefas();
    buildColabTarefas();
  }
  
  // Modal de prazos (estilo openEtapasPrazos dos livros)
  let _epConteudoId = null;
  function openConteudoEtapasPrazos(id) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    _epConteudoId = id;
    document.getElementById('modal-cep-subtitulo').textContent = c.nome + ' — prazos e responsáveis';
    renderCepLista();
    openModal('modal-conteudo-etapas-prazos');
  }
  
  function renderCepLista() {
    const c = conteudos.find(x => x.id === _epConteudoId);
    const el = document.getElementById('modal-cep-lista');
    if (!c || !el) return;
    const etapas = getConteudoEtapas(c);
    // Feitas sobem pro topo
    const sorted = [...etapas].sort((a,b) => {
      if (a.feito && !b.feito) return -1;
      if (!a.feito && b.feito) return 1;
      return 0;
    });
    el.innerHTML = sorted.map(e => {
      const cor = e.feito ? 'var(--text-soft)' : (e.prazo ? (() => {
        const diff = Math.round((new Date(e.prazo+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        return diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--warn)' : 'var(--text)';
      })() : 'var(--text)');
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);${e.feito?'opacity:0.55;':''}">
        <input type="checkbox" ${e.feito?'checked':''} onchange="toggleConteudoEtapaCep('${e.key}')"
          style="accent-color:var(--gisella);width:16px;height:16px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;font-size:13px;color:${cor};${e.feito?'text-decoration:line-through;':''}">${e.nome} ${contentStageLinkButton(c, e.key)}</span>
        <select onchange="setConteudoEtapaResp(${_epConteudoId},'${e.key}',this.value)"
          style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:var(--text-soft);cursor:pointer;">
          <option value="" ${!e.resp?'selected':''}>—</option>
          <option value="Gisella" ${e.resp==='Gisella'?'selected':''}>Gisella</option>
          <option value="Milena" ${e.resp==='Milena'?'selected':''}>Milena</option>
          <option value="Luiggi" ${e.resp==='Luiggi'?'selected':''}>Luiggi</option>
        </select>
        <input type="date" value="${e.prazo||''}" onchange="setConteudoEtapaPrazo(${_epConteudoId},'${e.key}',this.value);renderCepLista()"
          style="font-size:12px;border:1px solid var(--border);border-radius:6px;padding:3px 6px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;width:130px;">
      </div>`;
    }).join('');
  }
  
  function toggleConteudoEtapaCep(key) {
    toggleConteudoEtapa(_epConteudoId, key);
    renderCepLista();
  }
  
  function sortConteudosByPriority(lista) {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().slice(0,10);
    return [...lista].sort((a, b) => {
      const da = a.dataPost || '';
      const db = b.dataPost || '';
      // sem data vai pro final
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      // atrasadas primeiro, depois cronológico
      return da.localeCompare(db);
    });
  }
  
  function conteudoPriorityLabel(c) {
    if (!c.dataPost) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().slice(0,10);
    const diff = Math.round((new Date(c.dataPost+'T00:00:00') - today) / 86400000);
    if (diff < 0) return { label: 'Atrasados', color: 'var(--danger)' };
    if (diff === 0) return { label: 'Hoje', color: 'var(--gisella)' };
    if (diff === 1) return { label: 'Amanhã', color: 'var(--warn)' };
    if (diff <= 7) return { label: 'Esta semana', color: 'var(--text-mid)' };
    return { label: 'Próximos', color: 'var(--text-soft)' };
  }
  
  function cardsHtmlGrouped(lista, showEmpresa) {
    if (lista.length === 0)
      return '<div style="padding:1.5rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum conteúdo. Use o botão + para adicionar.</div>';
    const sorted = sortConteudosByPriority(lista);
    let html = '';
    let currentLabel = null;
    sorted.forEach(c => {
      const lbl = conteudoPriorityLabel(c);
      const lblText = lbl ? lbl.label : 'Sem data';
      const lblColor = lbl ? lbl.color : 'var(--text-soft)';
      if (lblText !== currentLabel) {
        currentLabel = lblText;
        html += `<div style="font-size:11px;font-weight:500;color:${lblColor};text-transform:uppercase;letter-spacing:0.09em;padding:8px 0 4px;">${lblText}</div>`;
      }
      html += conteudoCardHtml(c, showEmpresa);
    });
    return html;
  }
  
  function renderConteudos() {
    const ativos = conteudos.filter(c => !isConteudoFinalizado(c));
    const arquivados = conteudos.filter(c => isConteudoFinalizado(c));
  
    function cardsHtml(lista, showEmpresa) {
      return lista.length === 0
        ? '<div style="padding:1.5rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum conteúdo. Use o botão + para adicionar.</div>'
        : cardsHtmlGrouped(lista, showEmpresa);
    }
  
    // Aba conteúdo unificada
    const contDiv = document.getElementById('conteudo-tbody');
    if (contDiv) contDiv.innerHTML = cardsHtml(ativos, true);
  
    // Por empresa
    ['editora','leia','gisella'].forEach(emp => {
      const el = document.getElementById('conteudo-tbody-'+emp);
      if (!el) return;
      const items = ativos.filter(c => (c.empresa||'').split(',').includes(emp));
      el.innerHTML = cardsHtml(items, false);
    });
  
    // Menu page
    const _cf = getFilter('conteudo-menu');
    const ativosMenu = _cf==='all' ? ativos : ativos.filter(c=>(c.empresa||'').split(',').includes(_cf));
    const menuDiv = document.getElementById('conteudo-tbody-menu');
    if (menuDiv) menuDiv.innerHTML = cardsHtml(ativosMenu, true);
  
    // Arquivados
    const archMenuCnt = document.getElementById('archived-count-menu');
    if (archMenuCnt) archMenuCnt.textContent = arquivados.length;
    const archMenuDiv = document.getElementById('archived-tbody-menu');
    if (archMenuDiv) archMenuDiv.innerHTML = arquivados.map(c=>conteudoCardHtml(c,true)).join('');
  
    const archCnt = document.getElementById('archived-count');
    if (archCnt) archCnt.textContent = arquivados.length;
    const archDiv = document.getElementById('archived-tbody');
    if (archDiv) archDiv.innerHTML = arquivados.map(c=>conteudoCardHtml(c,true)).join('');
  }
  
  function toggleArchivedMenu() {
    const sec = document.getElementById('archived-section-menu');
    const arr = document.getElementById('archived-arrow-menu');
    if (!sec) return;
    const open = sec.style.display === 'none';
    sec.style.display = open ? 'block' : 'none';
    arr.textContent = open ? '▾' : '▸';
  }
  
  function toggleArchived() {
    const sec = document.getElementById('archived-section');
    const arr = document.getElementById('archived-arrow');
    const open = sec.style.display==='none';
    sec.style.display = open?'block':'none';
    arr.textContent = open?'▾':'▸';
  }
  
  function openNewConteudo() {
    currentConteudoId = null;
    document.getElementById('mc-title').textContent = 'Novo conteúdo';
    ['mc-nome','mc-responsavel','mc-link','mc-copy','mc-legenda'].forEach(id=>document.getElementById(id).value='');
    setEmpresasChecked('mc-emp-', 'gisella');
    document.getElementById('mc-rede').value='instagram';
    updateMcRede();
    document.getElementById('mc-tipo').value='reel';
    document.getElementById('mc-status').value='copy';
    document.getElementById('mc-dataprod').value='';
    document.getElementById('mc-datapost').value='';
    document.getElementById('mc-hora').value='';
    document.getElementById('mc-observacao').value='';
    openModal('modal-conteudo');
    setTimeout(()=>document.getElementById('mc-nome').focus(),50);
  }
  
  function openNewConteudoEmpresa(emp) { openNewConteudo(); setEmpresasChecked('mc-emp-', emp); }
  
  function openConteudo(id) {
    const c = conteudos.find(x=>x.id===id);
    if (!c) return;
    currentConteudoId = id;
    document.getElementById('mc-title').textContent = c.nome;
    document.getElementById('mc-nome').value=c.nome;
    setEmpresasChecked('mc-emp-', c.empresa || 'editora');
    document.getElementById('mc-responsavel').value=c.responsavel||'';
    document.getElementById('mc-rede').value=c.rede||'instagram';
    updateMcRede();
    document.getElementById('mc-tipo').value=c.tipo;
    document.getElementById('mc-status').value=c.status;
    document.getElementById('mc-dataprod').value=c.dataProd||'';
    document.getElementById('mc-datapost').value=c.dataPost||'';
    document.getElementById('mc-hora').value=c.hora||'';
    document.getElementById('mc-observacao').value=c.observacao||'';
    document.getElementById('mc-link').value=c.link||'';
    document.getElementById('mc-copy').value=c.copy||'';
    document.getElementById('mc-legenda').value=c.legenda||'';
    openModal('modal-conteudo');
  }
  
  function saveConteudo() {
    const nome = document.getElementById('mc-nome').value.trim();
    if (!nome) { document.getElementById('mc-nome').focus(); return; }
    const data = {nome, empresa:getEmpresaStr('mc-emp-','editora'), responsavel:document.getElementById('mc-responsavel').value, rede:document.getElementById('mc-rede').value, tipo:document.getElementById('mc-tipo').value, status:document.getElementById('mc-status').value, dataProd:document.getElementById('mc-dataprod').value, dataPost:document.getElementById('mc-datapost').value, hora:document.getElementById('mc-hora').value, link:document.getElementById('mc-link').value, copy:document.getElementById('mc-copy').value, legenda:document.getElementById('mc-legenda').value, observacao:document.getElementById('mc-observacao').value};
    if (currentConteudoId) { const i=conteudos.findIndex(x=>x.id===currentConteudoId); if(i>-1) conteudos[i]={...conteudos[i],...data}; }
    else conteudos.push({
      id:Date.now(),
      done:false,
      etapasStatus: prazosIniciaisDoConteudo(data.rede, data.dataPost, data.empresa),
      ...data
    });
    save('gc-conteudos',conteudos); renderConteudos();
    refreshCalendars(); buildConteudoCalSemana(); buildVisaoConteudos();
    buildTarefas(); buildColabTarefas(); buildPrioridades();
    closeModal('modal-conteudo');
  }
  
  function deleteConteudo(id) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    const snapshot = [...conteudos];
    conteudos = conteudos.filter(x => x.id !== id);
    save('gc-conteudos', conteudos);
    renderConteudos(); buildPrioridades();
    pushUndo(c.nome || 'Conteúdo', () => {
      conteudos = snapshot;
      save('gc-conteudos', conteudos);
      renderConteudos(); buildPrioridades();
    });
  }
  
  let _mcdConteudoId = null;
  
  function openConteudoDetalhe(id) {
    const c = conteudos.find(x => x.id === id);
    if (!c) return;
    _mcdConteudoId = id;
    document.getElementById('mcd-title').textContent = c.nome;
    const empLabel = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'}[c.empresa] || c.empresa;
    document.getElementById('mcd-subtitulo').textContent = empLabel + ' · ' + (c.rede||'') + (c.tipo ? ' · '+c.tipo : '');
    document.getElementById('mcd-status').value = c.status || 'copy';
    document.getElementById('mcd-responsavel').value = c.responsavel || '';
    document.getElementById('mcd-dataprod').value = c.dataProd || '';
    document.getElementById('mcd-datapost').value = c.dataPost || '';
    document.getElementById('mcd-legenda').value = c.legenda || '';
    renderMcdEtapas(c);
    openModal('modal-conteudo-detalhe');
  }
  
  function renderMcdEtapas(c) {
    const el = document.getElementById('mcd-etapas-lista');
    if (!el) return;
    const etapas = c.etapas || [];
    if (etapas.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-soft);padding:6px 0;">Nenhuma etapa. Adicione abaixo.</div>';
      return;
    }
    el.innerHTML = etapas.map((e, i) => {
      const cor = e.feito ? 'var(--text-soft)' : (e.prazo ? (() => {
        const diff = Math.round((new Date(e.prazo+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        return diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--warn)' : 'var(--text)';
      })() : 'var(--text)');
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);${e.feito?'opacity:0.55;':''}">
        <input type="checkbox" ${e.feito?'checked':''} onchange="toggleMcdEtapa(${i})" style="accent-color:var(--gisella);width:16px;height:16px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;font-size:13px;color:${cor};${e.feito?'text-decoration:line-through;':''}">${e.nome}</span>
        <select onchange="setMcdEtapaResp(${i},this.value)" style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:var(--text-soft);">
          <option value="" ${!e.resp?'selected':''}>—</option>
          <option value="Gisella" ${e.resp==='Gisella'?'selected':''}>Gisella</option>
          <option value="Milena" ${e.resp==='Milena'?'selected':''}>Milena</option>
          <option value="Luiggi" ${e.resp==='Luiggi'?'selected':''}>Luiggi</option>
        </select>
        <input type="date" value="${e.prazo||''}" onchange="setMcdEtapaPrazo(${i},this.value)"
          style="font-size:12px;border:1px solid var(--border);border-radius:6px;padding:3px 6px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;width:130px;">
        <button onclick="deleteMcdEtapa(${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0 2px;">×</button>
      </div>`;
    }).join('');
  }
  
  function saveConteudoDetalhe() {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    if (!c) return;
    c.status = document.getElementById('mcd-status').value;
    c.responsavel = document.getElementById('mcd-responsavel').value;
    c.dataProd = document.getElementById('mcd-dataprod').value;
    c.dataPost = document.getElementById('mcd-datapost').value;
    c.legenda = document.getElementById('mcd-legenda').value;
    save('gc-conteudos', conteudos);
    renderConteudos();
  }
  
  function addConteudoEtapa() {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    const inp = document.getElementById('mcd-nova-etapa');
    const nome = (inp?.value||'').trim();
    if (!c || !nome) { inp?.focus(); return; }
    if (!c.etapas) c.etapas = [];
    c.etapas.push({nome, feito: false, prazo: '', resp: ''});
    save('gc-conteudos', conteudos);
    if (inp) inp.value = '';
    renderMcdEtapas(c);
  }
  
  function toggleMcdEtapa(idx) {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    if (!c || !c.etapas || !c.etapas[idx]) return;
    c.etapas[idx].feito = !c.etapas[idx].feito;
    save('gc-conteudos', conteudos);
    renderMcdEtapas(c);
    // Notify if completed
    const user = window._currentUserName || '';
    const etapa = c.etapas[idx];
    if (etapa.feito) {
      addNotif(`✅ Etapa concluída em "${c.nome}": ${etapa.nome}`, 'conteudo');
    }
  }
  
  function setMcdEtapaResp(idx, resp) {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    if (!c || !c.etapas || !c.etapas[idx]) return;
    c.etapas[idx].resp = resp;
    save('gc-conteudos', conteudos);
  }
  
  function setMcdEtapaPrazo(idx, prazo) {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    if (!c || !c.etapas || !c.etapas[idx]) return;
    c.etapas[idx].prazo = prazo;
    save('gc-conteudos', conteudos);
  }
  
  function deleteMcdEtapa(idx) {
    const c = conteudos.find(x => x.id === _mcdConteudoId);
    if (!c || !c.etapas) return;
    c.etapas.splice(idx, 1);
    save('gc-conteudos', conteudos);
    renderMcdEtapas(c);
  }
  
  /* ── STEIRA ── */
  let currentSteiraName = null;
  let _steiraListDragSrc = null;
  
  // Migrate old steiraData format to new array-based format with ids
  function initSteiraList() {
    if (!steiraData._list) {
      // First run: populate default items or from old keys
      const defaults = ['Plano Diretor','Curso solo','Ebook estratégia literária','Plano Diretor 2.0','Workshop avulso'];
      const existing = Object.keys(steiraData).filter(k => k !== '_list' && !k.startsWith('_'));
      const names = existing.length > 0 ? existing : defaults;
      steiraData._list = names.map(name => ({ id: name.replace(/\s/g,'_') + '_' + Date.now(), name }));
      save('gc-steira', steiraData);
    }
  }
  
  function renderSteiraList() {
    initSteiraList();
    const el = document.getElementById('steira-list');
    if (!el) return;
    const list = steiraData._list || [];
    if (list.length === 0) {
      el.innerHTML = '<div style="padding:1rem;color:var(--text-soft);font-size:13px;text-align:center;">Nenhum produto cadastrado.</div>';
      return;
    }
    el.innerHTML = list.map((item, idx) => `
      <div class="steira-item" draggable="true"
        ondragstart="_steiraListDragSrc=${idx};event.dataTransfer.effectAllowed='move';"
        ondragover="event.preventDefault()"
        ondrop="event.preventDefault();steiraListDrop(${idx})">
        <div style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;" onclick="openSteiraById('${item.id}')">
          <span style="cursor:grab;color:var(--text-soft);font-size:12px;">⠿</span>
          <span style="font-size:13px;font-weight:500;">${item.name}</span>
          ${steiraData[item.id]&&steiraData[item.id].link ? `<span id="steira-link-${item.id}" style="font-size:11px;color:var(--gisella);">🔗</span>` : `<span id="steira-link-${item.id}" style="display:none;font-size:11px;color:var(--gisella);">🔗</span>`}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <button onclick="event.stopPropagation();renameSteiraItem('${item.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 5px;" title="Editar nome">✎</button>
          <button onclick="event.stopPropagation();duplicateSteiraItem('${item.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 5px;" title="Duplicar">⧉</button>
          <button onclick="event.stopPropagation();deleteSteiraItem('${item.id}')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:2px 5px;" title="Excluir">×</button>
          <span class="steira-arrow" style="cursor:pointer;" onclick="openSteiraById('${item.id}')">›</span>
        </div>
      </div>`).join('');
  }
  
  function steiraListDrop(toIdx) {
    const fromIdx = _steiraListDragSrc;
    if (fromIdx === null || fromIdx === toIdx) return;
    const list = steiraData._list;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    _steiraListDragSrc = null;
    save('gc-steira', steiraData);
    renderSteiraList();
  }
  
  function openSteiraById(id) {
    initSteiraList();
    const item = (steiraData._list||[]).find(x => x.id === id);
    if (!item) return;
    currentSteiraName = id;
    const d = steiraData[id]||{};
    document.getElementById('ms-title').textContent = item.name;
    document.getElementById('ms-nome').value=d.nome||item.name;
    document.getElementById('ms-fase').value=d.fase||'';
    document.getElementById('ms-dores').value=d.dores||'';
    document.getElementById('ms-preco').value=d.preco||'';
    document.getElementById('ms-modelo').value=d.modelo||'';
    document.getElementById('ms-formato').value=d.formato||'';
    document.getElementById('ms-notes').value=d.notes||'';
    document.getElementById('ms-link').value=d.link||'';
    const linkOpen = document.getElementById('ms-link-open');
    if (linkOpen) { linkOpen.href=d.link||'#'; linkOpen.style.display=d.link?'inline':'none'; }
    openModal('modal-steira');
  }
  
  function openSteira(nome) {
    // Legacy compatibility: find item by name
    initSteiraList();
    const item = (steiraData._list||[]).find(x => x.name === nome);
    if (item) { openSteiraById(item.id); return; }
    // Fallback: use name as id
    currentSteiraName = nome;
    const d = steiraData[nome]||{};
    document.getElementById('ms-title').textContent = nome;
    document.getElementById('ms-nome').value=d.nome||nome;
    document.getElementById('ms-fase').value=d.fase||'';
    document.getElementById('ms-dores').value=d.dores||'';
    document.getElementById('ms-preco').value=d.preco||'';
    document.getElementById('ms-modelo').value=d.modelo||'';
    document.getElementById('ms-formato').value=d.formato||'';
    document.getElementById('ms-notes').value=d.notes||'';
    document.getElementById('ms-link').value=d.link||'';
    const linkOpen = document.getElementById('ms-link-open');
    if (linkOpen) { linkOpen.href=d.link||'#'; linkOpen.style.display=d.link?'inline':'none'; }
    openModal('modal-steira');
  }
  
  function saveSteira() {
    if (!currentSteiraName) return;
    steiraData[currentSteiraName] = {
      nome:document.getElementById('ms-nome').value, fase:document.getElementById('ms-fase').value,
      dores:document.getElementById('ms-dores').value, preco:document.getElementById('ms-preco').value,
      modelo:document.getElementById('ms-modelo').value, formato:document.getElementById('ms-formato').value,
      notes:document.getElementById('ms-notes').value,
      link:document.getElementById('ms-link').value.trim()
    };
    // Update name in list
    const item = (steiraData._list||[]).find(x => x.id === currentSteiraName);
    if (item && document.getElementById('ms-nome').value.trim()) {
      item.name = document.getElementById('ms-nome').value.trim();
    }
    save('gc-steira',steiraData);
    renderSteiraList();
    closeModal('modal-steira');
  }
  
  function addSteiraItem() {
    const nome = prompt('Nome do produto:');
    if (!nome||!nome.trim()) return;
    initSteiraList();
    const id = 'steira_' + Date.now();
    steiraData._list.push({ id, name: nome.trim() });
    save('gc-steira', steiraData);
    renderSteiraList();
  }
  
  function renameSteiraItem(id) {
    initSteiraList();
    const item = (steiraData._list||[]).find(x => x.id === id);
    if (!item) return;
    const newName = prompt('Novo nome:', item.name);
    if (!newName || !newName.trim()) return;
    item.name = newName.trim();
    if (steiraData[id]) steiraData[id].nome = newName.trim();
    save('gc-steira', steiraData);
    renderSteiraList();
  }
  
  function duplicateSteiraItem(id) {
    initSteiraList();
    const item = (steiraData._list||[]).find(x => x.id === id);
    if (!item) return;
    const newId = 'steira_' + Date.now();
    const newItem = { id: newId, name: item.name + ' (cópia)' };
    steiraData._list.push(newItem);
    if (steiraData[id]) steiraData[newId] = { ...steiraData[id], nome: newItem.name };
    save('gc-steira', steiraData);
    renderSteiraList();
  }
  
  function deleteSteiraItem(id) {
    initSteiraList();
    const item = (steiraData._list||[]).find(x => x.id === id);
    if (!item) return;
    if (!confirm('Excluir "' + item.name + '"?')) return;
    steiraData._list = steiraData._list.filter(x => x.id !== id);
    delete steiraData[id];
    save('gc-steira', steiraData);
    renderSteiraList();
  }
  
  /* ── TAREFAS ── */
  // openGroups persiste entre rebuilds para manter estado dos grupos abertos
  const openGroups = {};
  
  function buildTarefas() {
    const el = document.getElementById('tarefas-container');
    buildTarefasCalSemana();
    if (!el) return;
  
    // Salvar estado dos grupos abertos ANTES de rebuildar
    ['atrasadas','hoje','semana','proxSemana','proximas',
     'arq-atrasadas','arq-hoje','arq-semana','arq-proxSemana','arq-proximas'].forEach(k => {
      const el2 = document.getElementById('tgrp-' + k);
      if (el2) openGroups[k] = el2.style.display !== 'none';
    });
  
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr2 = today.toISOString().slice(0,10);
  
    const _tf = getFilter('tarefas');
    const _tfc = getFilterColab('tarefas');
    // Etapas de livros como tarefas virtuais
    const etapaEvents = [];
    livros.forEach(l => {
      (l.etapas||[]).forEach((e,i) => {
        const empMatch = _tf==='all'||(l.empresa||'').split(',').includes(_tf);
        if (!empMatch) return;
        if (_tfc!=='all' && (e.resp||'')!==_tfc) return;
        etapaEvents.push({
          id: `livro-${l.id}-${i}`,
          _livroId: l.id, _etapaIdx: i,
          titulo: `[${l.titulo}] ${e.nome}`,
          empresa: l.empresa,
          data: e.prazo||'',
          responsavel: e.resp||'',
          arquivada: e.feito,
          tipo: 'tarefa',
        });
      });
    });
    // Etapas de conteúdos como tarefas virtuais
    conteudos.forEach(c => {
      if (isConteudoFinalizado(c)) return;
      const empMatch = _tf==='all'||(c.empresa||'').split(',').includes(_tf);
      if (!empMatch) return;
      const etapas = getConteudoEtapasLiberadas(c);
      etapas.forEach(e => {
        if (_tfc!=='all' && (e.resp||'')!==_tfc) return;
        etapaEvents.push({
          id: `cont-${c.id}-${e.key}`,
          _conteudoId: c.id, _conteudoKey: e.key,
          titulo: `[${c.nome}] ${e.nome}`,
          empresa: c.empresa,
          data: e.prazo||'',
          responsavel: e.resp||'',
          arquivada: e.feito,
          tipo: 'tarefa',
        });
      });
    });
    const ativas = [
      ...events.filter(e=>!e.arquivada && e.tipo === 'tarefa' && (_tf==='all'||(e.empresa||'').split(',').includes(_tf)) && (_tfc==='all'||(e.responsavel||'')===_tfc)),
      ...etapaEvents.filter(e=>!e.arquivada)
    ];
    const arquivadas = [
      ...events.filter(e=>e.arquivada && e.tipo === 'tarefa' && (_tf==='all'||(e.empresa||'').split(',').includes(_tf)) && (_tfc==='all'||(e.responsavel||'')===_tfc)),
      ...etapaEvents.filter(e=>e.arquivada)
    ];
  
    const EMP_BADGE = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
    const EMP_LABEL = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
  
    function tarefaRow(e, isArquivada) {
      const prazoColor = !isArquivada && e.data ? (() => {
        const diff = Math.round((new Date(e.data+'T00:00:00')-today)/86400000);
        return diff < 0 ? 'var(--danger)' : diff === 0 ? 'var(--gisella)' : diff <= 7 ? 'var(--warn)' : 'var(--text-soft)';
      })() : 'var(--text-soft)';
      const isEtapa = e._livroId !== undefined || e._conteudoId !== undefined;
      return `<tr style="${isArquivada?'opacity:0.5;':''}">
        <td onclick="event.stopPropagation();" style="width:44px;text-align:center;">
          <input type="checkbox" ${isArquivada?'checked':''}
              onclick="event.stopPropagation();"
              onchange="${e._conteudoId!==undefined?`toggleConteudoEtapa(${e._conteudoId},'${e._conteudoKey}')`:e._livroId!==undefined?`toggleEtapa(${e._livroId},${e._etapaIdx})`:`toggleTarefaArquivada(${e.id})`}"
              style="accent-color:var(--gisella);width:18px;height:18px;cursor:pointer;display:block;margin:0 auto;"
              title="${isArquivada?'Desmarcar':'Marcar como concluída'}">
        </td>
        <td style="font-weight:500;${!isArquivada && e._livroId !== undefined ? `color:${((e.empresa||'').split(',')[0]==='editora'?'var(--editora)':(e.empresa||'').split(',')[0]==='leia'?'var(--leia)':'var(--gisella)')};` : ''}${isArquivada?'text-decoration:line-through;color:var(--text-soft);':''}">
          <span>${e.titulo}</span>
          ${e.projetoId?`<span style="font-size:10px;color:var(--text-soft);display:block;">${(projetos.find(p=>p.id===e.projetoId)||{}).nome||''}</span>`:''}
          ${e._conteudoId!==undefined?`<button onclick="openConteudoEtapasPrazos(${e._conteudoId})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;margin-left:2px;" title="Ver prazos">📅</button>`:!e._livroId?`<button onclick="openEditEvent(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;margin-left:2px;" title="Editar">✎</button>`:`<button onclick="openEditEtapa(${e._livroId},${e._etapaIdx})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Editar">✎</button>`}
          ${e.urgente ? '<span title="Urgente" style="font-size:14px;vertical-align:middle;">❗</span>' : ''}
          ${!isEtapa?`<button onclick="event.stopPropagation();duplicarEvento(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Duplicar">⧉</button>`:''}
          ${!isEtapa && e.id ? `<button onclick="event.stopPropagation();deleteEventDirect(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;" title="Excluir">×</button>` : (e._livroId!==undefined ? `<button onclick="event.stopPropagation();deleteEtapa(${e._livroId},${e._etapaIdx})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;" title="Excluir">×</button>` : '')}
          ${!isEtapa ? comentarioBubble(e.id, e.comentarios) : ''}
        </td>
        <td>
          ${empBadgesHtml(e.empresa)}
          ${e.responsavel?`<span style="font-size:11px;font-weight:500;padding:1px 6px;border-radius:10px;display:inline-block;margin-top:2px;background:${e.responsavel==='Gisella'?'var(--gisella-bg)':e.responsavel==='Milena'?'var(--leia-bg)':'var(--editora-bg)'};color:#000;">${e.responsavel}</span>`:''}
        </td>
        <td style="font-size:12px;color:${prazoColor};font-weight:500;">${e.data?fmtDateTarefa(e.data):'—'}</td>
      </tr>`;
    }
  
    if (ativas.length===0 && arquivadas.length===0) {
      el.innerHTML='<div style="padding:2rem;text-align:center;color:var(--text-soft);">Nenhuma tarefa. Use o botão + para adicionar.</div>';
      return;
    }
  
    ativas.sort((a,b) => {
      const urgentDiff = Number(!!b.urgente) - Number(!!a.urgente);
      return urgentDiff || (a.data||'9').localeCompare(b.data||'9');
    });
    arquivadas.sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  
    // Calcular limites de semana corretamente (segunda a domingo)
    const dow = today.getDay(); // 0=dom,1=seg...6=sab
    // Fim desta semana = próximo domingo (ou hoje se for domingo)
    const daysToSunday = dow === 0 ? 0 : 7 - dow;
    const fimSemAtual = new Date(today); fimSemAtual.setDate(today.getDate() + daysToSunday);
    fimSemAtual.setHours(23,59,59,999);
    const fimSemAtualStr = fimSemAtual.toISOString().slice(0,10);
    // Fim da próxima semana
    const fimProxSem = new Date(fimSemAtual); fimProxSem.setDate(fimSemAtual.getDate() + 7);
    const fimProxSemStr = fimProxSem.toISOString().slice(0,10);
  
    // Separar atrasadas de hoje
    const groups = {urgentes:[], atrasadas:[], hoje:[], semana:[], proxSemana:[], proximas:[]};
    ativas.forEach(t=>{
      if (t.urgente) { groups.urgentes.push(t); return; }
      if (!t.data) { groups.proximas.push(t); return; }
      const diff = Math.round((new Date(t.data+'T00:00:00')-today)/86400000);
      if (diff < 0)                      groups.atrasadas.push(t);
      else if (diff === 0)               groups.hoje.push(t);
      else if (t.data <= fimSemAtualStr) groups.semana.push(t);
      else if (t.data <= fimProxSemStr)  groups.proxSemana.push(t);
      else                               groups.proximas.push(t);
    });
  
    // Arquivadas por grupo
    const arqGroups = {atrasadas:[], hoje:[], semana:[], proxSemana:[], proximas:[]};
    arquivadas.forEach(t=>{
      if (!t.data) { arqGroups.proximas.push(t); return; }
      const diff = Math.round((new Date(t.data+'T00:00:00')-today)/86400000);
      if (diff < 0)                      arqGroups.atrasadas.push(t);
      else if (diff === 0)               arqGroups.hoje.push(t);
      else if (t.data <= fimSemAtualStr) arqGroups.semana.push(t);
      else if (t.data <= fimProxSemStr)  arqGroups.proxSemana.push(t);
      else                               arqGroups.proximas.push(t);
    });
  
    function tableHtml(items, isArq) {
      return `<div class="table-wrap"><table><thead><tr><th style="width:40px;"></th><th>Tarefa</th><th>Empresa</th><th>Prazo</th></tr></thead>
      <tbody>${items.map(t=>tarefaRow(t,isArq||false)).join('')}</tbody></table></div>`;
    }
  
    function arqToggle(key, items) {
      if (!items.length) return '';
      const wasOpen = openGroups['arq-'+key];
      return `<div style="margin-top:6px;">
        <button class="archived-toggle" onclick="toggleTarefaGroup('arq-${key}')"><span id="tgrp-arrow-arq-${key}">${wasOpen?'▾':'▸'}</span> Concluídas (${items.length})</button>
        <div id="tgrp-arq-${key}" style="display:${wasOpen?'block':'none'};margin-top:6px;">${tableHtml(items,true)}</div>
      </div>`;
    }
  
    function renderGroup(label, items, color, key) {
      const total = items.length + (arqGroups[key]||[]).length;
      if (total === 0) return '';
      return `<div style="margin-bottom:1.5rem;">
        <div style="font-size:11px;font-weight:500;color:${color};text-transform:uppercase;letter-spacing:0.09em;margin-bottom:8px;">${label}${items.length ? ' · ' + items.length : ''}</div>
        ${items.length ? tableHtml(items,false) : ''}
        ${arqToggle(key, arqGroups[key]||[])}</div>`;
    }
  
    function renderGroupCollapsible(label, items, color, key) {
      const total = items.length + (arqGroups[key]||[]).length;
      if (total === 0) return '';
      const wasOpen = openGroups[key] !== undefined ? openGroups[key] : false;
      return `<div style="margin-bottom:1.5rem;">
        <button class="archived-toggle" style="color:${color};font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.09em;" onclick="toggleTarefaGroup('${key}')">
          <span id="tgrp-arrow-${key}">${wasOpen?'▾':'▸'}</span> ${label}${items.length ? ' · ' + items.length : ''}
        </button>
        <div id="tgrp-${key}" style="display:${wasOpen?'block':'none'};margin-top:8px;">
          ${items.length ? tableHtml(items,false) : ''}
          ${arqToggle(key, arqGroups[key]||[])}
        </div>
      </div>`;
    }
  
    let html = '';
    if (groups.urgentes.length > 0) {
      html += renderGroup(`❗ Urgentes · ${groups.urgentes.length}`, groups.urgentes, 'var(--danger)', 'urgentes');
    }
    if (groups.atrasadas.length > 0 || arqGroups.atrasadas.length > 0) {
      html += renderGroup(`⚠️ Atrasadas · ${groups.atrasadas.length}`, groups.atrasadas, 'var(--danger)', 'atrasadas');
    }
    html += renderGroup('Hoje', groups.hoje, 'var(--gisella)', 'hoje')
      + renderGroup('Esta semana', groups.semana, 'var(--warn)', 'semana')
      + renderGroupCollapsible('Próxima semana', groups.proxSemana, 'var(--text-mid)', 'proxSemana')
      + renderGroupCollapsible('Próximas', groups.proximas, 'var(--text-soft)', 'proximas');
  
    ['editora','leia','gisella'].forEach(emp => { if(document.getElementById('tarefas-empresa-'+emp)) buildTarefasEmpresa(emp); });
  
    el.innerHTML = html;
  }
  
  function toggleTarefaGroup(key) {
    const el = document.getElementById('tgrp-' + key);
    const arrow = document.getElementById('tgrp-arrow-' + key);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▾' : '▸';
    openGroups[key] = open; // persist state
  }
  
  function toggleTarefaArquivada(id) {
    const e = events.find(x=>x.id===id);
    if (!e) return;
    const wasArquivada = !!e.arquivada;
    e.arquivada = !e.arquivada;
    // Save via save() so _lastLocalSave is set (prevents echo from onSnapshot)
    save('gc-events', events);
    // Notification when completing
    if (!wasArquivada) {
      const userName = window._currentUserName || localStorage.getItem('gc-session-name') || '';
      if (typeof notifyTaskCompleted === 'function') notifyTaskCompleted(e.titulo, userName);
      // Open the completed sub-group so user sees where task went
      const today2 = new Date(); today2.setHours(0,0,0,0);
      const key = e.data
        ? (Math.round((new Date(e.data+'T00:00:00')-today2)/86400000) < 0 ? 'atrasadas'
          : Math.round((new Date(e.data+'T00:00:00')-today2)/86400000) === 0 ? 'hoje'
          : Math.round((new Date(e.data+'T00:00:00')-today2)/86400000) <= 7 ? 'semana' : 'proximas')
        : 'proximas';
      openGroups['arq-'+key] = true;
    }
    buildTarefas();
    buildColabTarefas();
    buildPrioridades();
    ['editora','leia','gisella'].forEach(emp => {
      if (document.getElementById('tarefas-empresa-'+emp)) buildTarefasEmpresa(emp);
    });
  }
  
  function toggleTarefasArquivadas() {
    const sec = document.getElementById('tarq-section');
    const arr = document.getElementById('tarq-arrow');
    if (!sec) return;
    const open = sec.style.display==='none';
    sec.style.display = open?'block':'none';
    arr.textContent = open?'▾':'▸';
  }
  
  /* ── DATE ── */
  const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const now = new Date();
  const dateEl = document.getElementById('today-date-text');
  if (dateEl) dateEl.textContent = `${DIAS[now.getDay()]}, ${now.getDate()} de ${MESES_PT[now.getMonth()]}`;
  
  // Alert counters
  // Alert counters (elements may not exist)
  try {
    const cntU = document.getElementById('cnt-urgentes');
    const cntA = document.getElementById('cnt-atencao');
    const cntM = document.getElementById('cnt-mentoradas');
    if (cntU) cntU.textContent = document.querySelectorAll('.alert-item.urgente').length;
    if (cntA) cntA.textContent = document.querySelectorAll('.alert-item.atencao').length;
    if (cntM) cntM.textContent = mentees.length;
  } catch(e) {}
  
  /* ── AUTOSAVE ── */
  let saveTimer;
  function autoSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      const el = document.getElementById('last-saved');
      if (el) { const t=new Date(); el.textContent=`salvo às ${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`; }
    }, 800);
  }
  document.addEventListener('input', autoSave);
  document.addEventListener('change', autoSave);
  
  /* ── FILTROS ── */
  const pageFilters = {};
  
  function setFilter(pageId, empresa, btn) {
    pageFilters[pageId] = empresa;
    // Update button styles
    const bar = document.getElementById('filter-bar-' + pageId);
    if (bar) bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // Rebuild relevant section
    if (pageId === 'tarefas') buildTarefas();
    if (pageId === 'eventos') { buildCalendar('cal-eventos', empresa); buildEventosList(); }
    if (pageId === 'conteudo-menu') {
      renderConteudos();
      const _wrap = document.getElementById('cal-conteudo-wrap');
      if (_wrap && _wrap.dataset.view === 'mes') buildCalendar('cal-conteudo', empresa);
      else buildConteudoCalSemana();
    }
    if (pageId === 'projetos') renderProjetos();
    if (pageId === 'livros') renderLivros();
  }
  
  function getFilter(pageId) { return pageFilters[pageId] || 'all'; }
  
  const pageFiltersColab = {};
  
  function setFilterColab(pageId, colab, btn) {
    pageFiltersColab[pageId] = colab;
    const bar = document.getElementById('filter-bar-' + pageId + '-colab');
    if (bar) bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (pageId === 'tarefas') buildTarefas();
  }
  
  function getFilterColab(pageId) { return pageFiltersColab[pageId] || 'all'; }
  
  function buildEventosList() {
    const today = new Date().toISOString().slice(0,10);
    const _ef = getFilter('eventos');
  
    // Eventos cadastrados no dash
    const evDash = events.filter(e => e.tipo === 'evento' && (_ef==='all'||(e.empresa||'').split(',').includes(_ef)));
  
    // Eventos do Google Calendar (Gisella + Léia)
    const gcalAll = [
      ...(window.gcalEventsCache||[]).map(ev => ({
        id: 'gcal-g-'+ev.start+'-'+(ev.title||'').slice(0,8).replace(/\s/g,''),
        titulo: ev.title||'(sem título)', empresa: 'gisella',
        data: ev.start, dataFim: ev.end||ev.start,
        startTime: ev.startTime, gcal: true, link: ev.link||''
      })),
      ...(gcalLeiaCache||[]).map(ev => ({
        id: 'gcal-l-'+ev.start+'-'+(ev.title||'').slice(0,8).replace(/\s/g,''),
        titulo: ev.title||'(sem título)', empresa: 'leia',
        data: ev.start, dataFim: ev.end||ev.start,
        startTime: ev.startTime, gcal: true, link: ev.link||''
      }))
    ].filter(e => _ef==='all' || e.empresa===_ef);
  
    // Merge e ordenar
    const evList = [...evDash, ...gcalAll];
    evList.sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  
    const proxEl = document.getElementById('eventos-lista-proximos');
    const passEl = document.getElementById('eventos-lista-passados');
    const el = document.getElementById('eventos-lista');
  
    function evRow(e) {
      const emp = (e.empresa||'editora').split(',')[0];
      const cor = emp==='editora'?'var(--editora)':emp==='leia'?'var(--leia)':'var(--gisella)';
      const label = emp==='editora'?'Editora':emp==='leia'?'Léia':'GC';
      const gcalBadge = e.gcal ? '<span style="font-size:9px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--text-soft);margin-left:4px;">Google Cal</span>' : '';
      const time = e.startTime ? ' · '+e.startTime : '';
      const actions = e.gcal
        ? (e.link ? '<a href="'+e.link+'" target="_blank" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;text-decoration:none;padding:0 4px;">↗</a>' : '')
        : '<button onclick="openEditEvent('+e.id+')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;">✎</button><button onclick="deleteEventDirect('+e.id+')" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;">×</button>';
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">' +
        '<div style="width:3px;min-height:32px;background:'+cor+';border-radius:2px;flex-shrink:0;'+(e.gcal?'opacity:0.6;':'')+'"></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:500;font-size:13px;">'+e.titulo+gcalBadge+'</div>' +
          '<div style="font-size:11px;color:var(--text-soft);">'+fmtDate(e.data||'')+(e.dataFim&&e.dataFim!==e.data?' – '+fmtDate(e.dataFim):'')+time+' · <span style="color:'+cor+';">'+label+'</span></div>' +
        '</div>' +
        actions +
      '</div>';
    }
  
    if (proxEl) {
      // Get current calendar month from CAL_STATE
      const calState = CAL_STATE['cal-eventos'] || {y: new Date().getFullYear(), m: new Date().getMonth()};
      const calY = calState.y, calM = calState.m;
      const mesInicio = calY + '-' + String(calM+1).padStart(2,'0') + '-01';
      const mesFim   = calY + '-' + String(calM+1).padStart(2,'0') + '-' + String(new Date(calY,calM+1,0).getDate()).padStart(2,'0');
      const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      // Update label
      const labelEl = document.getElementById('eventos-proximos-label');
      if (labelEl) labelEl.textContent = MESES_PT[calM] + ' ' + calY;
      // Filter proximos to current calendar month
      const proximos = evList.filter(e=>(e.data||'')>=mesInicio && (e.data||'')<=mesFim);
      // Passados: only from current calendar month, before today
      const passados = evList.filter(e=>(e.data||'')>=mesInicio && (e.data||'')<today && (e.data||'')<=mesFim).reverse().slice(0,20);
      proxEl.innerHTML = proximos.length ? proximos.map(evRow).join('') : '<div style="color:var(--text-soft);font-size:13px;padding:8px 0;">Nenhum evento em '+MESES_PT[calM]+'.</div>';
      if (passEl) passEl.innerHTML = passados.length ? passados.map(evRow).join('') : '<div style="color:var(--text-soft);font-size:13px;padding:8px 0;">Nenhum.</div>';
      return;
    }
    if (el) {
      if (evList.length === 0) { el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum evento cadastrado.</div>'; return; }
      el.innerHTML = evList.map(evRow).join('');
    }
  }
  
  
  /* ── PROJETOS ── */
  let projetos = load('gc-projetos', []);
  let currentProjetoEmpresa = null;
  let editingProjetoId = null;
  
  function openAddProjeto(emp) {
    editingProjetoId = null;
    currentProjetoEmpresa = emp;
    document.getElementById('mp-title').textContent = 'Novo projeto';
    document.getElementById('mp-nome').value = '';
    setEmpresasChecked('mp-emp-', emp || 'editora');
    document.getElementById('mp-status').value = 'pendente';
    document.getElementById('mp-resp').value = '';
    document.getElementById('mp-inicio').value = '';
    document.getElementById('mp-fim').value = '';
    document.getElementById('mp-observacao').value = '';
    document.getElementById('mp-delete-btn').style.display = 'none';
    openModal('modal-projeto');
    setTimeout(()=>document.getElementById('mp-nome').focus(), 50);
  }
  
  function submitProjeto() {
    const nome = document.getElementById('mp-nome').value.trim();
    if (!nome) { document.getElementById('mp-nome').focus(); return; }
    const data = {
      nome,
      empresa: getEmpresaStr('mp-emp-', 'editora'),
      status: document.getElementById('mp-status').value,
      responsavel: document.getElementById('mp-resp').value,
      inicio: document.getElementById('mp-inicio').value,
      fim: document.getElementById('mp-fim').value,
      observacao: document.getElementById('mp-observacao').value.trim(),
    };
    if (editingProjetoId) {
      const i = projetos.findIndex(x=>x.id===editingProjetoId);
      if (i>-1) projetos[i] = {...projetos[i], ...data};
    } else {
      projetos.push({id: Date.now(), tarefas: [], expandido: true, ...data});
    }
    save('gc-projetos', projetos);
    renderProjetos();
    closeModal('modal-projeto');
  }
  
  const ST_PROJ = {pendente:{l:'Pendente',c:'s-pendente'}, execucao:{l:'Em execução',c:'s-execucao'}, finalizado:{l:'Finalizado',c:'s-finalizado'}};
  const EMP_LABEL_P = {editora:'Editora Cassol', leia:'Léia Cassol', gisella:'GC Estratégias'};
  const EMP_BADGE_P = {editora:'b-editora', leia:'b-leia', gisella:'b-gisella'};
  
  function projetoHtml(p, showEmpresa) {
    const st = ST_PROJ[p.status] || {l:p.status, c:'b-gray'};
    const done = (p.tarefas||[]).filter(t=>t.feito).length;
    const total = (p.tarefas||[]).length;
    const today = new Date(); today.setHours(0,0,0,0);
  
    function projetoTarefaRow(t, i) {
      // Buscar o evento correspondente para pegar dados atualizados
      const ev = t.eventId ? events.find(x => x.id === t.eventId) : null;
      const data = ev ? ev.data : '';
      const resp = ev ? (ev.responsavel||'') : (t.resp||'');
      const isArq = t.feito;
      const prazoColor = !isArq && data ? (() => {
        const diff = Math.round((new Date(data+'T00:00:00')-today)/86400000);
        return diff < 0 ? 'var(--danger)' : diff === 0 ? 'var(--gisella)' : diff <= 7 ? 'var(--warn)' : 'var(--text-soft)';
      })() : 'var(--text-soft)';
      const respBg = resp==='Gisella'?'var(--gisella-bg)':resp==='Milena'?'var(--leia-bg)':'var(--editora-bg)';
      return `<div class="projeto-task-row" style="${isArq?'opacity:0.6;':''}">
        <input type="checkbox" ${isArq?'checked':''} onchange="toggleProjetoTask(${p.id},${i})" style="accent-color:var(--gisella);width:14px;height:14px;cursor:pointer;flex-shrink:0;">
        <span class="projeto-task-nome${isArq?' done':''}" style="flex:1;">
          ${t.nome}
          ${resp?`<span style="font-size:10px;font-weight:500;padding:1px 5px;border-radius:10px;margin-left:4px;background:${respBg};color:#000;">${resp}</span>`:''}
        </span>
        ${data?`<span style="font-size:11px;color:${prazoColor};font-weight:500;">${fmtDate(data)}</span>`:''}
        ${ev?`<button onclick="openEditEvent(${ev.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Editar">✎</button>`:''}
        <button onclick="deleteProjetoTask(${p.id},${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;" title="Excluir">×</button>
      </div>`;
    }
  
    const tarefasHtml = (p.tarefas||[]).map((t,i) => projetoTarefaRow(t,i)).join('');
    const infoHtml = (p.inicio||p.fim) ? `<div style="font-size:12px;color:var(--text-soft);padding:4px 0 8px;">${p.inicio?'Início: '+fmtDatePt(p.inicio):''}${p.inicio&&p.fim?' · ':''}${p.fim?'Fim: '+fmtDatePt(p.fim):''}</div>` : '';
  
    return `<div class="projeto-card" data-projeto-id="${p.id}">
      <div class="projeto-header" onclick="openProjetoPrazos(${p.id})" style="cursor:pointer;" title="Abrir tarefas e prazos do projeto">
        <div class="projeto-order-controls" aria-label="Reposicionar projeto" onclick="event.stopPropagation()">
          <button type="button" onclick="event.stopPropagation();moverProjeto(${p.id},-1)" title="Mover projeto para cima" aria-label="Mover ${p.nome} para cima">↑</button>
          <span class="projeto-drag-handle" title="Arraste para reposicionar" aria-hidden="true">⠿</span>
          <button type="button" onclick="event.stopPropagation();moverProjeto(${p.id},1)" title="Mover projeto para baixo" aria-label="Mover ${p.nome} para baixo">↓</button>
        </div>
        <div class="projeto-titulo" onclick="event.stopPropagation();openEditProjeto(${p.id})" style="cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-mid);" title="Abrir ficha do projeto">${p.nome}</div>
        ${showEmpresa ? empBadgesHtml(p.empresa) : ''}
        <span class="badge ${st.c}">${st.l}</span>
        ${total>0 ? `<span style="font-size:11px;color:var(--text-soft);">${done}/${total}</span>` : ''}
        <button onclick="event.stopPropagation();openProjetoPrazos(${p.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:2px 6px;" title="Definir prazos das tarefas">📅</button>
        <button onclick="event.stopPropagation();openEditProjeto(${p.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:2px 6px;" title="Editar">&#9998;</button>
        <button onclick="event.stopPropagation();duplicarProjeto(${p.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:2px 6px;" title="Duplicar">&#10697;</button>
        <button onclick="event.stopPropagation();deleteProjeto(${p.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:2px 6px;" title="Excluir">&#215;</button>
      </div>
      <div style="padding:0 16px 12px;">
        ${infoHtml}
        ${tarefasHtml}
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
          <button class="add-btn" onclick="openAddTarefaProjeto(${p.id})">+ adicionar tarefa</button>
          
        </div>
      </div>
    </div>`;
  }
  
  function renderProjetos() {
    const _pf = getFilter('projetos');
    const ativos = projetos.filter(p => p.status !== 'finalizado' && (_pf==='all'||(p.empresa||'').split(',').includes(_pf)));
    const finalizados = projetos.filter(p => p.status === 'finalizado' && (_pf==='all'||(p.empresa||'').split(',').includes(_pf)));
  
    // Visao geral
    const visaoEl = document.getElementById('projetos-visao');
    if (visaoEl) visaoEl.innerHTML = ativos.length===0
      ? '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum projeto.</div>'
      : ativos.map(p=>projetoHtml(p,true)).join('');
    if (visaoEl && ativos.length) setupProjetoReordering(visaoEl);
  
    // Todos page
    const todosEl = document.getElementById('projetos-todos');
    if (todosEl) todosEl.innerHTML = ativos.length===0
      ? '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum projeto.</div>'
      : ativos.map(p=>projetoHtml(p,true)).join('');
    if (todosEl && ativos.length) setupProjetoReordering(todosEl);
    const archTodosEl = document.getElementById('projetos-arquivados-todos');
    const archTodosCnt = document.getElementById('parq-count-todos');
    if (archTodosCnt) archTodosCnt.textContent = finalizados.length;
    if (archTodosEl) archTodosEl.innerHTML = finalizados.map(p=>projetoHtml(p,true)).join('');
  
    // Per company
    ['editora','leia','gisella'].forEach(emp => {
      const el = document.getElementById('projetos-'+emp);
      if (!el) return;
      const lista = ativos.filter(p=>(p.empresa||'').split(',').includes(emp));
      el.innerHTML = lista.length===0
        ? `<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhum projeto.</div>`
        : lista.map(p=>projetoHtml(p,false)).join('');
      if (lista.length) setupProjetoReordering(el);
      const archEl = document.getElementById('projetos-arquivados-'+emp);
      const cntEl = document.getElementById('parq-count-'+emp);
      const arch = finalizados.filter(p=>p.empresa===emp);
      if (cntEl) cntEl.textContent = arch.length;
      if (archEl) archEl.innerHTML = arch.map(p=>projetoHtml(p,false)).join('');
    });
  
    buildColabTarefas();
  }
  
  function getProjetosVisiveisAtivos() {
    const filtro = getFilter('projetos');
    return projetos.filter(p => p.status !== 'finalizado' && (filtro === 'all' || (p.empresa || '').split(',').includes(filtro)));
  }
  
  function salvarOrdemProjetos(idsOrdenados) {
    const porId = new Map(projetos.map(p => [String(p.id), p]));
    const idsVisiveis = new Set(idsOrdenados.map(String));
    const ordenados = idsOrdenados.map(id => porId.get(String(id))).filter(Boolean);
    let cursor = 0;
    projetos = projetos.map(p => idsVisiveis.has(String(p.id)) ? ordenados[cursor++] : p);
    save('gc-projetos', projetos);
    renderProjetos();
  }
  
  function moverProjeto(id, direcao) {
    const visiveis = getProjetosVisiveisAtivos();
    const atual = visiveis.findIndex(p => String(p.id) === String(id));
    const destino = atual + direcao;
    if (atual < 0 || destino < 0 || destino >= visiveis.length) return;
    [visiveis[atual], visiveis[destino]] = [visiveis[destino], visiveis[atual]];
    salvarOrdemProjetos(visiveis.map(p => p.id));
  }
  
  function setupProjetoReordering(container) {
    let dragged = null;
    const cards = [...container.querySelectorAll(':scope > .projeto-card')];
  
    cards.forEach(card => {
      const handle = card.querySelector('.projeto-drag-handle');
      if (!handle) return;
      handle.addEventListener('mousedown', () => card.setAttribute('draggable', 'true'));
      handle.addEventListener('touchstart', () => card.setAttribute('draggable', 'true'), {passive:true});
  
      card.addEventListener('dragstart', event => {
        dragged = card;
        card.classList.add('projeto-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.projetoId);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('projeto-dragging');
        card.removeAttribute('draggable');
        dragged = null;
        container.classList.remove('projeto-reordering');
      });
    });
  
    container.addEventListener('dragover', event => {
      if (!dragged) return;
      event.preventDefault();
      container.classList.add('projeto-reordering');
      const siblings = [...container.querySelectorAll(':scope > .projeto-card:not(.projeto-dragging)')];
      const next = siblings.find(card => event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2);
      if (next) container.insertBefore(dragged, next);
      else container.appendChild(dragged);
    });
    container.addEventListener('drop', event => {
      if (!dragged) return;
      event.preventDefault();
      salvarOrdemProjetos([...container.querySelectorAll(':scope > .projeto-card')].map(card => card.dataset.projetoId));
    });
  }
  
  function toggleProjeto(id) { const p=projetos.find(x=>x.id===id); if(p){p.expandido=!p.expandido; save('gc-projetos',projetos); renderProjetos();} }
  function deleteCurrentProjeto() {
    if (!editingProjetoId) return;
  
    projetos = projetos.filter(x => x.id !== editingProjetoId);
    save('gc-projetos', projetos);
    renderProjetos();
    closeModal('modal-projeto');
    editingProjetoId = null;
  }
  
  function deleteProjeto(id) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    const snap = [...projetos];
    projetos = projetos.filter(x=>x.id!==id);
    save('gc-projetos',projetos); renderProjetos();
    pushUndo(p.nome||'Projeto', ()=>{ projetos=snap; save('gc-projetos',projetos); renderProjetos(); });
  }
  
  function openEditProjeto(id) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    editingProjetoId = id;
    document.getElementById('mp-title').textContent = 'Editar projeto';
    document.getElementById('mp-nome').value = p.nome;
    setEmpresasChecked('mp-emp-', p.empresa || 'editora');
    document.getElementById('mp-status').value = p.status;
    document.getElementById('mp-resp').value = p.responsavel||'';
    document.getElementById('mp-inicio').value = p.inicio||'';
    document.getElementById('mp-fim').value = p.fim||'';
    document.getElementById('mp-observacao').value = p.observacao||'';
    document.getElementById('mp-delete-btn').style.display = 'inline-block';
    openModal('modal-projeto');
  }
  
  function openAddTarefaProjeto(projetoId) {
    const p = projetos.find(x => x.id === projetoId);
    if (!p) return;
    editingEventId = null;
    openQuickAdd();
    document.getElementById('qa-tipo').value = 'tarefa';
    updateQaFields();
    setEmpresasChecked('qa-emp-', p.empresa || 'editora');
    document.getElementById('qa-responsavel').value = p.responsavel || '';
    document.getElementById('qa-modal-title').textContent = 'Nova tarefa · ' + p.nome;
    window._addingToProjetoId = projetoId;
  }
  
  /* ── MODAL PRAZOS DAS TAREFAS DO PROJETO ── */
  let _ppProjetoId = null;
  let _ppDragIdx = null;
  
  function openProjetoPrazos(projetoId) {
    const p = projetos.find(x => x.id === projetoId);
    if (!p) return;
    _ppProjetoId = projetoId;
    document.getElementById('modal-pp-subtitulo').textContent = p.nome + ' — defina prazos e gerencie as tarefas';
    renderProjetoPrazosLista();
    openModal('modal-projeto-prazos');
  }
  
  function renderProjetoPrazosLista() {
    const p = projetos.find(x => x.id === _ppProjetoId);
    const el = document.getElementById('modal-pp-lista');
    if (!p || !el) return;
    const tarefas = (p.tarefas || []).map((t, i) => ({t, i}));
    tarefas.sort((a, b) => a.t.feito === b.t.feito ? 0 : (a.t.feito ? -1 : 1));
  
    el.innerHTML = tarefas.length ? tarefas.map(({t, i}) => {
      const ev = t.eventId ? events.find(x => x.id === t.eventId) : null;
      const prazo = ev ? (ev.data || '') : (t.prazo || '');
      const resp = ev ? (ev.responsavel || '') : (t.resp || '');
      const cor = t.feito ? 'var(--text-soft)' : (prazo ? (() => {
        const diff = Math.round((new Date(prazo + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        return diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--warn)' : 'var(--text)';
      })() : 'var(--text)');
      return `<div draggable="true" ondragstart="projetoPrazoDragStart(event,${i})" ondragover="event.preventDefault()" ondrop="projetoPrazoDrop(event,${i})"
        style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);${t.feito?'opacity:0.55;':''}">
        <span style="cursor:grab;color:var(--text-soft);font-size:12px;flex-shrink:0;">⠿</span>
        <input type="checkbox" ${t.feito?'checked':''} onchange="toggleProjetoTaskModal(${_ppProjetoId},${i})" style="accent-color:var(--gisella);width:16px;height:16px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;font-size:13px;color:${cor};${t.feito?'text-decoration:line-through;':''}">${t.nome}</span>
        <select onchange="updateProjetoTaskResp(${_ppProjetoId},${i},this.value)" style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:var(--text-soft);cursor:pointer;">
          <option value="" ${!resp?'selected':''}>—</option>
          <option value="Gisella" ${resp==='Gisella'?'selected':''}>Gisella</option>
          <option value="Milena" ${resp==='Milena'?'selected':''}>Milena</option>
          <option value="Luiggi" ${resp==='Luiggi'?'selected':''}>Luiggi</option>
        </select>
        <input type="date" value="${prazo}" onchange="updateProjetoTaskPrazo(${_ppProjetoId},${i},this.value)" style="font-size:12px;border:1px solid var(--border);border-radius:6px;padding:3px 6px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;width:130px;">
        <button onclick="deleteProjetoTaskModal(${_ppProjetoId},${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0 2px;" title="Excluir">×</button>
      </div>`;
    }).join('') : '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhuma tarefa neste projeto.</div>';
  }
  
  function addProjetoTaskModal() {
    const p = projetos.find(x => x.id === _ppProjetoId);
    const input = document.getElementById('pp-nova-tarefa');
    const nome = (input?.value || '').trim();
    if (!p || !nome) { input?.focus(); return; }
    if (!p.tarefas) p.tarefas = [];
    const taskId = Date.now();
    p.tarefas.push({nome, feito:false, resp:p.responsavel||'', eventId:taskId});
    events.push({id:taskId, empresa:p.empresa, titulo:nome, data:p.fim||'', tipo:'tarefa', projetoId:p.id, responsavel:p.responsavel||''});
    save('gc-projetos', projetos);
    save('gc-events', events);
    if (input) input.value = '';
    renderProjetoPrazosLista();
    renderProjetos();
    buildTarefas();
    buildColabTarefas();
  }
  
  function updateProjetoTaskPrazo(projetoId, idx, prazo) {
    const p = projetos.find(x => x.id === projetoId);
    const t = p?.tarefas?.[idx];
    if (!t) return;
    t.prazo = prazo;
    const ev = t.eventId ? events.find(x => x.id === t.eventId) : null;
    if (ev) ev.data = prazo;
    save('gc-projetos', projetos);
    save('gc-events', events);
    renderProjetos();
    buildTarefas();
    buildColabTarefas();
    renderProjetoPrazosLista();
  }
  
  function updateProjetoTaskResp(projetoId, idx, resp) {
    const p = projetos.find(x => x.id === projetoId);
    const t = p?.tarefas?.[idx];
    if (!t) return;
    t.resp = resp;
    const ev = t.eventId ? events.find(x => x.id === t.eventId) : null;
    if (ev) ev.responsavel = resp;
    save('gc-projetos', projetos);
    save('gc-events', events);
    renderProjetos();
    buildTarefas();
    buildColabTarefas();
  }
  
  function toggleProjetoTaskModal(projetoId, idx) {
    toggleProjetoTask(projetoId, idx);
    renderProjetoPrazosLista();
  }
  
  function deleteProjetoTaskModal(projetoId, idx) {
    deleteProjetoTask(projetoId, idx);
    renderProjetoPrazosLista();
  }
  
  function projetoPrazoDragStart(event, idx) {
    _ppDragIdx = idx;
    event.dataTransfer.effectAllowed = 'move';
  }
  
  function projetoPrazoDrop(event, destino) {
    event.preventDefault();
    const p = projetos.find(x => x.id === _ppProjetoId);
    if (!p || _ppDragIdx === null || _ppDragIdx === destino) return;
    const movida = p.tarefas.splice(_ppDragIdx, 1)[0];
    p.tarefas.splice(destino, 0, movida);
    _ppDragIdx = null;
    save('gc-projetos', projetos);
    renderProjetos();
    renderProjetoPrazosLista();
  }
  
  function addProjetoTask(id) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    const input = document.getElementById('ptask-'+id);
    const nome = input ? input.value.trim() : '';
    if (!nome) return;
    if (!p.tarefas) p.tarefas=[];
    const taskId = Date.now();
    p.tarefas.push({nome, feito:false, resp:'', eventId: taskId});
    // Add to events so it appears in tarefas section
    events.push({
      id: taskId, empresa: p.empresa,
      titulo: nome,
      data: p.fim||'', tipo: 'tarefa',
      projetoId: id, responsavel: p.responsavel||''
    });
    if (input) input.value='';
    save('gc-projetos', projetos);
    save('gc-events', events);
    buildTarefas();
    renderProjetos();
  }
  
  function toggleProjetoTask(id, i) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    p.tarefas[i].feito = !p.tarefas[i].feito;
    if (p.tarefas[i].eventId) {
      const ev = events.find(x => x.id === p.tarefas[i].eventId);
      if (ev) ev.arquivada = p.tarefas[i].feito;
      save('gc-events', events);
    }
    save('gc-projetos', projetos);
    renderProjetos();
    buildTarefas();
    buildColabTarefas();
    buildPrioridades();
  }
  
  function setProjetoTaskResp(id, i, resp) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    p.tarefas[i].resp = resp;
    save('gc-projetos',projetos); buildColabTarefas();
  }
  
  function deleteProjetoTask(id, i) {
    const p = projetos.find(x=>x.id===id);
    if (!p) return;
    const t = p.tarefas[i];
    if (t && t.eventId) {
      events = events.filter(x => x.id !== t.eventId);
      save('gc-events', events);
      buildTarefas();
    }
    p.tarefas.splice(i,1);
    save('gc-projetos', projetos); renderProjetos();
  }
  
  function toggleProjetosArquivados(emp) {
    const sec = document.getElementById('projetos-arquivados-'+emp);
    const arr = document.getElementById('parq-arrow-'+emp);
    if (!sec) return;
    sec.style.display = sec.style.display==='none' ? 'block' : 'none';
    arr.textContent = sec.style.display==='block' ? '▾' : '▸';
  }
  
  function toggleProjetosArquivadosTodos() {
    const sec = document.getElementById('projetos-arquivados-todos');
    const arr = document.getElementById('parq-arrow-todos');
    if (!sec) return;
    sec.style.display = sec.style.display==='none' ? 'block' : 'none';
    if (arr) arr.textContent = sec.style.display==='block' ? '▾' : '▸';
  }
  
  /* ── COLABORADORES ── */
  // Ordem manual das tarefas dos colaboradores
  let colabOrdem = load('gc-colab-ordem', {});
  
  var _colabCalOff = {};
  function _buildColabCal(key) {
    var wrap = document.getElementById('colab-cal-semana-' + key);
    if (!wrap) return;
    var cor = key==='gisella'?'var(--gisella)':key==='milena'?'var(--leia)':'var(--editora)';
    var off = _colabCalOff[key] || 0;
    var hoje = new Date(); hoje.setHours(0,0,0,0);
    var ini = new Date(hoje);
    var dw = hoje.getDay();
    ini.setDate(hoje.getDate() + (dw===0 ? -6 : 1-dw) + (off*7));
    var dias = Array.from({length:7}, function(_,i){var d=new Date(ini);d.setDate(ini.getDate()+i);return d;});
    var fim = dias[6];
    var meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    var dows  = ['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
    var hojeStr = hoje.toISOString().slice(0,10);
    var rangeLabel = ini.getDate()+' '+meses[ini.getMonth()] + (ini.getMonth()!==fim.getMonth()?' — '+fim.getDate()+' '+meses[fim.getMonth()]:'–'+fim.getDate());
  
    var allTarefas = events.filter(function(e){ return e.tipo==='tarefa' && e.responsavel && e.responsavel.toLowerCase()===key; })
      .map(function(e){ return {_isEtapa:false, id:e.id, titulo:e.titulo, empresa:e.empresa, data:e.data||'', arquivada:!!e.arquivada, urgente:!!e.urgente, tipoTarefa:e.tipoTarefa||''}; });
    livros.forEach(function(l){ (l.etapas||[]).forEach(function(e,i){
      if ((e.resp||'').toLowerCase()===key) {
        allTarefas.push({_isEtapa:true,livroId:l.id,etapaIdx:i,titulo:'['+l.titulo+'] '+e.nome,empresa:l.empresa,data:e.prazo||'',arquivada:!!e.feito,urgente:false,tipoTarefa:''});
      }
    }); });
    // Etapas de conteúdos
    conteudos.forEach(function(c){
      if (isConteudoFinalizado(c)) return;
      var etapas = getConteudoEtapasLiberadas(c);
      etapas.forEach(function(e){
        if ((e.resp||'').toLowerCase()===key && e.prazo) {
          allTarefas.push({_isEtapa:false,_conteudoId:c.id,_conteudoKey:e.key,id:'cont-'+c.id+'-'+e.key,titulo:'['+c.nome+'] '+e.nome,empresa:c.empresa,data:e.prazo,arquivada:!!e.feito,urgente:false,tipoTarefa:''});
        }
      });
    });
  
    var navHtml = '<div class="cal-header" style="padding:0 0 10px;border-bottom:none;">' +
      '<button class="cal-nav" data-k="'+key+'" data-d="-1" onclick="_colabCalOff[this.dataset.k]=(_colabCalOff[this.dataset.k]||0)+Number(this.dataset.d);_buildColabCal(this.dataset.k)">&#8249;</button>' +
      '<div class="cal-month">'+rangeLabel+'</div>' +
      '<button class="cal-nav" data-k="'+key+'" data-d="1" onclick="_colabCalOff[this.dataset.k]=(_colabCalOff[this.dataset.k]||0)+Number(this.dataset.d);_buildColabCal(this.dataset.k)">&#8250;</button>' +
      '</div>';
  
    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;align-items:start;">';
    dias.forEach(function(dia,idx){
      var ds = dia.toISOString().slice(0,10);
      var isT = ds===hojeStr;
      var dayT = _sortTipo(allTarefas.filter(function(t){return t.data===ds;}));
      html += '<div ondragover="event.preventDefault();this.style.background=\'var(--gisella-bg)\';" ondragleave="this.style.background=\'var(--surface)\';" ondrop="tarefaCalDrop(event,\''+ds+'\')" style="background:var(--surface);border-radius:10px;padding:8px;min-height:90px;border:1px solid '+(isT?cor:'var(--border)')+';transition:background 0.1s;">';
      html += '<div style="font-size:10px;color:var(--text-soft);text-transform:uppercase;margin-bottom:4px;">'+dows[idx]+'</div>';
      html += '<div style="font-size:'+(isT?'16px':'14px')+';font-weight:'+(isT?700:500)+';color:'+(isT?cor:'var(--text)')+';margin-bottom:6px;">'+dia.getDate()+'</div>';
      if (dayT.length===0) { html += '<div style="font-size:10px;color:var(--text-soft);opacity:0.5;">—</div>'; }
      dayT.forEach(function(t){
        var prE=(t.empresa||'').split(',')[0];
        var c=prE==='editora'?'var(--editora)':prE==='leia'?'var(--leia)':'var(--gisella)';
        var dragStart=t._isEtapa?'tarefaCalDragStart(event,\'etapa\','+t.livroId+','+t.etapaIdx+')':'tarefaCalDragStart(event,\'evento\','+t.id+',null)';
        var clickAct=t._isEtapa?'openEditEtapa('+t.livroId+','+t.etapaIdx+')':t._conteudoId?'openConteudoEtapasPrazos('+t._conteudoId+')':'openEditEvent('+t.id+')';
        var chk=t._isEtapa?'toggleEtapa('+t.livroId+','+t.etapaIdx+')':t._conteudoId?'toggleConteudoEtapa('+t._conteudoId+',\''+t._conteudoKey+'\')':'toggleTarefaArquivada('+t.id+')';
        html+='<div style="font-size:10px;padding:4px 6px;border-radius:4px;margin-bottom:3px;background:'+c+'15;color:'+c+';border-left:2px solid '+c+';'+(t.arquivada?'opacity:0.45;':'')+'display:flex;align-items:flex-start;gap:4px;">';
        html+='<input type="checkbox" '+(t.arquivada?'checked':'')+' onchange="'+chk+'" onclick="event.stopPropagation();" style="accent-color:'+c+';flex-shrink:0;margin-top:2px;width:11px;height:11px;cursor:pointer;">';
        html+='<div draggable="true" ondragstart="'+dragStart+'" onclick="'+clickAct+'" style="flex:1;min-width:0;cursor:pointer;">';
        html+='<span style="display:block;word-break:break-word;line-height:1.3;'+(t.arquivada?'text-decoration:line-through;':'')+'">'+( t.urgente?'❗ ':'')+(_TIPO_EMOJI[t.tipoTarefa]?_TIPO_EMOJI[t.tipoTarefa]+' ':'')+t.titulo+'</span>';
        html+='</div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    wrap.innerHTML = navHtml + html;
  }
  
  function buildColabTarefas() {
    const today = new Date(); today.setHours(0,0,0,0);
    const colabs = ['Gisella','Milena','Luiggi'];
    const EMP_BADGE = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
    const EMP_LABEL = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
  
    colabs.forEach(colab => {
      const el = document.getElementById('colab-tarefas-' + colab.toLowerCase());
      if (!el) return;
  
      const colabKey = colab.toLowerCase();
  
      const tasks = [];
  
      // Build set of eventIds already covered by events array (avoid duplicates)
      const coveredEventIds = new Set();
  
      // From events (primary source)
      events.filter(e => e.responsavel === colab && e.titulo).forEach(e => {
        coveredEventIds.add(e.id);
        tasks.push({id: e.id.toString(), titulo: e.titulo, empresa: e.empresa, data: e.data||'', responsavel: e.responsavel||'', projetoId: e.projetoId||null, arquivada: e.arquivada||false, urgente: e.urgente||false, gcalSource: !!(e.gcalKey || e.recurrenceTemplateId)});
      });
  
      // From livros (etapas not in events)
      livros.forEach(l => {
        l.etapas.forEach((e,i) => {
          const tid = `livro-${l.id}-${i}`;
          if (e.resp === colab && !e.feito) {
            tasks.push({id: tid, titulo: `[${l.titulo}] ${e.nome}`, empresa: l.empresa, data: e.prazo||'', responsavel: colab, arquivada: false, urgente: false});
          }
        });
      });
  
      // From conteudos (etapas as virtual tasks)
      conteudos.forEach(c => {
      if (isConteudoFinalizado(c)) return;
        const etapas = getConteudoEtapasLiberadas(c);
        etapas.forEach(e => {
          if (e.resp === colab) {
            const tid = `cont-${c.id}-${e.key}`;
            tasks.push({id: tid, titulo: `[${c.nome}] ${e.nome}`, empresa: c.empresa, data: e.prazo||'', responsavel: colab, arquivada: e.feito, urgente: false});
          }
        });
      });
  
      // From projetos — ONLY tasks without eventId (to avoid duplicates with events)
      projetos.forEach(p => {
        (p.tarefas||[]).forEach((t,i) => {
          if (t.eventId && coveredEventIds.has(t.eventId)) return; // already in events
          const tid = `proj-${p.id}-${i}`;
          if (t.resp === colab && !t.feito) {
            tasks.push({id: tid, titulo: `[${p.nome}] ${t.nome}`, empresa: p.empresa, data: p.fim||'', responsavel: colab, arquivada: false, urgente: false});
          }
        });
      });
  
      const ativas = tasks.filter(t => !t.arquivada);
      const arquivadas = tasks.filter(t => t.arquivada);
  
      // Ordenar: urgentes primeiro; depois atrasadas → hoje → futuras → sem data.
      ativas.sort((a,b) => {
        const urgentDiff = Number(!!b.urgente) - Number(!!a.urgente);
        if (urgentDiff !== 0) return urgentDiff;
        if (colab === 'Gisella') {
          const calendarDiff = Number(!!b.gcalSource) - Number(!!a.gcalSource);
          if (calendarDiff !== 0) return calendarDiff;
        }
        const da = a.data || '9999-99-99';
        const db = b.data || '9999-99-99';
        return da.localeCompare(db);
      });
  
      let colabDragSrc = null;
  
      function colabRow(t, isArq) {
        const prazoColor = !isArq && t.data ? (() => {
          const diff = Math.round((new Date(t.data+'T00:00:00')-today)/86400000);
          return diff < 0 ? 'var(--danger)' : diff === 0 ? 'var(--gisella)' : diff <= 7 ? 'var(--warn)' : 'var(--text-soft)';
        })() : 'var(--text-soft)';
        const numericId = parseInt(t.id);
        // Para tarefas de projeto, buscar eventId
        let editEventId = numericId;
        if (isNaN(numericId) && t.id && t.id.startsWith('proj-')) {
          const parts = t.id.split('-');
          const pId = parseInt(parts[1]);
          const tIdx = parseInt(parts[2]);
          const proj = projetos.find(x=>x.id===pId);
          if (proj && proj.tarefas && proj.tarefas[tIdx]) editEventId = proj.tarefas[tIdx].eventId;
        }
        const editBtn = editEventId ? `<button onclick="openEditEvent(${editEventId})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Editar">✎</button>` : '';
        const delBtn = editEventId && !isNaN(editEventId) ? `<button onclick="deleteEventDirect(${editEventId})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;" title="Excluir">×</button>` : '';
        return `<tr style="${isArq?'opacity:0.5;':''}"
          ${!isArq ? `draggable="true" ondragstart="colabTaskDragStart(event,'${t.id}','${colabKey}')" ondragover="event.preventDefault()" ondrop="colabTaskDrop(event,'${t.id}','${colabKey}')"` : ''}>
          <td onclick="event.stopPropagation();" style="width:44px;">
            <div style="display:flex;align-items:center;gap:4px;">
              ${!isArq ? '<span style="cursor:grab;color:var(--text-soft);font-size:12px;">⠿</span>' : ''}
              <input type="checkbox" ${isArq?'checked':''}
                onchange="toggleColabTarefaArq('${t.id}',this.checked,'${colabKey}')"
                style="accent-color:var(--gisella);width:16px;height:16px;cursor:pointer;">
            </div>
          </td>
          <td style="font-weight:500;${!isArq && String(t.id).startsWith('livro-') ? `color:${((t.empresa||'').split(',')[0]==='editora'?'var(--editora)':(t.empresa||'').split(',')[0]==='leia'?'var(--leia)':'var(--gisella)')};` : ''}${isArq?'text-decoration:line-through;color:var(--text-soft);':''}">
            ${t.urgente ? '<span title="Urgente" style="font-size:13px;vertical-align:middle;margin-right:3px;">❗</span>' : ''}${t.gcalSource ? '<span title="Vinda do Google Calendar" style="font-size:12px;vertical-align:middle;margin-right:4px;">📅</span>' : ''}${t.titulo}
            ${editBtn}${delBtn}
          </td>
          <td>
            ${empBadgesHtml(t.empresa)}
            ${t.responsavel?`<span style="font-size:11px;font-weight:500;padding:1px 6px;border-radius:10px;display:inline-block;margin-top:2px;background:${t.responsavel==='Gisella'?'var(--gisella-bg)':t.responsavel==='Milena'?'var(--leia-bg)':'var(--editora-bg)'};color:#000;">${t.responsavel}</span>`:''}
          </td>
          <td style="font-size:12px;color:${prazoColor};font-weight:500;">${t.data?fmtDateTarefa(t.data):'—'}</td>
        </tr>`;
      }
  
      let html = '';
      if (ativas.length === 0 && arquivadas.length === 0) {
        html = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">Nenhuma tarefa atribuída.</div>';
      } else {
        if (ativas.length > 0) {
          html += `<div class="table-wrap" style="margin-bottom:1rem;"><table>
            <thead><tr><th style="width:32px;"></th><th>Tarefa</th><th>Empresa</th><th>Prazo</th></tr></thead>
            <tbody id="colab-tbody-${colabKey}">${ativas.map(t=>colabRow(t,false)).join('')}</tbody>
          </table></div>`;
        } else {
          html += '<div style="padding:0.5rem 0 1rem;font-size:13px;color:var(--text-soft);">Nenhuma tarefa pendente.</div>';
        }
        if (arquivadas.length > 0) {
          html += `<button class="archived-toggle" onclick="toggleColabArq('${colabKey}')">
            <span id="colab-arq-arrow-${colabKey}">▸</span> Arquivadas (${arquivadas.length})
          </button>
          <div id="colab-arq-${colabKey}" style="display:none;margin-top:8px;">
            <div class="table-wrap"><table>
              <thead><tr><th style="width:32px;"></th><th>Tarefa</th><th>Empresa</th><th>Prazo</th></tr></thead>
              <tbody>${arquivadas.map(t=>colabRow(t,true)).join('')}</tbody>
            </table></div>
          </div>`;
        }
      }
      el.innerHTML = html;
    });
    // Build weekly calendars for each colab
    ['gisella','milena','luiggi'].forEach(function(k){ _buildColabCal(k); });
  }
  
  function colabTaskDragStart(event, taskId, colabKey) {
    event.dataTransfer.setData('text/plain', JSON.stringify({taskId, colabKey}));
    event.dataTransfer.effectAllowed = 'move';
  }
  
  function colabTaskDrop(event, targetId, colabKey) {
    event.preventDefault();
    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data.colabKey !== colabKey || data.taskId === targetId) return;
      // Reorder colabOrdem
      if (!colabOrdem[colabKey]) colabOrdem[colabKey] = [];
      const ordem = colabOrdem[colabKey];
      // Get current tasks for this colab to build full order
      const el = document.getElementById('colab-tarefas-' + colabKey);
      if (!el) return;
      const rows = el.querySelectorAll('tbody tr[draggable]');
      const ids = Array.from(rows).map(r => {
        const cb = r.querySelector('input[type=checkbox]');
        const onch = cb ? cb.getAttribute('onchange') : '';
        const m = onch ? onch.match(/'([^']+)'/) : null;
        return m ? m[1] : null;
      }).filter(Boolean);
      const fromIdx = ids.indexOf(data.taskId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, data.taskId);
      colabOrdem[colabKey] = ids;
      save('gc-colab-ordem', colabOrdem);
      buildColabTarefas();
    } catch(e) {}
  }
  
  function toggleColabArq(colabKey) {
    const sec = document.getElementById('colab-arq-' + colabKey);
    const arr = document.getElementById('colab-arq-arrow-' + colabKey);
    if (!sec) return;
    const open = sec.style.display === 'none';
    sec.style.display = open ? 'block' : 'none';
    arr.textContent = open ? '▾' : '▸';
  }
  
  function toggleColabTarefaArq(taskId, checked, colabKey) {
    // Event-based tasks
    const ev = events.find(x => x.id.toString() === taskId);
    if (ev) {
      ev.arquivada = checked;
      save('gc-events', events);
      buildColabTarefas();
      buildTarefas();
      buildPrioridades();
      return;
    }
    // Livro etapa tasks  (livro-{livroId}-{etapaIdx})
    if (taskId.startsWith('livro-')) {
      const parts = taskId.split('-');
      const livroId = parseInt(parts[1]);
      const etapaIdx = parseInt(parts[2]);
      const livro = livros.find(l => l.id === livroId);
      if (livro && livro.etapas && livro.etapas[etapaIdx] !== undefined) {
        livro.etapas[etapaIdx].feito = checked;
        save('gc-livros', livros);
        buildColabTarefas();
        buildTarefas();
        renderLivros();
      }
      return;
    }
      // Etapas de conteúdo  (cont-{conteudoId}-{etapa})
    if (taskId.startsWith('cont-')) {
      const parts = taskId.split('-');
      const conteudoId = parseInt(parts[1]);
      const etapaKey = parts.slice(2).join('-');
      const conteudo = conteudos.find(c => c.id === conteudoId);
  
      if (conteudo) {
        const jaConcluida = Boolean(conteudo.etapasStatus?.[etapaKey]?.feito);
        if (jaConcluida !== checked) {
          toggleConteudoEtapa(conteudoId, etapaKey);
        } else {
          buildColabTarefas();
        }
      }
      return;
    }
    // Projeto tasks  (proj-{projetoId}-{taskIdx})
    if (taskId.startsWith('proj-')) {
      const parts = taskId.split('-');
      const projetoId = parseInt(parts[1]);
      const taskIdx = parseInt(parts[2]);
      const proj = projetos.find(p => p.id === projetoId);
      if (proj && proj.tarefas && proj.tarefas[taskIdx] !== undefined) {
        proj.tarefas[taskIdx].feito = checked;
        if (proj.tarefas[taskIdx].eventId) {
          const ev2 = events.find(x => x.id === proj.tarefas[taskIdx].eventId);
          if (ev2) { ev2.arquivada = checked; save('gc-events', events); }
        }
        save('gc-projetos', projetos);
        buildColabTarefas();
        buildTarefas();
        renderProjetos();
      }
      return;
    }
    buildColabTarefas();
  }
  
  /* ── FERIADOS ── */
  const FERIADOS = [
    // Nacionais fixos
    '2026-01-01','2026-04-21','2026-05-01','2026-09-07','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25',
    '2025-01-01','2025-04-21','2025-05-01','2025-09-07','2025-10-12','2025-11-02','2025-11-15','2025-11-20','2025-12-25',
    // Nacionais móveis 2026
    '2026-02-16','2026-02-17','2026-04-03','2026-04-05',
    // Nacionais móveis 2025
    '2025-03-03','2025-03-04','2025-04-18','2025-04-20',
    // RS / Porto Alegre
    '2026-09-20', // Farroupilha
    '2025-09-20',
    '2026-11-02', // Finados POA
    '2026-08-09', // Revolução Farroupilha antecipado
  ];
  const FERIADOS_NOMES = {
    '01-01':'Confraternização Universal','04-21':'Tiradentes','05-01':'Dia do Trabalho',
    '09-07':'Independência do Brasil','10-12':'N. S. Aparecida','11-02':'Finados',
    '11-15':'Proclamação da República','11-20':'Consciência Negra','12-25':'Natal',
    '09-20':'Revolução Farroupilha (RS)',
  };
  
  function isFeriado(dateStr) {
    if (FERIADOS.includes(dateStr)) return true;
    const mmdd = dateStr.slice(5);
    return Object.keys(FERIADOS_NOMES).includes(mmdd);
  }
  
  function getFeriadoNome(dateStr) {
    if (FERIADOS_NOMES[dateStr.slice(5)]) return FERIADOS_NOMES[dateStr.slice(5)];
    return 'Feriado';
  }
  
  /* ── KANBAN ── */
  const DIAS_UTEIS = ['Seg','Ter','Qua','Qui','Sex'];
  
  function getWeekDays() {
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = today.getDay(); // 0=sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    return DIAS_UTEIS.map((label, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().slice(0,10);
      const isToday = d.getTime() === today.getTime();
      const dd = d.getDate();
      const mm = d.getMonth()+1;
      return {label, key, isToday, display: `${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}`};
    });
  }
  
  function buildKanban(colab) {
    const board = document.getElementById('kanban-' + colab);
    if (!board) return;
    const days = getWeekDays();
    const colabData = kanbanData[colab] || {};
    const EMP_B = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
    const EMP_S = {editora:'Editora',leia:'Léia',gisella:'GC'};
  
    board.innerHTML = days.map(day => {
      const tasks = (colabData[day.key] || []);
      const taskHtml = tasks.length === 0
        ? `<div class="kanban-drop-hint">solte aqui</div>`
        : tasks.map(t => `
            <div class="kanban-task" draggable="true"
              ondragstart="dragKanbanTask(event,'${colab}','${day.key}','${t.id}')"
              ondragend="dragEndKanban(event)">
              <div class="kanban-task-text">
                ${t.titulo}
                <span class="kanban-task-emp badge ${EMP_B[t.empresa]||'b-gray'}">${EMP_S[t.empresa]||t.empresa}</span>
              </div>
              <button class="kanban-return" onclick="returnFromKanban('${colab}','${day.key}','${t.id}')" title="Devolver à lista">↩</button>
            </div>`).join('');
  
      return `<div class="kanban-col${day.isToday?' today-col':''}"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="dropKanbanTask(event,'${colab}','${day.key}')">
        <div class="kanban-col-header">${day.label}<span class="kanban-col-date">${day.display}</span></div>
        ${taskHtml}
      </div>`;
    }).join('');
  }
  
  let draggedTask = null;
  
  function startDragFromList(event, taskId, titulo, empresa) {
    draggedTask = {taskObj: {id: taskId.toString(), titulo: titulo, empresa: empresa}};
    dragSource = 'list';
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId.toString());
  }
  let dragSource = null;
  
  function dragKanbanTask(event, colab, fromDay, taskId) {
    draggedTask = {colab, fromDay, taskId};
    dragSource = 'kanban';
    event.dataTransfer.effectAllowed = 'move';
  }
  
  function dragEndKanban(event) {
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  }
  
  function dropKanbanTask(event, colab, toDay) {
    event.preventDefault();
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  
    if (dragSource === 'list' && draggedTask) {
      const {taskObj} = draggedTask;
      if (!kanbanData[colab]) kanbanData[colab] = {};
      if (!kanbanData[colab][toDay]) kanbanData[colab][toDay] = [];
      const tid = taskObj.id.toString();
      // Avoid duplicates
      const already = Object.values(kanbanData[colab]).flat().some(t => t.id === tid);
      if (!already) {
        kanbanData[colab][toDay].push({id: tid, titulo: taskObj.titulo, empresa: taskObj.empresa});
        const ev = events.find(x => x.id.toString() === tid);
        if (ev) ev.kanbanDay = toDay;
        save('gc-events', events);
        save('gc-kanban', kanbanData);
      }
      buildKanban(colab);
      buildColabTarefas();
    } else if (dragSource === 'kanban' && draggedTask && draggedTask.colab === colab) {
      // Moving between days
      const {fromDay, taskId} = draggedTask;
      if (!kanbanData[colab]) return;
      const fromList = kanbanData[colab][fromDay] || [];
      const task = fromList.find(t => t.id === taskId);
      if (!task) return;
      kanbanData[colab][fromDay] = fromList.filter(t => t.id !== taskId);
      if (!kanbanData[colab][toDay]) kanbanData[colab][toDay] = [];
      kanbanData[colab][toDay].push(task);
      save('gc-kanban', kanbanData);
      buildKanban(colab);
    }
    draggedTask = null;
    dragSource = null;
  }
  
  function returnFromKanban(colab, day, taskId) {
    if (!kanbanData[colab] || !kanbanData[colab][day]) return;
    kanbanData[colab][day] = kanbanData[colab][day].filter(t => t.id !== taskId);
    // Remove kanbanDay from event
    const ev = events.find(x => x.id.toString() === taskId);
    if (ev) { delete ev.kanbanDay; save('gc-events', events); }
    save('gc-kanban', kanbanData);
    buildKanban(colab);
    buildColabTarefas();
  }
  
  function initKanban() {
    // Kanban removido das páginas de colaboradores
  }
  
  
  /* ── TIPO LIVRO ── */
  function updateLivroTipo() {
    const tipo = document.querySelector('input[name="qa-l-tipopub"]:checked');
    // Nenhum efeito extra necessário - os campos OS e ANO aparecem para ambos
  }
  
  function updateNlTipo() {
    // Nenhum efeito extra - OS e ANO aparecem para ambos
  }
  
  /* ── PRIORIDADES (VISÃO GERAL) ── */
  function buildPrioridades() {
    const el = document.getElementById('prioridades-container');
    if (!el) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0,10);
    const todayStr = today.toISOString().slice(0,10);
    const threeDaysAgo = new Date(today); threeDaysAgo.setDate(today.getDate() - 3);
  
    const day2Str = new Date(today.getTime() + 2*24*60*60*1000).toISOString().slice(0,10);
    // Tarefas: atrasadas + hoje + amanhã + em 2 dias (não feitas)
    const tarefasPrio = events.filter(e => {
      if (e.arquivada) return false;
      if (e.tipo !== 'tarefa') return false;
      if (!e.data) return false;
      return e.data <= day2Str; // atrasadas, hoje, amanhã, 2 dias
    });
  
    // Conteúdos pela DATA DE PRODUÇÃO: hoje e amanhã (não feitos)
    const conteudosPrio = conteudos.filter(c => {
      if (isConteudoFinalizado(c)) return false;
      if (!c.dataProd) return false;
      return c.dataProd === todayStr || c.dataProd === tomorrowStr;
    });
  
    // Arquivados: tarefas dos últimos 3 dias concluídas
    const tarefasArq = events.filter(e => {
      if (!e.arquivada) return false;
      if (e.tipo === 'evento' || e.tipo === 'projeto') return false;
      if (!e.data) return false;
      const d = new Date(e.data + 'T00:00:00');
      return d >= threeDaysAgo && d <= today;
    });
    // Conteúdos arquivados pela data de produção
    const conteudosArq = conteudos.filter(c => {
      if (!isConteudoFinalizado(c)) return false;
      if (!c.dataProd) return false;
      const d = new Date(c.dataProd + 'T00:00:00');
      return d >= threeDaysAgo && d <= today;
    });
  
    const EMP_BADGE = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
    const EMP_LABEL = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
  
    function tarefaRowPrio(e) {
      const prazoColor = e.data ? (() => {
        const diff = Math.round((new Date(e.data+'T00:00:00')-today)/86400000);
        return diff < 0 ? 'var(--danger)' : diff === 0 ? 'var(--gisella)' : 'var(--warn)';
      })() : 'var(--text-soft)';
      return `<tr>
        <td onclick="event.stopPropagation();" style="width:32px;">
          <input type="checkbox" onchange="toggleTarefaArquivada(${e.id})" style="accent-color:var(--gisella);width:14px;height:14px;cursor:pointer;">
        </td>
        <td style="font-weight:500;">
          ${e.titulo}
          <button onclick="openEditEvent(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;">✎</button>
          <button onclick="deleteEventDirect(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;">×</button>
        </td>
        <td><span class="badge ${EMP_BADGE[e.empresa]||'b-gray'}">${EMP_LABEL[e.empresa]||e.empresa}</span></td>
        <td style="font-size:12px;color:${prazoColor};font-weight:500;">${e.data?fmtDateTarefa(e.data):'—'}</td>
      </tr>`;
    }
  
    function conteudoRowPrio(c) {
      const prodColor = c.dataProd === todayStr ? 'var(--gisella)' : c.dataProd === tomorrowStr ? 'var(--warn)' : 'var(--text-soft)';
      const etapas = getConteudoEtapas(c);
      const concluidas = etapas.filter(etapa => etapa.feito).length;
      return `<tr onclick="openConteudo(${c.id})">
        <td style="width:32px;text-align:center;color:var(--text-soft);font-size:10px;">${concluidas}/${etapas.length}</td>
        <td style="font-weight:500;">${c.nome}
          <span style="font-size:10px;color:var(--text-soft);display:inline-block;margin-left:4px;">✍ conteúdo</span>
        </td>
        <td><span class="badge ${EMP_B[c.empresa]||'b-gray'}">${EMP_S[c.empresa]||c.empresa}</span></td>
        <td style="font-size:12px;color:${prodColor};font-weight:500;">${c.dataProd?'prod. '+fmtDate(c.dataProd):'—'}</td>
      </tr>`;
    }
  
    // Combinar tarefas + conteúdos, ordenar por data mais recente primeiro
    const allItems = [
      ...tarefasPrio.map(e => ({type:'tarefa', data:e.data, e})),
      ...conteudosPrio.map(c => ({type:'conteudo', data:c.dataProd, c}))
    ].sort((a,b) => (a.data||'9999').localeCompare(b.data||'9999'));
  
    if (allItems.length === 0) {
      el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-soft);font-size:13px;">✓ Nenhuma prioridade para hoje ou amanhã.</div>';
    } else {
      el.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th style="width:32px;"></th><th>Item</th><th>Empresa</th><th>Data</th></tr></thead>
        <tbody>${allItems.map(item => item.type==='tarefa' ? tarefaRowPrio(item.e) : conteudoRowPrio(item.c)).join('')}</tbody>
      </table></div>`;
    }
  
    // Arquivados
    const allArq = [
      ...tarefasArq.map(e => ({type:'tarefa', data:e.data, e})),
      ...conteudosArq.map(c => ({type:'conteudo', data:c.dataProd, c}))
    ].sort((a,b) => (a.data||'9999').localeCompare(b.data||'9999'));
  
    const arqBtn = document.getElementById('prio-arq-btn');
    const arqEl = document.getElementById('prioridades-arquivados');
    const arqCnt = document.getElementById('prio-arq-count');
    if (arqBtn) arqBtn.style.display = allArq.length > 0 ? 'flex' : 'none';
    if (arqCnt) arqCnt.textContent = allArq.length;
    if (arqEl && allArq.length > 0) {
      arqEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th style="width:32px;"></th><th>Item</th><th>Empresa</th><th>Data</th></tr></thead>
        <tbody>${allArq.map(item => {
          if (item.type === 'tarefa') {
            const e = item.e;
            const EMP_BADGE2 = {editora:'b-editora',leia:'b-leia',gisella:'b-gisella'};
            const EMP_LABEL2 = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
            return `<tr style="opacity:0.5;"><td onclick="event.stopPropagation();"><input type="checkbox" checked onchange="toggleTarefaArquivada(${e.id})" style="accent-color:var(--gisella);width:14px;height:14px;cursor:pointer;"></td><td style="font-weight:500;text-decoration:line-through;">${e.titulo}</td><td><span class="badge ${EMP_BADGE2[e.empresa]||'b-gray'}">${EMP_LABEL2[e.empresa]||e.empresa}</span></td><td style="font-size:12px;color:var(--text-soft);">${e.data?fmtDateTarefa(e.data):'—'}</td></tr>`;
          } else {
            const c = item.c;
            return `<tr style="opacity:0.5;" onclick="openConteudo(${c.id})"><td style="width:32px;text-align:center;color:var(--ok);">✓</td><td style="font-weight:500;text-decoration:line-through;">${c.nome} <span style="font-size:10px;color:var(--text-soft);">✍</span></td><td><span class="badge ${EMP_B[c.empresa]||'b-gray'}">${EMP_S[c.empresa]||c.empresa}</span></td><td style="font-size:12px;color:var(--text-soft);">${c.dataPost?fmtDate(c.dataPost):'—'}</td></tr>`;
          }
        }).join('')}</tbody>
      </table></div>`;
    }
  }
  
  function togglePrioridadesArquivadas() {
    const sec = document.getElementById('prioridades-arquivados');
    const arr = document.getElementById('prio-arq-arrow');
    if (!sec) return;
    const open = sec.style.display === 'none';
    sec.style.display = open ? 'block' : 'none';
    if (arr) arr.textContent = open ? '▾' : '▸';
  }
  
  /* ── LIVROS ARQUIVADOS (100%) ── */
  function toggleLivrosArquivados() {
    const wrap = document.getElementById('livros-arquivados-wrap');
    const arr = document.getElementById('livros-arq-arrow');
    if (!wrap) return;
    const open = wrap.style.display === 'none';
    wrap.style.display = open ? 'block' : 'none';
    if (arr) arr.textContent = open ? '▾' : '▸';
  }
  
  function toggleLivrosArquivadosVisao() {
    const wrap = document.getElementById('livros-visao-arquivados');
    const arr = document.getElementById('livros-visao-arq-arrow');
    if (!wrap) return;
    const open = wrap.style.display === 'none';
    wrap.style.display = open ? 'block' : 'none';
    if (arr) arr.textContent = open ? '▾' : '▸';
  }
  
  /* ── REORDENAR LIVROS (drag) ── */
  let livrosDragSrc = null;
  
  function livrosDragStart(e, id) {
    livrosDragSrc = id;
    e.dataTransfer.effectAllowed = 'move';
  }
  
  function livrosDragOver(e, id) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.livro-card').forEach(c=>c.classList.remove('drag-over-livro'));
    const card = e.currentTarget;
    if (card) card.classList.add('drag-over-livro');
  }
  
  function livrosDrop(e, id) {
    e.preventDefault();
    document.querySelectorAll('.livro-card').forEach(c=>c.classList.remove('drag-over-livro'));
    if (!livrosDragSrc || livrosDragSrc === id) return;
    const fromIdx = livros.findIndex(l => l.id === livrosDragSrc);
    const toIdx = livros.findIndex(l => l.id === id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = livros.splice(fromIdx, 1);
    livros.splice(toIdx, 0, moved);
    save('gc-livros', livros);
    renderLivros();
    livrosDragSrc = null;
  }
  
  
  
  /* ---- GOOGLE CALENDAR ---- */
  const GCAL_API_KEY       = 'AIzaSyBSQ7t6xtS6va7yaXMVvOKchCl1pkq_Whw';
  const GCAL_ID            = 'gcestrategiasliterarias@gmail.com';
  const GCAL_ID_LEIA       = 'assessorialeiacassol@gmail.com';
  // Agendas compartilhadas — Aceleração Mulher High Ticket e Advanced
  // ATENÇÃO: substitua os IDs abaixo pelos IDs reais das agendas compartilhadas
  // O ID fica em: Google Calendar → Configurações da agenda → Integrar agenda → ID da agenda
  const GCAL_SHARED_CALS = [
    { id: '1116bdbd4eeaffd1739e5e36020151faabaf15a8c2bd6a5b5472838d82e008bc@group.calendar.google.com', label: 'Aceleração', color: '#5a6272', bg: 'rgba(90,98,114,0.13)' },
    { id: 'c_3881641b8772cba2844122f540de939114ccd88a9feafa8b5636ac594216f114@group.calendar.google.com', label: 'Advanced',   color: '#5a6272', bg: 'rgba(90,98,114,0.13)'  },
  ];
  let gcalSharedCache = []; // cache mesclado das agendas compartilhadas
  
  // Semana atual: domingo da semana corrente
  const GCAL_MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                           'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const GCAL_DAYS_PT   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  let gcalWeekStart = (function() {
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay()); // vai para domingo
    return d;
  })();
  let gcalEvents = [];
  
  function mapGcalItems(items, calLabel) {
    return (items || []).map(ev => {
      const start     = ev.start.dateTime ? ev.start.dateTime.slice(0,10) : ev.start.date;
      const end       = ev.end.dateTime   ? ev.end.dateTime.slice(0,10)   : ev.end.date;
      const startTime = ev.start.dateTime ? ev.start.dateTime.slice(11,16) : null;
      const endTime   = ev.end.dateTime   ? ev.end.dateTime.slice(11,16)   : null;
      return { title: ev.summary||'(sem título)', start, end, startTime, endTime,
               description: ev.description||'', location: ev.location||'',
               link: ev.htmlLink||'', calLabel: calLabel||null };
    });
  }
  
  async function fetchGcalRange(calId, rangeStart, rangeEnd) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`
      + `?key=${GCAL_API_KEY}&timeMin=${rangeStart.toISOString()}&timeMax=${rangeEnd.toISOString()}`
      + `&singleEvents=true&orderBy=startTime&maxResults=250`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.items || [];
  }
  
  async function loadGcal() {
    const el = document.getElementById('gcal-container');
    if (!el) return;
    el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-soft);font-size:13px;">Carregando...</div>';
  
    const weekEnd = new Date(gcalWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23,59,59);
  
    // Busca um ano à frente para que recorrências vinculadas a mentorias sejam
    // criadas mesmo quando o evento foi agendado com bastante antecedência.
    const rangeStart = new Date(); rangeStart.setMonth(rangeStart.getMonth() - 2); rangeStart.setDate(1);
    const rangeEnd   = new Date(); rangeEnd.setMonth(rangeEnd.getMonth() + 12); rangeEnd.setDate(1);
  
    try {
      // Buscar agenda principal + agendas compartilhadas em paralelo
      const fetchPromises = [
        fetchGcalRange(GCAL_ID, rangeStart, rangeEnd),
        ...GCAL_SHARED_CALS.map(cal => fetchGcalRange(cal.id, rangeStart, rangeEnd).catch(() => null)),
      ];
      const results = await Promise.all(fetchPromises);
  
      if (!results[0]) {
        el.innerHTML = '<div style="padding:1rem;color:var(--danger);font-size:13px;">Erro ao carregar agenda GC. Verifique se o calendário está público e a API Key está correta.</div>';
        return;
      }
  
      // Mapear agenda principal
      const mapped = mapGcalItems(results[0], null);
  
      // Mapear agendas compartilhadas e mesclar
      gcalSharedCache = [];
      GCAL_SHARED_CALS.forEach((cal, idx) => {
        const items = results[idx + 1];
        if (items) {
          const sharedMapped = mapGcalItems(items, cal.label).map(ev => ({
            ...ev, _sharedCal: cal,
          }));
          gcalSharedCache = gcalSharedCache.concat(sharedMapped);
        }
      });
  
      // Cache global = principal + compartilhadas (para calendário mensal e semanal)
      window.gcalEventsCache = [...mapped, ...gcalSharedCache];
      gcalEvents = window.gcalEventsCache.filter(ev =>
        ev.start >= gcalWeekStart.toISOString().slice(0,10) &&
        ev.start <= weekEnd.toISOString().slice(0,10));
  
  
  
      // Atualizar todos os calendários da GC em tempo real
      refreshCalendars();
      renderGcal();
      countMentoriasmes();
      countMentoriasSemana();
      limparTarefasEventosRemovidos(mapped);
      criarTarefasEventos(mapped);
      ensureCustomRecurringTasks(window.gcalEventsCache);
  
    } catch(e) {
      el.innerHTML = `<div style="padding:1rem;color:var(--danger);font-size:13px;">Erro de rede: ${e.message}</div>`;
    }
  }
  
  function renderGcal() {
    const el = document.getElementById('gcal-container');
    const lbl = document.getElementById('gcal-month-label');
    if (!el) return;
  
    // Label
    const weekEnd = new Date(gcalWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    const fmt = d => d.toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
    const fmtShort = d => d.toLocaleDateString('pt-BR', {day:'2-digit', month:'long'});
    if (lbl) {
      const sameMonth = gcalWeekStart.getMonth() === weekEnd.getMonth();
      lbl.textContent = sameMonth
        ? `${gcalWeekStart.getDate()} – ${fmt(weekEnd)}`
        : `${fmtShort(gcalWeekStart)} – ${fmt(weekEnd)}`;
    }
  
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().slice(0,10);
    const nowMin = today <= new Date() ? new Date().getHours()*60 + new Date().getMinutes() : -1;
  
    const HOUR_START = 9;
    const HOUR_END   = 22;
    const TOTAL_HOURS = HOUR_END - HOUR_START; // 13 hours
    const HOUR_PX = 48; // px per hour — altura fixa sem scroll
    const TOTAL_PX = TOTAL_HOURS * HOUR_PX;
  
    // Separate timed events from all-day events
    const allDayByDay = {};
    const timedByDay  = {};
    gcalEvents.forEach(ev => {
      if (!ev.startTime) {
        // all-day: spread across days
        let cur = new Date(ev.start + 'T12:00:00');
        const endD = new Date((ev.end || ev.start) + 'T12:00:00');
        while (cur <= endD) {
          const ds = cur.toISOString().slice(0,10);
          if (!allDayByDay[ds]) allDayByDay[ds] = [];
          allDayByDay[ds].push(ev);
          cur.setDate(cur.getDate()+1);
        }
      } else {
        const ds = ev.start;
        if (!timedByDay[ds]) timedByDay[ds] = [];
        timedByDay[ds].push(ev);
      }
    });
  
    // Build days array
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(gcalWeekStart); d.setDate(d.getDate() + i);
      days.push(d);
    }
  
    // ── OUTER WRAPPER ──
    let out = `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface);">`;
  
    // ── DAY HEADERS ──
    out += `<div style="display:grid;grid-template-columns:44px repeat(7,1fr);border-bottom:1px solid var(--border);">`;
    out += `<div style="background:var(--surface);"></div>`;
    days.forEach(day => {
      const ds = day.toISOString().slice(0,10);
      const isToday = ds === todayStr;
      const adEvs = allDayByDay[ds] || [];
      out += `<div style="padding:6px 4px;text-align:center;border-left:1px solid var(--border);background:${isToday?'var(--gisella-bg)':'var(--surface)'};">
        <div style="font-size:10px;color:var(--text-soft);font-weight:500;">${GCAL_DAYS_PT[day.getDay()]}</div>
        <div style="font-size:${isToday?'18px':'15px'};font-weight:${isToday?'700':'400'};color:${isToday?'var(--gisella)':'var(--text)'};">${day.getDate()}</div>
        <div style="font-size:9px;color:var(--text-soft);">${GCAL_MONTHS_PT[day.getMonth()].slice(0,3)}</div>
        ${adEvs.map(ev=>{const _ec=ev._sharedCal;const _col=_ec?_ec.color:'var(--gisella)';const _bg=_ec?_ec.bg:'var(--gisella-bg)';return `<div onclick="openGcalEvent(gcalEvents[${gcalEvents.indexOf(ev)}])" style="background:${_bg};color:${_col};border-radius:3px;padding:1px 4px;margin-top:2px;font-size:9px;font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;" title="${ev.title}${_ec?' ['+_ec.label+']':''}">${_ec?_ec.label+' · ':''}${ev.title}</div>`;}).join('')}
      </div>`;
    });
    out += `</div>`;
  
    // ── SCROLLABLE TIME GRID ──
    out += `<div style="position:relative;">`;
    out += `<div style="display:grid;grid-template-columns:44px repeat(7,1fr);position:relative;">`;
  
    // Hour labels column
    out += `<div style="position:relative;height:${TOTAL_PX}px;">`;
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const top = (h - HOUR_START) * HOUR_PX;
      out += `<div style="position:absolute;top:${top}px;left:0;right:0;font-size:9px;color:var(--text-soft);padding-right:4px;text-align:right;transform:translateY(-6px);">${String(h).padStart(2,'0')}:00</div>`;
    }
    out += `</div>`;
  
    // Day columns
    days.forEach(day => {
      const ds = day.toISOString().slice(0,10);
      const isToday = ds === todayStr;
      const tevs = timedByDay[ds] || [];
  
      out += `<div style="border-left:1px solid var(--border);position:relative;height:${TOTAL_PX}px;background:${isToday?'rgba(26,107,74,0.03)':'var(--surface)'};">`;
  
      // Hour grid lines
      for (let h = HOUR_START; h <= HOUR_END; h++) {
        const top = (h - HOUR_START) * HOUR_PX;
        out += `<div style="position:absolute;top:${top}px;left:0;right:0;border-top:1px solid var(--border);"></div>`;
        if (h < HOUR_END) {
          const halfTop = top + HOUR_PX/2;
          out += `<div style="position:absolute;top:${halfTop}px;left:0;right:0;border-top:1px dashed var(--border);opacity:0.5;"></div>`;
        }
      }
  
      // Current time line
      if (isToday) {
        const now = new Date();
        const nowTotalMin = now.getHours()*60 + now.getMinutes();
        const startMin = HOUR_START * 60;
        const endMin = HOUR_END * 60;
        if (nowTotalMin >= startMin && nowTotalMin <= endMin) {
          const pct = (nowTotalMin - startMin) / ((HOUR_END - HOUR_START) * 60);
          const topPx = Math.round(pct * TOTAL_PX);
          out += `<div style="position:absolute;top:${topPx}px;left:0;right:0;border-top:2px solid var(--gisella);z-index:3;">
            <div style="position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:var(--gisella);"></div>
          </div>`;
        }
      }
  
      // Timed events
      tevs.forEach(ev => {
        if (!ev.startTime) return;
        const [sh, sm] = ev.startTime.split(':').map(Number);
        const [eh, em] = ev.endTime ? ev.endTime.split(':').map(Number) : [sh+1, sm];
        const startMin = sh*60 + sm;
        const endMin   = eh*60 + em;
        const startPx  = Math.max(0, (startMin - HOUR_START*60) / 60 * HOUR_PX);
        const heightPx = Math.max(20, (endMin - startMin) / 60 * HOUR_PX - 2);
  
        if (startMin < HOUR_START*60 || startMin > HOUR_END*60) return;
  
        const evIdx = gcalEvents.indexOf(ev);
        const _sc = ev._sharedCal;
        const _evColor = _sc ? _sc.color : 'var(--gisella)';
        const _evBg    = _sc ? _sc.bg    : 'var(--gisella-bg)';
        const _labelPfx = _sc ? `<span style="font-size:8px;font-weight:700;opacity:0.85;">${_sc.label} · </span>` : '';
        out += `<div onclick="openGcalEvent(gcalEvents[${evIdx}])" title="${ev.title}${_sc?' ['+_sc.label+']':''}" style="
          position:absolute;top:${startPx}px;left:2px;right:2px;height:${heightPx}px;
          background:${_evBg};color:${_evColor};
          border-left:3px solid ${_evColor};
          border-radius:4px;padding:2px 4px;
          font-size:10px;font-weight:500;
          overflow:hidden;z-index:2;cursor:pointer;
          box-sizing:border-box;transition:filter 0.1s;"
          onmouseover="this.style.filter='brightness(0.92)'"
          onmouseout="this.style.filter=''">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_labelPfx}${ev.title}</div>
          <div style="font-size:9px;opacity:0.75;">${ev.startTime}${ev.endTime?' – '+ev.endTime:''}</div>
        </div>`;
      });
  
      out += `</div>`;
    });
  
    out += `</div></div></div>`;
    el.innerHTML = out;
  
    // Sem scroll — altura fixa
  }
  
  function gcalPrevMonth() {
    gcalWeekStart = new Date(gcalWeekStart);
    gcalWeekStart.setDate(gcalWeekStart.getDate() - 7);
    const weekEnd = new Date(gcalWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    gcalEvents = (window.gcalEventsCache || []).filter(ev =>
      ev.start >= gcalWeekStart.toISOString().slice(0,10) &&
      ev.start <= weekEnd.toISOString().slice(0,10));
    renderGcal();
  }
  
  function gcalNextMonth() {
    gcalWeekStart = new Date(gcalWeekStart);
    gcalWeekStart.setDate(gcalWeekStart.getDate() + 7);
    const weekEnd = new Date(gcalWeekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    gcalEvents = (window.gcalEventsCache || []).filter(ev =>
      ev.start >= gcalWeekStart.toISOString().slice(0,10) &&
      ev.start <= weekEnd.toISOString().slice(0,10));
    renderGcal();
  }
  
  function openGcalEvent(ev) {
    document.getElementById('gcal-modal-title').textContent = ev.title;
    const fmt = ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('pt-BR', {weekday:'long', day:'2-digit', month:'long', year:'numeric'}) : '';
    let rows = '';
  
    if (ev.startTime) {
      // Timed event
      const dateFmt = fmt(ev.start);
      const timeStr = ev.startTime + (ev.endTime ? ' – ' + ev.endTime : '');
      rows += `<div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:16px;">🕐</span>
        <div><div style="font-weight:500;">${dateFmt}</div><div style="color:var(--text-soft);">${timeStr}</div></div>
      </div>`;
    } else {
      // All-day (possibly multi-day)
      const startFmt = fmt(ev.start);
      const endFmt   = ev.end && ev.end !== ev.start ? fmt(ev.end) : null;
      rows += `<div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:16px;">📅</span>
        <div><div style="font-weight:500;">${startFmt}</div>${endFmt?`<div style="color:var(--text-soft);">até ${endFmt}</div>`:''}</div>
      </div>`;
    }
  
    if (ev.description) {
      rows += `<div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:16px;">📝</span>
        <div style="color:var(--text-soft);white-space:pre-wrap;">${ev.description}</div>
      </div>`;
    }
  
    if (ev.location) {
      rows += `<div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:16px;">📍</span>
        <div>${ev.location}</div>
      </div>`;
    }
  
    if (ev.link) {
      rows += `<div style="margin-top:8px;">
        <a href="${ev.link}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gisella-bg);color:var(--gisella);border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;border:1px solid var(--gisella-border);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Abrir no Google Calendar
        </a>
      </div>`;
    }
  
    document.getElementById('gcal-modal-body').innerHTML = rows;
    openModal('modal-gcal-event');
  }
  
  /* ---- FIM GOOGLE CALENDAR ---- */
  
  
  
  /* ── TAREFAS POR EMPRESA ── */
  function buildTarefasEmpresa(emp) {
    const el = document.getElementById('tarefas-empresa-' + emp);
    if (!el) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const fimSemana = new Date(today.getTime() + 7*24*60*60*1000);
    const fimSemanaStr = fimSemana.toISOString().slice(0,10);
    const todayStr = today.toISOString().slice(0,10);
  
    const etapaEvents = [];
    livros.forEach(l => {
      (l.etapas||[]).forEach((e,i) => {
        if (!(l.empresa||'').split(',').includes(emp)) return;
        etapaEvents.push({
          id: `livro-${l.id}-${i}`, _livroId: l.id, _etapaIdx: i,
          titulo: `[${l.titulo}] ${e.nome}`, empresa: l.empresa,
          data: e.prazo||'', responsavel: e.resp||'',
          arquivada: e.feito, tipo: 'tarefa',
        });
      });
    });
  
    // Só mostra: atrasadas + esta semana (COM data). Sem data e futuras ficam só na aba Tarefas.
    const todasAtivas = [
      ...events.filter(e => !e.arquivada && e.tipo==='tarefa' && (e.empresa||'').split(',').includes(emp)),
      ...etapaEvents.filter(e => !e.arquivada)
    ].filter(e => e.data && e.data <= fimSemanaStr);
  
    const todasArquivadas = [
      ...events.filter(e => e.arquivada && e.tipo==='tarefa' && (e.empresa||'').split(',').includes(emp)),
      ...etapaEvents.filter(e => e.arquivada)
    ].filter(e => e.data && e.data <= fimSemanaStr);
  
    const _todayEmp = today.toISOString().slice(0,10);
    todasAtivas.sort((a,b) => {
      const da = a.data || '9999-99-99';
      const db = b.data || '9999-99-99';
      return da.localeCompare(db);
    });
  
    const cor = emp==='editora' ? 'var(--editora)' : emp==='leia' ? 'var(--leia)' : 'var(--gisella)';
  
    function tarefaRowEmp(e, isArq) {
      const prazoColor = !isArq && e.data ? (() => {
        const diff = Math.round((new Date(e.data+'T00:00:00')-today)/86400000);
        return diff<0 ? 'var(--danger)' : diff===0 ? cor : diff<=7 ? 'var(--warn)' : 'var(--text-soft)';
      })() : 'var(--text-soft)';
      return `<tr style="${isArq?'opacity:0.5;':''}">
        <td style="width:44px;text-align:center;" onclick="event.stopPropagation();">
          <input type="checkbox" ${isArq?'checked':''}
              onclick="event.stopPropagation();"
              onchange="${e._livroId!==undefined?`toggleEtapa(${e._livroId},${e._etapaIdx})`:`toggleTarefaArquivada(${e.id})`}"
              style="accent-color:${cor};width:18px;height:18px;cursor:pointer;display:block;margin:0 auto;">
        </td>
        <td style="font-weight:500;${isArq?'text-decoration:line-through;color:var(--text-soft);':''}">
          ${e.urgente ? '<span title="Urgente" style="font-size:13px;vertical-align:middle;margin-right:3px;">❗</span>' : ''}${e.titulo}
          ${!e._livroId?`<button onclick="openEditEvent(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Editar">✎</button>`:`<button onclick="openEditEtapa(${e._livroId},${e._etapaIdx})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:12px;padding:1px 4px;" title="Editar">✎</button>`}
          ${!e._livroId && e.id ? `<button onclick="event.stopPropagation();deleteEventDirect(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:1px 4px;" title="Excluir">×</button>` : ''}
          ${!e._livroId ? comentarioBubble(e.id, e.comentarios) : ''}
        </td>
        <td style="font-size:12px;color:${prazoColor};font-weight:500;">${e.data?fmtDateTarefa(e.data):'—'}</td>
        <td>${e.responsavel?`<span style="font-size:11px;padding:1px 6px;border-radius:10px;background:var(--bg);color:var(--text-mid);">${e.responsavel}</span>`:''}</td>
      </tr>`;
    }
  
    if (todasAtivas.length === 0) {
      el.innerHTML='<div style="padding:1rem 0;color:var(--text-soft);font-size:13px;">✓ Nenhuma tarefa para esta semana.</div>';
      return;
    }
  
    // Mostrar só as 3 primeiras, resto expandível
    const visiveis = todasAtivas.slice(0, 3);
    const extras   = todasAtivas.slice(3);
  
    function tabelaHtml(items) {
      return `<div class="table-wrap"><table><thead><tr><th style="width:32px;"></th><th>Tarefa</th><th>Prazo</th><th>Responsável</th></tr></thead><tbody>${items.map(t=>tarefaRowEmp(t,false)).join('')}</tbody></table></div>`;
    }
  
    let html = tabelaHtml(visiveis);
  
    if (extras.length > 0) {
      html += `<button class="archived-toggle" onclick="toggleTarefasEmpExtras('${emp}')">
        <span id="tarq-emp-extras-arrow-${emp}">▸</span> Ver mais esta semana (${extras.length})
      </button>
      <div id="tarq-emp-extras-${emp}" style="display:none;margin-top:6px;">${tabelaHtml(extras)}</div>`;
    }
  
    if (todasArquivadas.length > 0) {
      html += `<div style="margin-top:6px;">
        <button class="archived-toggle" onclick="toggleTarefasEmpArq('${emp}')"><span id="tarq-emp-arrow-${emp}">▸</span> Concluídas (${todasArquivadas.length})</button>
        <div id="tarq-emp-arq-${emp}" style="display:none;margin-top:6px;">${tabelaHtml(todasArquivadas)}</div>
      </div>`;
    }
  
    el.innerHTML = html;
  }
  
  function toggleTarefasEmpArq(emp) {
    const el = document.getElementById('tarq-emp-arq-' + emp);
    const arrow = document.getElementById('tarq-emp-arrow-' + emp);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▾' : '▸';
  }
  
  function toggleTarefasEmpExtras(emp) {
    const el = document.getElementById('tarq-emp-extras-' + emp);
    const arrow = document.getElementById('tarq-emp-extras-arrow-' + emp);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▾' : '▸';
  }
  
  /* ── MODAL PRAZOS ETAPAS ── */
  let _epLivroId = null;
  function openEtapasPrazos(livroId) {
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    _epLivroId = livroId;
    const el = document.getElementById('modal-ep-lista');
    const sub = document.getElementById('modal-ep-subtitulo');
    if (!el || !sub) return;
    sub.textContent = l.titulo + ' — defina prazos e gerencie as etapas';
    renderEpLista();
    openModal('modal-etapas-prazos');
  }
  
  function renderEpLista() {
    const l = livros.find(x => x.id === _epLivroId);
    const el = document.getElementById('modal-ep-lista');
    if (!l || !el) return;
  
    // Feitas sobem pro topo, não feitas ficam abaixo
    const comIdx = l.etapas.map((e, i) => ({e, i}));
    comIdx.sort((a, b) => {
      if (a.e.feito && !b.e.feito) return -1;
      if (!a.e.feito && b.e.feito) return 1;
      return 0; // mantém ordem original dentro de cada grupo
    });
  
    el.innerHTML = comIdx.map(({e, i}) => {
      const cor = e.feito ? 'var(--text-soft)' : (e.prazo ? (() => {
        const diff = Math.round((new Date(e.prazo+'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
        return diff < 0 ? 'var(--danger)' : diff <= 7 ? 'var(--warn)' : 'var(--text)';
      })() : 'var(--text)');
      return `<div draggable="true"
        ondragstart="epDragStart(event,${i})"
        ondragover="event.preventDefault()"
        ondrop="epDrop(event,${i})"
        style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);${e.feito?'opacity:0.55;':''}cursor:default;">
        <span style="cursor:grab;color:var(--text-soft);font-size:12px;flex-shrink:0;">⠿</span>
        <input type="checkbox" ${e.feito?'checked':''} onchange="toggleEtapaModal(${_epLivroId},${i})" style="accent-color:var(--gisella);width:16px;height:16px;flex-shrink:0;cursor:pointer;">
        <span style="flex:1;font-size:13px;color:${cor};${e.feito?'text-decoration:line-through;':''}" ondblclick="renameEtapaModal(${_epLivroId},${i},this)">${e.nome}</span>
        <select onchange="setEtapaResp(${_epLivroId},${i},this.value)"
          style="font-size:11px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--bg);color:var(--text-soft);cursor:pointer;">
          <option value="" ${!e.resp?'selected':''}>—</option>
          <option value="Gisella" ${e.resp==='Gisella'?'selected':''}>Gisella</option>
          <option value="Milena" ${e.resp==='Milena'?'selected':''}>Milena</option>
          <option value="Luiggi" ${e.resp==='Luiggi'?'selected':''}>Luiggi</option>
        </select>
        <input type="date" value="${e.prazo||''}"
          onchange="updateEtapaPrazoInline(${_epLivroId},${i},this.value)"
          style="font-size:12px;border:1px solid var(--border);border-radius:6px;padding:3px 6px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;width:130px;">
        <button onclick="deleteEtapaModal(${_epLivroId},${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0 2px;" title="Excluir">×</button>
      </div>`;
    }).join('');
  }
  
  function addEtapaModal() {
    const l = livros.find(x => x.id === _epLivroId);
    const input = document.getElementById('ep-nova-etapa');
    const nome = (input?.value||'').trim();
    if (!l || !nome) { input?.focus(); return; }
    l.etapas.push({nome, feito: false, prazo: ''});
    save('gc-livros', livros);
    renderLivros();
    if (input) input.value = '';
    renderEpLista();
    // Scroll to bottom
    const lista = document.getElementById('modal-ep-lista');
    if (lista) lista.scrollTop = lista.scrollHeight;
  }
  
  let _epDragIdx = null;
  function epDragStart(e, idx) { _epDragIdx = idx; e.dataTransfer.effectAllowed = 'move'; }
  function epDrop(e, toIdx) {
    e.preventDefault();
    if (_epDragIdx === null || _epDragIdx === toIdx) return;
    const l = livros.find(x => x.id === _epLivroId);
    if (!l) return;
    const moved = l.etapas.splice(_epDragIdx, 1)[0];
    l.etapas.splice(toIdx, 0, moved);
    _epDragIdx = null;
    save('gc-livros', livros);
    renderLivros();
    renderEpLista();
  }
  
  function toggleEtapaModal(livroId, idx) {
    toggleEtapa(livroId, idx);
    renderEpLista();
  }
  
  function deleteEtapaModal(livroId, idx) {
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    l.etapas.splice(idx, 1);
    save('gc-livros', livros);
    renderLivros();
    renderEpLista();
  }
  
  function renameEtapaModal(livroId, idx, el) {
    const l = livros.find(x => x.id === livroId);
    if (!l) return;
    const input = document.createElement('input');
    input.value = l.etapas[idx].nome;
    input.style.cssText = 'flex:1;font-size:13px;border:1px solid var(--gisella);border-radius:4px;padding:2px 6px;font-family:inherit;';
    el.replaceWith(input);
    input.focus();
    input.select();
    const save_ = () => {
      const val = input.value.trim();
      if (val) { l.etapas[idx].nome = val; save('gc-livros', livros); renderLivros(); }
      renderEpLista();
    };
    input.onblur = save_;
    input.onkeydown = e => { if(e.key==='Enter') save_(); if(e.key==='Escape') renderEpLista(); };
  }
  
  function escolherAplicacaoDataEtapa(etapaNome) {
    return new Promise(resolve => {
      const layer = document.createElement('div');
      layer.className = 'modal-overlay open';
      layer.style.zIndex = '10050';
      layer.innerHTML = `<div class="modal" style="width:460px;">
        <button class="modal-close" type="button" data-choice="cancel">×</button>
        <div class="modal-title">Como deseja aplicar esta alteração?</div>
        <p style="font-size:12px;color:var(--text-soft);margin:6px 0 16px;">${String(etapaNome || 'Etapa').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</p>
        <label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;cursor:pointer;">
          <input type="radio" name="etapa-date-choice" value="single" checked style="margin-top:2px;accent-color:var(--gisella);">
          <span><strong style="display:block;font-size:13px;">Alterar somente esta etapa</strong><small style="color:var(--text-soft);">Nenhuma outra data será modificada.</small></span>
        </label>
        <label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;">
          <input type="radio" name="etapa-date-choice" value="following" style="margin-top:2px;accent-color:var(--gisella);">
          <span><strong style="display:block;font-size:13px;">Recalcular todas as etapas seguintes</strong><small style="color:var(--text-soft);">A nova data vira a referência, respeitando fins de semana, conflitos e ordem.</small></span>
        </label>
        <div class="btn-row" style="margin-top:18px;"><button type="button" class="btn" data-choice="cancel">Cancelar</button><button type="button" class="btn btn-primary" data-choice="confirm">Aplicar alteração</button></div>
      </div>`;
      document.body.appendChild(layer);
      const finish = choice => { layer.remove(); resolve(choice); };
      layer.querySelectorAll('[data-choice="cancel"]').forEach(button => button.addEventListener('click', () => finish(null)));
      layer.querySelector('[data-choice="confirm"]').addEventListener('click', () => {
        finish(layer.querySelector('input[name="etapa-date-choice"]:checked')?.value || 'single');
      });
      layer.addEventListener('click', event => { if (event.target === layer) finish(null); });
    });
  }

  function recalcularEtapasSeguintes(livro, editedIndex, newDateValue) {
    const referenceDate = parseDashboardDate(newDateValue);
    if (!referenceDate) return;
    const editedStage = livro.etapas[editedIndex];
    const templateByName = new Map(CRONOGRAMA_EDITORIAL.map(item => [item[0], item[1]]));
    const referenceOffset = Number.isFinite(Number(editedStage.offsetDays))
      ? Number(editedStage.offsetDays)
      : Number(templateByName.get(editedStage.nome) || 0);
    const occupied = new Set(livro.etapas.slice(0, editedIndex + 1).map(stage => stage.prazo).filter(Boolean));
    let previousDate = referenceDate;
    for (let index = editedIndex + 1; index < livro.etapas.length; index += 1) {
      const stage = livro.etapas[index];
      const stageOffset = Number.isFinite(Number(stage.offsetDays))
        ? Number(stage.offsetDays)
        : templateByName.get(stage.nome);
      const candidate = Number.isFinite(Number(stageOffset))
        ? addCalendarDays(referenceDate, Math.max(0, Number(stageOffset) - referenceOffset))
        : addCalendarDays(previousDate, 1);
      const nextDate = nextAvailableEditorialDate(candidate, previousDate, occupied);
      stage.prazo = dashboardDateString(nextDate);
      occupied.add(stage.prazo);
      previousDate = nextDate;
    }
  }

  async function updateEtapaPrazoInline(livroId, idx, val) {
    const l = livros.find(x => x.id === livroId);
    if (!l || !l.etapas[idx]) return;
    const previousValue = l.etapas[idx].prazo || '';
    if (previousValue === val) return;
    const choice = idx < l.etapas.length - 1 ? await escolherAplicacaoDataEtapa(l.etapas[idx].nome) : 'single';
    if (!choice) {
      renderLivros();
      renderEpLista();
      return;
    }
    l.etapas[idx].prazo = val;
    if (choice === 'following' && val) recalcularEtapasSeguintes(l, idx, val);
    save('gc-livros', livros);
    renderLivros();
    buildTarefas();
    if (_epLivroId === livroId) renderEpLista();
  }
  
  /* ── NOTAS RÁPIDAS ── */
  function getNotas(colab) {
    return JSON.parse(localStorage.getItem('gc-notas-' + colab) || '[]');
  }
  function saveNotas(colab, notas) {
    localStorage.setItem('gc-notas-' + colab, JSON.stringify(notas));
    if (window.fbSave) window.fbSave('gc-notas-' + colab, notas);
    else console.warn('fbSave not available — nota saved locally only');
  }
  
  function renderNotas(colab) {
    const el = document.getElementById(colab + '-notas-lista');
    if (!el) {
      // Element not in DOM yet — retry after navigation
      setTimeout(() => renderNotas(colab), 200);
      return;
    }
    const notas = getNotas(colab);
    if (!notas.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-soft);padding:4px 0;">Nenhuma nota.</div>'; return; }
    el.innerHTML = notas.map((n, i) => `
      <div draggable="true" style="display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--text-soft);font-size:13px;flex-shrink:0;margin-top:2px;">•</span>
        <span style="flex:1;font-size:13px;line-height:1.4;" ondblclick="editNota('${colab}',${i})">${n.texto}</span>
        <button onclick="editNota('${colab}',${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0 2px;">✎</button>
        <button onclick="deleteNota('${colab}',${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:13px;padding:0 2px;">×</button>
      </div>`).join('');
  }
  
  function addNotaRapida(colab) {
    openNotaModal(colab, null);
  }
  
  function editNota(colab, idx) {
    openNotaModal(colab, idx);
  }
  
  function openNotaModal(colab, idx) {
    const notas = getNotas(colab);
    const existing = idx !== null ? notas[idx] : null;
    let overlay = document.getElementById('modal-nota-rapida');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-nota-rapida';
      overlay.className = 'modal-overlay';
      overlay.onclick = function(e) { if(e.target===this) this.remove(); };
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="modal" style="width:380px;">
        <button class="modal-close" onclick="document.getElementById('modal-nota-rapida').remove()">×</button>
        <div class="modal-title">${idx !== null ? 'Editar nota' : 'Nova nota rápida'}</div>
        <div class="form-group">
          <textarea class="notes-area" id="nota-texto" placeholder="Escreva aqui..." style="min-height:80px;">${existing ? existing.texto : ''}</textarea>
        </div>
        <div class="btn-row">
          <button class="btn" onclick="document.getElementById('modal-nota-rapida').remove()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveNotaModal('${colab}',${idx !== null ? idx : 'null'})">Salvar</button>
        </div>
      </div>`;
    overlay.classList.add('open');
    setTimeout(() => { const t = document.getElementById('nota-texto'); if(t){t.focus();t.selectionStart=t.value.length;} }, 50);
  }
  
  function saveNotaModal(colab, idx) {
    const texto = (document.getElementById('nota-texto')?.value||'').trim();
    if (!texto) return;
    const notas = getNotas(colab);
    if (idx !== null && idx !== 'null') notas[idx] = { texto };
    else notas.push({ texto });
    saveNotas(colab, notas);
    renderNotas(colab);
    document.getElementById('modal-nota-rapida')?.remove();
  }
  
  function deleteNota(colab, idx) {
    const notas = getNotas(colab);
    notas.splice(idx, 1);
    saveNotas(colab, notas);
    renderNotas(colab);
  }
  
  // Nota rápida via botão flutuante — detecta colaborador logado
  function openNotaRapidaFlutuante() {
    const user = localStorage.getItem('gc-session-user') || 'gisella';
    // Abrir modal sem navegar para outra página
    openNotaModal(user, null);
  }
  
  /* ── POMODORO ── */
  const POM_MODES = {
    foco:  { label: 'Foco',       mins: 25, color: 'var(--gisella)' },
    curta: { label: 'Pausa curta', mins: 5,  color: 'var(--ok)' },
    longa: { label: 'Pausa longa', mins: 15, color: 'var(--leia)' }
  };
  let pomMode      = 'foco';
  let pomTotal     = 25 * 60;
  let pomRemaining = 25 * 60;
  let pomRunning   = false;
  let pomInterval  = null;
  let pomCiclos    = parseInt(localStorage.getItem('pom-ciclos-' + new Date().toDateString()) || '0');
  
  function pomFmt(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m.toString().padStart(2,'0') + ':' + sec.toString().padStart(2,'0');
  }
  
  function pomDrawRing() {
    const canvas = document.getElementById('pom-ring-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 52;
    const cx = size / 2, cy = size / 2, r = 24;
    ctx.clearRect(0, 0, size, size);
    const mode = POM_MODES[pomMode];
    // Resolve CSS color variable to actual color
    const colorMap = { 'var(--gisella)': '#c0396b', 'var(--ok)': '#1A6B4A', 'var(--leia)': '#7c3aed' };
    const color = colorMap[mode.color] || '#c0396b';
    if (!pomRunning && pomRemaining === pomTotal) {
      // idle — thin gray ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(168,147,127,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    // Background track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168,147,127,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Progress arc — starts full, shrinks clockwise (remaining time, clockwise)
    const pct = pomRemaining / pomTotal;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * pct);
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle, false);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  
  function pomUpdateUI() {
    const d = document.getElementById('pom-display');
    const m = document.getElementById('pom-mini-display');
    const p = document.getElementById('pom-progress');
    const c = document.getElementById('pom-ciclos');
    const btn = document.getElementById('pom-btn-start');
    const lbl = document.getElementById('pom-mode-label');
    const mode = POM_MODES[pomMode];
    if (d) d.textContent = pomFmt(pomRemaining);
    if (m) m.textContent = !pomRunning && pomRemaining < pomTotal ? '⏸' : pomFmt(pomRemaining);
    if (p) { p.style.width = (pomRemaining / pomTotal * 100) + '%'; p.style.background = mode.color; }
    if (c) c.textContent = '🍅 ' + pomCiclos + ' pomodoro' + (pomCiclos !== 1 ? 's' : '') + ' hoje';
    if (btn) btn.textContent = pomRunning ? '⏸ Pausar' : '▶ ' + (pomRemaining < pomTotal ? 'Continuar' : 'Iniciar');
    if (lbl) { lbl.textContent = mode.label; lbl.style.color = mode.color; }
    // Update compact button ring
    const toggleBtn = document.getElementById('pom-toggle-btn');
    pomDrawRing();
  }
  
  function pomSetMode(mode) {
    pomStop();
    pomMode = mode;
    pomTotal = POM_MODES[mode].mins * 60;
    pomRemaining = pomTotal;
    // Update tab styles
    ['foco','curta','longa'].forEach(m => {
      const tab = document.getElementById('pom-tab-' + m);
      if (!tab) return;
      if (m === mode) {
        tab.style.background = POM_MODES[m].color.replace(')', '-bg)').replace('var(--','var(--');
        // simpler approach:
        tab.style.background = m === 'foco' ? 'var(--gisella-bg)' : m === 'curta' ? 'var(--ok-bg)' : 'var(--leia-bg)';
        tab.style.color = POM_MODES[m].color;
        tab.style.border = 'none';
        tab.style.fontWeight = '600';
      } else {
        tab.style.background = 'none';
        tab.style.color = 'var(--text-soft)';
        tab.style.border = '1px solid var(--border)';
        tab.style.fontWeight = '400';
      }
    });
    pomUpdateUI();
  }
  
  function pomToggle() {
    if (pomRunning) {
      pomStop();
    } else {
      pomRunning = true;
      pomInterval = setInterval(() => {
        pomRemaining--;
        pomUpdateUI();
        if (pomRemaining <= 0) {
          pomStop();
          pomFinish();
        }
      }, 1000);
      pomUpdateUI();
    }
  }
  
  function pomStop() {
    pomRunning = false;
    clearInterval(pomInterval);
    pomInterval = null;
    pomUpdateUI();
  }
  
  function pomReset() {
    pomStop();
    pomRemaining = pomTotal;
    pomUpdateUI();
  }
  
  function pomFinish() {
    if (pomMode === 'foco') {
      pomCiclos++;
      localStorage.setItem('pom-ciclos-' + new Date().toDateString(), pomCiclos);
    }
    // Notificação sonora
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.4);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.4);
      });
    } catch(e) {}
    // Push notification
    const msg = pomMode === 'foco' ? '🍅 Pomodoro concluído! Hora da pausa.' : '⏰ Pausa terminada! Volte ao foco.';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Central GC · Pomodoro', { body: msg });
    }
    addNotif(msg, 'pomodoro');
    // Auto-switch: foco -> pausa curta, pausas -> foco
    setTimeout(() => {
      if (pomMode === 'foco') pomSetMode('curta');
      else pomSetMode('foco');
      pomUpdateUI();
    }, 500);
  }
  
  let _pomClickTimer = null;
  function pomHandleClick(e) {
    // Single click: start/pause. Use a short delay to distinguish from dblclick.
    if (_pomClickTimer) return;
    _pomClickTimer = setTimeout(() => {
      _pomClickTimer = null;
      pomToggle();
    }, 200);
  }
  function pomHandleDouble(e) {
    // Double click: cancel the pending single-click and open/close widget
    if (_pomClickTimer) { clearTimeout(_pomClickTimer); _pomClickTimer = null; }
    pomToggleWidget();
  }
  
  function pomToggleWidget() {
    const exp = document.getElementById('pomodoro-expanded');
    if (!exp) return;
    const open = exp.style.display === 'none';
    exp.style.display = open ? 'block' : 'none';
  }
  
  // Inicializar
  document.addEventListener('DOMContentLoaded', () => { pomUpdateUI(); pomDrawRing(); });
  
  /* ── BOTTOM NAV ── */
  function bottomNav(pageId, btn) {
    // Deactivate all
    document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (pageId === 'colab-self') {
      const user = localStorage.getItem('gc-session-user') || 'gisella';
      if (user === 'gisella') {
        const navBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes('colab-gisella'));
        showPage('colab-gisella', navBtn);
      } else {
        // Milena/Luiggi não têm página pessoal: vão para Tarefas já filtradas pelo nome
        const navBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes("'tarefas'"));
        showPage('tarefas', navBtn);
        setTimeout(() => {
          const nome = user === 'milena' ? 'Milena' : user === 'luiggi' ? 'Luiggi' : null;
          if (nome) {
            const colabBtn = Array.from(document.querySelectorAll('#filter-bar-tarefas-colab .filter-btn')).find(b => b.textContent.trim() === nome);
            if (colabBtn) setFilterColab('tarefas', nome, colabBtn);
          }
        }, 50);
      }
    } else {
      const navBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes(pageId));
      showPage(pageId, navBtn);
    }
  }
  
  function bottomNavAdd() {
    // Open modal with default type based on current page
    openQuickAdd();
  }
  
  /* ── NOTIFICATIONS ── */
  let _notifs = [];
  
  function openNotifPanel() {
    buildNotifList();
    document.getElementById('notif-panel').classList.add('open');
    // Close when clicking outside
    setTimeout(() => {
      function outsideClick(e) {
        const panel = document.getElementById('notif-panel');
        const btn = document.getElementById('notif-float-btn');
        const mobileBtn = document.getElementById('bnav-notif');
        if (panel && !panel.contains(e.target) && e.target !== btn && e.target !== mobileBtn) {
          closeNotifPanel();
          document.removeEventListener('click', outsideClick);
        }
      }
      document.addEventListener('click', outsideClick);
    }, 50);
  }
  
  function closeNotifPanel() {
    document.getElementById('notif-panel').classList.remove('open');
    // Mark all read
    _notifs.forEach(n => n.read = true);
    updateNotifBadge();
  }
  
  function updateNotifBadge() {
    const badge = document.getElementById('notif-badge');
    const floatBadge = document.getElementById('notif-float-badge');
    const unread = _notifs.filter(n => !n.read).length;
    if (badge) badge.style.display = unread > 0 ? 'block' : 'none';
    if (floatBadge) floatBadge.style.display = unread > 0 ? 'block' : 'none';
  }
  
  function addNotif(text, tipo) {
    const n = { id: Date.now(), text, tipo: tipo||'info', read: false, ts: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) };
    _notifs.unshift(n);
    if (_notifs.length > 50) _notifs = _notifs.slice(0, 50);
    updateNotifBadge();
    // Push notification
    if (Notification && Notification.permission === 'granted') {
      new Notification('Central GC', { body: text, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%23111"/><text x="32" y="44" text-anchor="middle" font-size="36" fill="white" font-family="serif">G</text></svg>' });
    }
  }
  
  function buildNotifList() {
    const el = document.getElementById('notif-list');
    if (!el) return;
    if (_notifs.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--text-soft);padding:1.5rem;font-size:13px;">Nenhuma notificação</div>';
      return;
    }
    const todayStr = new Date().toISOString().slice(0,10);
    const user = (localStorage.getItem('gc-session-user')||'').toLowerCase();
    const userName = user ? (user[0].toUpperCase() + user.slice(1)) : '';
  
    // Collect today's tasks for the first 'info' notif
    const tarefasHoje = (events||[]).filter(e =>
      !e.arquivada && e.tipo === 'tarefa' && e.data === todayStr &&
      (!userName || !e.responsavel || e.responsavel === userName)
    );
  
    el.innerHTML = _notifs.map((n, idx) => {
      // Show tasks below the daily task notification
      let tasksHtml = '';
      if (n.tipo === 'info' && n.text && n.text.includes('tarefa') && idx === 0 && tarefasHoje.length > 0) {
        tasksHtml = `<div style="margin-top:6px;padding-left:18px;">` +
          tarefasHoje.slice(0, 5).map(t =>
            `<div style="font-size:11px;color:var(--text-mid);padding:2px 0;border-bottom:1px solid var(--border);">• ${t.titulo}</div>`
          ).join('') +
          (tarefasHoje.length > 5 ? `<div style="font-size:10px;color:var(--text-soft);margin-top:2px;">+${tarefasHoje.length-5} mais</div>` : '') +
          '</div>';
      }
      return `
      <div class="notif-item" onclick="this.querySelector('.notif-dot').classList.add('read')">
        <span class="notif-dot ${n.read?'read':''}"></span>
        <div style="flex:1;">
          <div class="notif-text">${n.text}</div>
          ${tasksHtml}
        </div>
        <span class="notif-time">${n.ts}</span>
      </div>`;
    }).join('');
  }
  
  function checkUrgentTasksNotif() {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().slice(0,10);
    const user = (localStorage.getItem('gc-session-user')||'').toLowerCase();
    const userName = user ? (user[0].toUpperCase() + user.slice(1)) : '';
    // Urgent tasks for today
    const urgentes = events.filter(e =>
      !e.arquivada && e.tipo === 'tarefa' && e.urgente && e.data && e.data <= todayStr &&
      (!userName || !e.responsavel || e.responsavel === userName)
    );
    urgentes.forEach(e => addNotif('❗ Urgente: ' + e.titulo, 'urgente'));
    // Today's tasks count
    const hoje = events.filter(e => !e.arquivada && e.tipo === 'tarefa' && e.data === todayStr && (!userName || !e.responsavel || e.responsavel === userName));
    if (hoje.length > 0) {
      addNotif(`📋 Você tem ${hoje.length} tarefa${hoje.length>1?'s':''} para hoje`, 'info');
    }
  }
  
  function requestPushPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
  
  // Schedule daily push at 10h
  function scheduleDailyNotif() {
    const now = new Date();
    const target10 = new Date(now); target10.setHours(10, 0, 0, 0);
    if (target10 <= now) target10.setDate(target10.getDate() + 1);
  
    setTimeout(() => {
      // Send push with today's task count
      const todayStr = new Date().toISOString().slice(0,10);
      const user = (localStorage.getItem('gc-session-user')||'').toLowerCase();
      const userName = user ? (user[0].toUpperCase() + user.slice(1)) : '';
      const hoje = (events||[]).filter(e =>
        !e.arquivada && e.tipo === 'tarefa' && e.data === todayStr &&
        (!userName || !e.responsavel || e.responsavel === userName)
      );
      const count = hoje.length;
      const msg = count > 0
        ? `📋 Você tem ${count} tarefa${count>1?'s':''} para hoje`
        : '✅ Nenhuma tarefa para hoje!';
      addNotif(msg, 'info');
      if (Notification && Notification.permission === 'granted') {
        new Notification('Central GC · Tarefas do dia', { body: msg });
      }
      setInterval(() => {
        checkUrgentTasksNotif();
      }, 24*60*60*1000);
    }, target10 - now);
  }
  
  /* ── CHAT ── */
  let _chatMessages = [];
  
  function openChatPanel() {
    document.getElementById('chat-panel').classList.add('open');
    // Overlay só no mobile
    if (window.innerWidth <= 768) {
      const ov = document.getElementById('chat-overlay');
      if (ov) ov.style.display = 'block';
    }
    renderChatMessages();
    setTimeout(() => {
      const msgs = document.getElementById('chat-panel-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const inp = document.getElementById('chat-panel-input');
      if (inp) inp.focus();
    }, 100);
    // Zerar badge
    _notifs.filter(n => n.tipo === 'chat').forEach(n => n.read = true);
    updateChatBadge(false);
  }
  
  function closeChatPanel() {
    document.getElementById('chat-panel').classList.remove('open');
    const ov = document.getElementById('chat-overlay');
    if (ov) ov.style.display = 'none';
  }
  
  function updateChatBadge(show) {
    const b1 = document.getElementById('chat-badge');        // barra mobile
    const b2 = document.getElementById('chat-float-badge');  // botão desktop
    if (b1) b1.style.display = show ? 'block' : 'none';
    if (b2) b2.style.display = show ? 'block' : 'none';
  }
  
  function renderChatMessages() {
    const el = document.getElementById('chat-panel-messages');
    if (!el) return;
    const currentUser = window._currentUserName || localStorage.getItem('gc-session-name') || '';
    if (_chatMessages.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--text-soft);padding:2rem;font-size:13px;">Nenhuma mensagem ainda. Seja o primeiro a escrever! 👋</div>';
      return;
    }
    el.innerHTML = _chatMessages.map(m => {
      const isMine = m.autor === currentUser;
      return `<div style="display:flex;flex-direction:column;align-items:${isMine?'flex-end':'flex-start'};">
        ${!isMine ? `<div style="font-size:11px;font-weight:600;color:var(--text-soft);margin-bottom:2px;padding-left:4px;">${m.autor}</div>` : ''}
        <div class="chat-bubble ${isMine?'mine':'theirs'}">${m.texto}
          <div class="chat-bubble-meta">${m.hora}</div>
        </div>
      </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }
  
  async function sendChatMessage() {
    const inp = document.getElementById('chat-panel-input');
    const texto = (inp?.value||'').trim();
    if (!texto) return;
    const autor = window._currentUserName || localStorage.getItem('gc-session-name') || 'Usuário';
    const hora = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const msg = { id: Date.now(), autor, texto, hora, read: false };
    _chatMessages.push(msg);
    inp.value = '';
    // Save to Firebase
    if (window.fbSave) {
      await window.fbSave('gc-chat-messages', _chatMessages.slice(-100));
    } else {
      localStorage.setItem('gc-chat-messages', JSON.stringify(_chatMessages));
    }
    renderChatMessages();
    // Notificar outros (badge aparecerá quando o listener receber)
    addNotif(`💬 ${autor}: ${texto.slice(0,40)}${texto.length>40?'...':''}`, 'chat');
  }
  
  async function loadChatMessages() {
    try {
      let msgs = null;
      if (window.fbGet) msgs = await window.fbGet('gc-chat-messages');
      if (!msgs) msgs = JSON.parse(localStorage.getItem('gc-chat-messages') || '[]');
      _chatMessages = msgs || [];
    } catch(e) { _chatMessages = []; }
  }
  
  // Listen for new chat messages from other users
  function setupChatListener() {
    if (!window.fbListen) return;
    window.fbListen('gc-chat-messages', msgs => {
      if (!msgs) return;
      const prevLen = _chatMessages.length;
      _chatMessages = msgs;
      if (msgs.length > prevLen) {
        const latest = msgs[msgs.length - 1];
        const currentUser = window._currentUserName || localStorage.getItem('gc-session-name') || '';
        if (latest && latest.autor !== currentUser) {
          updateChatBadge(true);
          addNotif(`💬 ${latest.autor}: ${latest.texto.slice(0,50)}`, 'chat');
        }
      }
      // If panel is open, re-render
      if (document.getElementById('chat-panel').classList.contains('open')) {
        renderChatMessages();
      }
    });
  }
  
  /* ── PUSH NOTIFICATIONS — task assignment & completion ── */
  function notifyTaskAssigned(tarefa, responsavel) {
    const currentUser = (localStorage.getItem('gc-session-user') || '').toLowerCase();
    const currentName = (window._currentUserName || '').toLowerCase();
    // If the task was assigned to another collaborator, notify
    if (responsavel && responsavel.toLowerCase() !== currentName && responsavel.toLowerCase() !== currentUser) {
      const msg = `📋 Nova tarefa atribuída a ${responsavel}: "${tarefa}"`;
      addNotif(msg, 'tarefa');
    }
  }
  
  function notifyTaskCompleted(tarefa, completedBy) {
    // Notify when a collaborator completes a task
    const currentUser = (window._currentUserName || localStorage.getItem('gc-session-name') || '').toLowerCase();
    if (completedBy && completedBy.toLowerCase() !== currentUser) {
      const msg = `✅ ${completedBy} concluiu: "${tarefa}"`;
      addNotif(msg, 'tarefa');
    }
  }
  
  /* ── MODAL COMENTÁRIOS RÁPIDO ── */
  let _comModalEventId = null;
  
  function openComentariosModal(eventId) {
    _comModalEventId = eventId;
    const ev = events.find(x => x.id === eventId);
    if (!ev) return;
    document.getElementById('modal-com-titulo').textContent = ev.titulo;
    document.getElementById('modal-com-texto').value = '';
    renderComentariosModal(ev);
    openModal('modal-comentarios-tarefa');
    setTimeout(() => document.getElementById('modal-com-texto').focus(), 100);
  }
  
  function renderComentariosModal(ev) {
    const lista = document.getElementById('modal-com-lista');
    if (!lista) return;
    const comentarios = ev.comentarios || [];
    if (comentarios.length === 0) {
      lista.innerHTML = '<div style="font-size:12px;color:var(--text-soft);text-align:center;padding:8px 0;">Nenhum comentário ainda.</div>';
      return;
    }
    const cores = { Gisella: 'var(--gisella)', Milena: 'var(--leia)', Luiggi: 'var(--editora)' };
    lista.innerHTML = comentarios.map((c, i) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:600;color:${cores[c.autor]||'var(--text-mid)'};">${c.autor}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--text-soft);">${c.data}</span>
            <button onclick="deleteComModal(${i})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0;line-height:1;">×</button>
          </div>
        </div>
        <div style="font-size:13px;white-space:pre-wrap;line-height:1.5;">${c.texto}</div>
      </div>`).join('');
    lista.scrollTop = lista.scrollHeight;
  }
  
  function submitComentarioModal() {
    if (!_comModalEventId) return;
    const ev = events.find(x => x.id === _comModalEventId);
    if (!ev) return;
    const texto = (document.getElementById('modal-com-texto').value || '').trim();
    if (!texto) { document.getElementById('modal-com-texto').focus(); return; }
    const autor = document.getElementById('modal-com-autor').value || 'Gisella';
    const agora = new Date();
    const data = agora.getDate().toString().padStart(2,'0') + '/' + (agora.getMonth()+1).toString().padStart(2,'0') + ' ' + agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
    if (!ev.comentarios) ev.comentarios = [];
    ev.comentarios.push({ autor, texto, data });
    save('gc-events', events);
    document.getElementById('modal-com-texto').value = '';
    renderComentariosModal(ev);
    // Update bubble icon count on all rows
    document.querySelectorAll(`[data-com-id="${_comModalEventId}"]`).forEach(el => {
      const cnt = ev.comentarios.length;
      el.innerHTML = cnt > 0 ? bubbleIconHtml(cnt, true) : bubbleIconHtml(0, false);
    });
  }
  
  function deleteComModal(idx) {
    if (!_comModalEventId) return;
    const ev = events.find(x => x.id === _comModalEventId);
    if (!ev || !ev.comentarios) return;
    ev.comentarios.splice(idx, 1);
    save('gc-events', events);
    renderComentariosModal(ev);
    document.querySelectorAll(`[data-com-id="${_comModalEventId}"]`).forEach(el => {
      const cnt = ev.comentarios.length;
      el.innerHTML = cnt > 0 ? bubbleIconHtml(cnt, true) : bubbleIconHtml(0, false);
    });
  }
  
  function bubbleIconHtml(count, hasComments) {
    const color = hasComments ? 'var(--gisella)' : 'var(--text-soft)';
    const bg = hasComments ? 'var(--gisella-bg)' : 'transparent';
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${hasComments?'var(--gisella)':'none'}" stroke="${color}" stroke-width="2" style="display:inline;vertical-align:middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>${hasComments?`<span style="font-size:9px;color:${color};font-weight:600;margin-left:1px;">${count}</span>`:''}`;
  }
  
  function comentarioBubble(eventId, comentarios) {
    const count = (comentarios||[]).length;
    return `<button data-com-id="${eventId}" onclick="event.stopPropagation();openComentariosModal(${eventId})" style="background:none;border:none;cursor:pointer;padding:1px 3px;opacity:${count>0?1:0.4};display:inline-flex;align-items:center;gap:2px;" title="${count>0?count+' comentário(s)':'Comentar'}">${bubbleIconHtml(count, count>0)}</button>`;
  }
  
  /* ── MODAL DIA CALENDÁRIO ── */
  function openDayModalFromCache(calId, ds) {
    const items = (window._calDayCache && window._calDayCache[calId+'_'+ds]) || [];
    openDayModal(ds, items);
  }
  
  function openDayModal(ds, items) {
    window._modalDiaDate = ds;
    const MS2 = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const [y,mo,d] = ds.split('-').map(Number);
    const dow = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][new Date(y,mo-1,d).getDay()];
    document.getElementById('modal-dia-title').textContent = `${dow}, ${d} de ${MS2[mo-1]} de ${y}`;
  
    const EMP_COR = {editora:'var(--editora)',leia:'var(--leia)',gisella:'var(--gisella)'};
    const EMP_LABEL = {editora:'Editora Cassol',leia:'Léia Cassol',gisella:'GC Estratégias'};
    const contColors = {editora:'#7b1414',leia:'#3c0a50',gisella:'#8c0a3c'};
  
    const rows = items.map(item => {
      if (item.type === 'conteudo') {
        const c = item.c;
        const cor = contColors[c.empresa||'editora'];
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px;background:var(--bg);border-radius:8px;">
          <span style="font-size:14px;flex-shrink:0;">✍</span>
          <div style="flex:1;cursor:pointer;" onclick="closeModal('modal-dia-cal');openConteudo(${c.id})">
            <div style="font-weight:500;">${c.nome}</div>
            <div style="font-size:11px;color:${cor};margin-top:2px;">${EMP_LABEL[c.empresa]||c.empresa} · conteúdo</div>
          </div>
          <button onclick="event.stopPropagation();if(confirm('Excluir conteúdo?')){deleteConteudo(${c.id});closeModal('modal-dia-cal');}" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:14px;padding:0 2px;" title="Excluir">×</button>
        </div>`;
      } else {
        const e = item.e;
        const cor = EMP_COR[e.empresa||'editora'] || 'var(--text-soft)';
        const time = e.startTime ? `<span style="font-size:11px;color:var(--text-soft);">${e.startTime}</span> ` : '';
        const gcalBadge = e.gcal ? '<span style="font-size:9px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--text-soft);margin-left:6px;">Google Cal</span>' : '';
        const editBtn = !e.gcal ? `<button onclick="event.stopPropagation();closeModal('modal-dia-cal');openEditEvent(${e.id})" style="background:none;border:none;color:var(--text-soft);cursor:pointer;font-size:11px;padding:0;">✎</button>` : '';
        const linkBtn = e.gcal && e.link ? `<a href="${e.link}" target="_blank" onclick="event.stopPropagation();" style="color:var(--text-soft);font-size:11px;text-decoration:none;">↗</a>` : '';
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px;background:var(--bg);border-radius:8px;">
          <div style="width:3px;min-height:32px;background:${cor};border-radius:2px;flex-shrink:0;margin-top:2px;"></div>
          <div style="flex:1;">
            <div style="font-weight:500;">${time}${e.titulo}${gcalBadge}</div>
            <div style="font-size:11px;color:${cor};margin-top:2px;">${EMP_LABEL[e.empresa||'editora']||e.empresa}</div>
          </div>
          ${editBtn}${linkBtn}
        </div>`;
      }
    }).join('');
  
    document.getElementById('modal-dia-body').innerHTML = rows || '<div style="color:var(--text-soft);">Nenhum evento neste dia.</div>';
    openModal('modal-dia-cal');
  }
  
  /* ── CONTADOR MENTORIAS ── */
  function countMentoriasmes() {
    const el = document.getElementById('mentorias-mes-gc');
    if (!el) return;
    // Debug: log first 5 events with their descriptions
    console.log('gcalEventsCache sample:', (window.gcalEventsCache||[]).slice(0,5).map(ev => ({title: ev.title, description: ev.description, start: ev.start})));
    const agora = new Date();
    const mes = agora.getMonth();
    const ano = agora.getFullYear();
    const meses = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const gcal = (window.gcalEventsCache||[]).filter(ev =>
      (ev.description||'').toLowerCase().includes('mentoria') && ev.start &&
      new Date(ev.start+'T00:00:00').getMonth()===mes && new Date(ev.start+'T00:00:00').getFullYear()===ano
    );
    const locais = (events||[]).filter(e =>
      (e.observacao||'').toLowerCase().includes('mentoria') && e.data &&
      new Date(e.data+'T00:00:00').getMonth()===mes && new Date(e.data+'T00:00:00').getFullYear()===ano &&
      (e.empresa||'').includes('gisella')
    );
    const total = gcal.length + locais.length;
    el.innerHTML = '<span style="font-weight:600;color:var(--gisella);">Mentorias em ' + meses[mes] + ': ' + total + '</span>';
  }
  
  function countMentoriasSemana() {
    const el = document.getElementById('mentorias-semana-colab');
    if (!el) return;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - hoje.getDay());
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    const iniStr = ini.toISOString().slice(0,10);
    const fimStr = fim.toISOString().slice(0,10);
    const gcal = (window.gcalEventsCache||[]).filter(ev =>
      (ev.description||'').toLowerCase().includes('mentoria') && ev.start >= iniStr && ev.start <= fimStr
    );
    const locais = (events||[]).filter(e =>
      (e.observacao||'').toLowerCase().includes('mentoria') && e.data >= iniStr && e.data <= fimStr &&
      (e.empresa||'').includes('gisella')
    );
    const total = gcal.length + locais.length;
    el.innerHTML = '<span style="font-weight:600;color:var(--gisella);">Mentorias desta semana: ' + total + '</span>';
  }
  
  /* ── HOME CARDS ── */
  function buildHomeCards() {
    // Data de hoje
    const hoje = new Date();
    const fimSemana7 = new Date(hoje.getTime() + 7*24*60*60*1000);
    const fimSemanaStr = fimSemana7.toISOString().slice(0,10);
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const dataEl = document.getElementById('visao-data-hoje');
    if (dataEl) dataEl.textContent = `${diasSemana[hoje.getDay()]}, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;
  
    const empresas = ['editora','leia','gisella'];
    const hoje_str = hoje.toISOString().slice(0,10);
    const em7dias = new Date(hoje.getTime() + 7*24*60*60*1000).toISOString().slice(0,10);
  
    let alertas = [];
  
    empresas.forEach(emp => {
      // Livros ativos
      const livrosEmp = (livros||[]).filter(l => (l.empresa||'').split(',').includes(emp) && !((l.etapas||[]).length > 0 && l.etapas.every(e=>e.feito)));
      // Projetos ativos
      const projetosEmp = (projetos||[]).filter(p => (p.empresa||'')=== emp && p.status !== 'finalizado');
      // Conteudos ativos
      const conteudosEmp = (conteudos||[]).filter(c => (c.empresa||'').split(',').includes(emp) && !c.archived && c.status !== 'postado');
      // Tarefas desta semana COM data (atrasadas + até 7 dias)
      const tarefasEmp = (events||[]).filter(e =>
        (e.empresa||'').split(',').includes(emp) &&
        !e.arquivada && !e.done && e.tipo === 'tarefa' &&
        e.data && e.data <= fimSemanaStr
      );
      // Mentoradas (só gisella)
      const menteesCount = (mentees||[]).length;
  
      // Preencher métricas
      if (emp === 'gisella') {
        const el = document.getElementById('home-gisella-mentees');
        if (el) el.textContent = menteesCount;
      } else {
        const el = document.getElementById(`home-${emp}-livros`);
        if (el) el.textContent = livrosEmp.length;
      }
      const pEl = document.getElementById(`home-${emp}-projetos`);
      if (pEl) pEl.textContent = projetosEmp.length;
      const cEl = document.getElementById(`home-${emp}-conteudos`);
      if (cEl) cEl.textContent = conteudosEmp.length;
      const tEl = document.getElementById(`home-${emp}-tarefas`);
      if (tEl) tEl.textContent = tarefasEmp.length;
  
      // Urgentes: tarefas vencidas ou vencendo em 2 dias
      const urgentes = tarefasEmp.filter(e => e.date && e.date <= em7dias);
      const urgenteEl = document.getElementById(`home-${emp}-urgente`);
      if (urgenteEl) {
        if (urgentes.length > 0) {
          const vencidas = urgentes.filter(e => e.date < hoje_str).length;
          const proximas = urgentes.filter(e => e.date >= hoje_str).length;
          let txt = [];
          if (vencidas > 0) txt.push(`<span style="color:var(--danger);">⚠ ${vencidas} vencida${vencidas>1?'s':''}</span>`);
          if (proximas > 0) txt.push(`<span style="color:var(--warn);">⏰ ${proximas} nos próximos 7 dias</span>`);
          urgenteEl.innerHTML = txt.join(' · ');
        } else {
          urgenteEl.innerHTML = '<span style="color:var(--ok);">✓ Em dia</span>';
        }
      }
  
      // Coletar alertas globais
      tarefasEmp.filter(e => e.date && e.date < hoje_str).forEach(e => {
        alertas.push({ emp, texto: e.titulo||e.title||'Tarefa', data: e.date });
      });
    });
  
    // Alertas de prazo
    const alertasEl = document.getElementById('home-alertas');
    const alertasLista = document.getElementById('home-alertas-lista');
    if (alertas.length > 0 && alertasEl && alertasLista) {
      alertasEl.style.display = 'block';
      const cores = { editora: 'var(--editora)', leia: 'var(--leia)', gisella: 'var(--gisella)' };
      const nomes = { editora: 'Editora Cassol', leia: 'Léia Cassol', gisella: 'GC Estratégias' };
      alertasLista.innerHTML = alertas.slice(0,5).map(a => `
        <div style="display:flex;align-items:center;gap:10px;background:var(--danger-bg);border:1px solid rgba(240,112,112,0.2);border-radius:8px;padding:8px 12px;font-size:13px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${cores[a.emp]};flex-shrink:0;"></span>
          <span style="color:${cores[a.emp]};font-size:11px;font-weight:500;">${nomes[a.emp]}</span>
          <span style="flex:1;">${a.texto}</span>
          <span style="color:var(--danger);font-size:11px;">${a.data}</span>
        </div>`).join('');
    } else if (alertasEl) {
      alertasEl.style.display = 'none';
    }
  }
  
  
  
  function initApp(cloudData) {
    // cloudData is only provided when there's NO local data (first time load)
    // In all other cases, localStorage is the source of truth
    if (cloudData) {
          Object.entries(cloudData).forEach(([key, entry]) => {
        const cloudTs = Number(entry?.ts || 0);
        if (cloudTs > 0) {
          localStorage.setItem('_fbts_' + key, String(cloudTs));
        }
      });
      const apply = (key, setter) => {
        const entry = cloudData[key];
        const val = entry?.value ?? entry; // support both {value, ts} and raw formats
        if (val != null) {
          setter(val);
          localStorage.setItem(key, JSON.stringify(val));
        }
      };
      apply('gc-events',      v => { events    = v.map(e => ({...e, tipo: e.tipo||'tarefa'})); });
      apply('gc-livros',      v => { livros     = v; });
      apply('gc-conteudos',   v => { conteudos  = v; });
      apply('gc-projetos',    v => { projetos   = v; });
      apply('gc-recurring-tasks', v => { recurringTasks = v; });
      apply('gc-kanban',      v => { kanbanData = v; });
      apply('gc-steira',      v => { steiraData = v; });
      apply('gc-colab-ordem', v => { colabOrdem = v; });
      apply('gc-links',       v => { links      = v; });
      apply('gc-links-empresa', v => { linksEmpresa = v; });
      ['gisella','milena','luiggi'].forEach(c => {
        const key = 'gc-notas-' + c;
        const entry = cloudData[key];
        const val = entry?.value ?? entry;
        if (val?.length > 0) localStorage.setItem(key, JSON.stringify(val));
        ['gc-fixed-'+c, 'gc-fixed-checks-'+c].forEach(k => {
          const e2 = cloudData[k]; const v2 = e2?.value ?? e2;
          if (v2) localStorage.setItem(k, JSON.stringify(v2));
        });
      });
      if (cloudData['gc-mentees']) {
        const entry = cloudData['gc-mentees'];
        const val = entry?.value ?? entry;
        if (val) { mentees = mergeMentees(val); localStorage.setItem('gc-mentees', JSON.stringify(mentees)); }
      }
      if (cloudData['gc-mentees-marco0']) {
        const entry = cloudData['gc-mentees-marco0'];
        const val = entry?.value ?? entry;
        if (val) { menteesMarco0 = val; localStorage.setItem('gc-mentees-marco0', JSON.stringify(menteesMarco0)); }
      }
    }
  
    // (gcalKey tasks are managed by criarTarefasEventos / limparTarefasEventosRemovidos)
  
    // Restaurar página salva
    const savedPage = localStorage.getItem('gc-current-page');
    if (savedPage) {
      const _spEl = document.getElementById('page-' + savedPage);
      if (_spEl) {
        const _spBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes(savedPage));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        _spEl.classList.add('active');
        if (_spBtn) _spBtn.classList.add('active');
      } else {
        localStorage.setItem('gc-current-page', 'visao');
      }
    }
  
    initCalendars();
    renderLivros();
    offerLivrosRecovery();
    renderMenteeList();
    renderMarco0List();
    renderConteudos();
    applyAutomaticTaskOwners();
    ensureGisellaRecorrentes();
    buildTarefas();
    buildColabTarefas();
    renderProjetos();
    buildPrioridades();
    buildEventosList();
    loadGcal();
    loadGcalLeia();
    buildHomeCards();
    ['gisella','milena','luiggi'].forEach(renderNotas);
    renderSteiraList();
  
    // Initialize chat + notifications
    loadChatMessages().then(() => {});
    setupChatListener();
    requestPushPermission();
    scheduleDailyNotif();
    // Check notifications after data loads
    setTimeout(checkUrgentTasksNotif, 1500);
  
    // Indicador de sync
    const ind = document.getElementById('sync-indicator');
    if (ind) ind.style.display = cloudData ? 'flex' : 'none';
  
    // Escutar mudanças em tempo real de outros dispositivos
    if (window.fbListen) {
      [
        // fbListen já ignora o eco de uma gravação confirmada por este aparelho.
        // Não descartamos mudanças recentes: esse bloqueio de 15 s deixava uma aba
        // com a cópia antiga em memória e ela podia reverter checks de outra origem.
        ['gc-events',    v => {
          events = v.map(e => {
            const normalized = {...e, tipo:e.tipo||'tarefa'};
            if (normalized.tipo === 'tarefa') normalized.responsavel = automaticTaskOwner(normalized.titulo, normalized.responsavel || '');
            return normalized;
          });
          buildTarefas(); buildColabTarefas(); buildPrioridades(); buildEventosList(); refreshCalendars();
        }],
        ['gc-livros',    v => { livros = v; renderLivros(); buildTarefas(); buildColabTarefas(); }],
        ['gc-projetos',  v => { projetos = v; renderProjetos(); buildTarefas(); buildColabTarefas(); }],
        ['gc-conteudos', v => { conteudos = v; renderConteudos(); buildPrioridades(); }],
        ['gc-recurring-tasks', v => { recurringTasks = v || []; ensureCustomRecurringTasks(window.gcalEventsCache || []); }],
        ['gc-mentees',       v => { mentees       = v; renderMenteeList();  }],
        ['gc-mentees-marco0', v => { menteesMarco0 = v; renderMarco0List();  }],
        ['gc-notas-gisella', v => { localStorage.setItem('gc-notas-gisella', JSON.stringify(v)); renderNotas('gisella'); }],
        ['gc-notas-milena',  v => { localStorage.setItem('gc-notas-milena',  JSON.stringify(v)); renderNotas('milena');  }],
        ['gc-notas-luiggi',  v => { localStorage.setItem('gc-notas-luiggi',  JSON.stringify(v)); renderNotas('luiggi');  }],
        ['gc-fixed-gisella', v => { localStorage.setItem('gc-fixed-gisella', JSON.stringify(v)); renderFixedTasks('gisella'); }],
        ['gc-fixed-milena',  v => { localStorage.setItem('gc-fixed-milena',  JSON.stringify(v)); renderFixedTasks('milena');  }],
        ['gc-fixed-luiggi',  v => { localStorage.setItem('gc-fixed-luiggi',  JSON.stringify(v)); renderFixedTasks('luiggi');  }],
        // Fixed-check keys: sync check states across devices
        ['gc-fixed-checks-gisella', v => { localStorage.setItem('gc-fixed-checks-gisella', JSON.stringify(v)); renderFixedTasks('gisella'); }],
        ['gc-fixed-checks-milena',  v => { localStorage.setItem('gc-fixed-checks-milena',  JSON.stringify(v)); renderFixedTasks('milena');  }],
        ['gc-fixed-checks-luiggi',  v => { localStorage.setItem('gc-fixed-checks-luiggi',  JSON.stringify(v)); renderFixedTasks('luiggi');  }],
        ['gc-links',         v => { links        = v; localStorage.setItem('gc-links',         JSON.stringify(v)); renderLinks(); }],
        ['gc-links-empresa', v => { linksEmpresa = v; localStorage.setItem('gc-links-empresa', JSON.stringify(v)); }],
      ].forEach(([key, handler]) => {
        window.fbListen(key, val => { localStorage.setItem(key, JSON.stringify(val)); handler(val); });
      });
    }
  }
  
  // Loading overlay
  document.body.insertAdjacentHTML('beforeend',
    '<div id="loading-overlay" style="position:fixed;inset:0;background:var(--bg);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">' +
    '<div style="font-size:32px;">🔥</div>' +
    '<div style="font-size:14px;font-weight:500;color:var(--text);">Carregando dados...</div>' +
    '<div style="font-size:12px;color:var(--text-soft);">Conectando ao Firebase</div></div>'
  );
  
  function startWithFirebase() {
    const ov = document.getElementById('loading-overlay');
  
    // Check if we have local data
    const hasLocal = !!localStorage.getItem('gc-events');
  
    if (hasLocal) {
      // Start immediately with local data — no waiting for Firebase
      if (ov) ov.remove();
      initApp(null); // null = use localStorage only
  
      // Then sync from Firebase in background — only to fill missing keys on other devices
      // Sync from Firebase using timestamps — take Firebase data if it is newer
      // (e.g. another collaborator checked a task on their device)
      if (window.fbLoadAll) {
        window.fbLoadAll().then(cloudData => {
          if (!cloudData) return;
          let changed = false;
  
          // Task-critical keys: use Firebase only if BOTH conditions are true:
          // 1. Firebase has a newer timestamp than this device's last upload (_fbts_)
          // 2. This device has previously synced (localTs > 0)
          // If localTs === 0 (never synced via new system) AND local data exists,
          // the local data is the source of truth — upload it to Firebase instead.
          const TASK_KEYS = {
            'gc-events':   v => { events   = v.map(e => ({...e, tipo: e.tipo||'tarefa'})); },
            'gc-livros':   v => { livros   = v; },
            'gc-projetos': v => { projetos = v; },
            'gc-recurring-tasks': v => { recurringTasks = v || []; },
          };
          const keysToUpload = []; // local data that needs to be pushed to Firebase
          Object.entries(TASK_KEYS).forEach(([key, setter]) => {
            const entry = cloudData[key];
            const cloudTs = (entry && entry.ts) || 0;
            const localTs = parseInt(localStorage.getItem('_fbts_' + key) || '0');
            const hasLocal = !!localStorage.getItem(key);
  
        if (localTs === 0 && hasLocal) {
    // Dados locais sem histórico de sincronização podem estar desatualizados.
    // Se já há dados na nuvem, ela é a fonte segura.
    if (entry && entry.value) {
      setter(entry.value);
      localStorage.setItem(key, JSON.stringify(entry.value));
      localStorage.setItem('_fbts_' + key, cloudTs.toString());
      changed = true;
    } else {
      // Só envia o local quando ainda não existir nada na nuvem.
      keysToUpload.push(key);
    }
    return;
  }
            if (!entry || !entry.value) return;
            if (cloudTs > localTs) {
              setter(entry.value);
              localStorage.setItem(key, JSON.stringify(entry.value));
              localStorage.setItem('_fbts_' + key, cloudTs.toString());
              changed = true;
            } else if (!hasLocal) {
              setter(entry.value);
              localStorage.setItem(key, JSON.stringify(entry.value));
              changed = true;
            }
          });
          // Upload local-only data to Firebase to establish the correct state
          if (keysToUpload.length > 0 && window.fbSave) {
            keysToUpload.forEach(key => {
              try {
                const localVal = JSON.parse(localStorage.getItem(key));
                if (localVal) window.fbSave(key, localVal);
              } catch(e) {}
            });
          }
  
          // Fixed-check keys: sync if Firebase is newer
          ['gisella','milena','luiggi'].forEach(c => {
            const key = 'gc-fixed-checks-' + c;
            const entry = cloudData[key];
            if (!entry || !entry.value) return;
            const cloudTs = entry.ts || 0;
            const localTs = parseInt(localStorage.getItem('_fbts_' + key) || '0');
            if (cloudTs > localTs || !localStorage.getItem(key)) {
              localStorage.setItem(key, JSON.stringify(entry.value));
              if (cloudTs) localStorage.setItem('_fbts_' + key, cloudTs.toString());
              changed = true;
            }
          });
  
          // Other keys: fill in only if missing locally
          ['gc-conteudos','gc-mentees','gc-mentees-marco0','gc-kanban','gc-steira',
           'gc-colab-ordem','gc-links','gc-links-empresa','gc-recurring-tasks'].forEach(key => {
            if (!localStorage.getItem(key) && cloudData[key]?.value) {
              localStorage.setItem(key, JSON.stringify(cloudData[key].value));
              changed = true;
            }
          });
  
          if (changed) {
            conteudos     = load('gc-conteudos', []);
            recurringTasks = load('gc-recurring-tasks', []);
            mentees       = load('gc-mentees', MENTEES_DEFAULT);
            menteesMarco0 = load('gc-mentees-marco0', []);
            renderLivros(); renderMenteeList(); renderConteudos();
            buildTarefas(); buildColabTarefas(); renderProjetos(); buildPrioridades();
            ['gisella','milena','luiggi'].forEach(c => renderFixedTasks(c));
          }
        }).catch(() => {}); // silent fail — we already have local data
      }
    } else {
      // No local data: must load from Firebase (first time or cleared storage)
      if (window.fbLoadAll) {
        window.fbLoadAll()
          .then(cloudData => {
            if (ov) ov.remove();
            initApp(cloudData);
          })
          .catch(err => {
            console.warn('Firebase falhou, usando localStorage:', err);
            if (ov) ov.remove();
            initApp(null);
          });
      } else {
        setTimeout(startWithFirebase, 100);
      }
    }
  }
  
  // Timeout de segurança: 4s — se Firebase não responder, usa local
  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) { ov.remove(); initApp(null); }
  }, 4000);
  
  
  /* ── LOGIN ── */
  const LOGIN_USERS = {
    gisella: { name: 'Gisella', color: 'var(--gisella)', bg: 'var(--gisella-bg)', initial: 'G' },
    milena:  { name: 'Milena',  color: 'var(--leia)',    bg: 'var(--leia-bg)',    initial: 'M' },
    luiggi:  { name: 'Luiggi',  color: 'var(--editora)', bg: 'var(--editora-bg)', initial: 'L' },
  };
  // Permissões por usuário — 'all' = acesso total
  // No futuro, substituir por array de pageIds permitidos
  const LOGIN_PERMS = {
    gisella: 'all',
    milena:  'all',
    luiggi:  'all',
  };
  async function doLogin() {
    const name = (document.getElementById('login-name').value || '').trim();
    const pass = document.getElementById('login-pass').value;
    const errEl = document.getElementById('login-error');
    if (!name) { errEl.textContent = 'Digite seu nome.'; document.getElementById('login-name').focus(); return; }
    if (!pass) { errEl.textContent = 'Digite sua senha.'; document.getElementById('login-pass').focus(); return; }
    // Mapear nome para usuário conhecido (case insensitive)
    const nameLower = name.toLowerCase();
    const matchedUser = Object.keys(LOGIN_USERS).find(u => u === nameLower || LOGIN_USERS[u].name.toLowerCase() === nameLower) || nameLower;
    try {
      errEl.textContent = 'Entrando…';
      const response = await fetch(CHECKLIST_SYNC_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'dashboard_login',username:matchedUser,password:pass}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.token) throw new Error(result.error || 'Não foi possível validar o acesso.');
      sessionStorage.setItem('gc-dashboard-session-token', result.token);
    } catch (error) {
      errEl.textContent = error.message || 'Não foi possível entrar agora.';
      return;
    }
    const today = new Date().toDateString();
    localStorage.setItem('gc-session-user', matchedUser);
    localStorage.setItem('gc-session-name', name);
    localStorage.setItem('gc-session-date', today);
    errEl.textContent = '';
    showApp(matchedUser, name);
  }
  
  function checkSession() {
    const savedUser = localStorage.getItem('gc-session-user');
    const savedDate = localStorage.getItem('gc-session-date');
    const today = new Date().toDateString();
    if (savedUser && savedDate === today && LOGIN_USERS[savedUser] && sessionStorage.getItem('gc-dashboard-session-token')) {
      showApp(savedUser, localStorage.getItem('gc-session-name') || savedUser);
    } else {
      document.getElementById('login-screen').style.display = 'flex';
    }
  }
  
  function showApp(user, displayName) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'flex';
    // Show bottom nav on mobile
    const bn = document.getElementById('bottom-nav');
    if (bn) bn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    window.addEventListener('resize', () => {
      if (bn) bn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    });
    // Show hamburger on mobile
    if (window.innerWidth <= 768) {
      const hb = document.getElementById('mobile-hamburger');
      if (hb) hb.style.display = 'flex';
    }
    window.addEventListener('resize', () => {
      const hb = document.getElementById('mobile-hamburger');
      if (!hb) return;
      hb.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
      if (window.innerWidth > 768) closeMobileNav();
    });
    // Se for colaborador e ainda não tiver página salva, leva direto ao que é relevante para ele
    if (['gisella','milena','luiggi'].includes(user)) {
      const savedPg = localStorage.getItem('gc-current-page');
      if (!savedPg) {
        setTimeout(() => {
          if (user === 'gisella') {
            const el = document.getElementById('page-colab-gisella');
            const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes('colab-gisella'));
            if (el) {
              document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
              document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
              el.classList.add('active');
              if (btn) btn.classList.add('active');
              localStorage.setItem('gc-current-page', 'colab-gisella');
            }
          } else {
            // Milena/Luiggi: leva para a aba Tarefas já filtrada pelo próprio nome
            const el = document.getElementById('page-tarefas');
            const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => (b.getAttribute('onclick')||'').includes("'tarefas'"));
            if (el) {
              document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
              document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
              el.classList.add('active');
              if (btn) btn.classList.add('active');
              localStorage.setItem('gc-current-page', 'tarefas');
              buildTarefas();
              const nome = user === 'milena' ? 'Milena' : 'Luiggi';
              const colabBtn = Array.from(document.querySelectorAll('#filter-bar-tarefas-colab .filter-btn')).find(b => b.textContent.trim() === nome);
              if (colabBtn) setFilterColab('tarefas', nome, colabBtn);
            }
          }
        }, 50);
      }
    }
    // Set chat author selector
    window._currentUser = user;
    window._currentUserName = displayName || user;
    // Mostrar nome do usuário logado no footer
    const footer = document.querySelector('.sidebar-footer');
    if (footer) {
      const u = LOGIN_USERS[user] || { name: displayName || user, color: 'var(--gisella)', bg: 'var(--gisella-bg)', initial: (displayName||user)[0].toUpperCase() };
      footer.insertAdjacentHTML('afterbegin',
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
          <div style="width:26px;height:26px;border-radius:50%;background:${u.bg};color:${u.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${u.initial}</div>
          <span style="font-size:13px;font-weight:500;color:var(--text);">${u.name}</span>
          <button onclick="doLogout()" style="margin-left:auto;background:none;border:none;font-size:11px;color:var(--text-soft);cursor:pointer;padding:0;" title="Sair">↩ sair</button>
        </div>`
      );
    }
  }
  
  function doLogout() {
    sessionStorage.removeItem('gc-dashboard-session-token');
    localStorage.removeItem('gc-session-user');
    localStorage.removeItem('gc-session-date');
    location.reload();
  }
  
  // Verificar sessão ao carregar
  checkSession();
  
  if (window._fbReady) {
    startWithFirebase();
  } else {
    window.addEventListener('firebase-ready', startWithFirebase, { once: true });
  }
