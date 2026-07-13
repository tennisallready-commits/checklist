// ----------------------------------------------------
// Supabase Configuration
// ----------------------------------------------------
const SUPABASE_URL = "https://piwsavppaabjygaolldb.supabase.co";
const SUPABASE_KEY = "sb_publishable_KTpEV6wW6w5QGJekeeCMzA_TyCJbpfV";

// Default categories/places
const DEFAULT_CATEGORIES = ["Tio Nan", "Cassol", "PUCRS"];

// Default tasks database for initial setup (offline fallback and reset option)
const DEFAULT_TASKS = [];

// App State
let tasks = [];
let categories = [];
let currentFilter = "all";
let isEditMode = false;
let isHistoryMode = false;
let currentTheme = "default";

// Selected date format YYYY-MM-DD
let selectedDate = "";
let currentCalendarMonth = new Date();

// Async transaction locks (prevents double submits)
let pendingDeletes = new Set();
let pendingToggles = new Set();

// Authentication State
let currentUser = null;
let isAuthModeLogin = true;

// Supabase Client instance
let supabaseClient = null;

// DOM Elements
const tasksListEl = document.getElementById("tasks-list");
const emptyStateEl = document.getElementById("empty-state");
const progressPercentageEl = document.getElementById("progress-percentage");
const progressTasksCountEl = document.getElementById("progress-tasks-count");
const progressCircle = document.getElementById("progress-circle");
const progressRingWrapper = document.querySelector(".progress-ring-wrapper");
const progressBarFill = document.getElementById("progress-bar-fill");
const currentDateEl = document.getElementById("current-date");
const btnOpenCalendar = document.getElementById("btn-open-calendar");
const orgTagEl = document.getElementById("org-tag");
const appContainer = document.querySelector(".app-container");

// Modals
const modalAddTask = document.getElementById("modal-add-task");
const modalManageTasks = document.getElementById("modal-manage-tasks");
const modalCalendar = document.getElementById("modal-calendar");

// Forms & Inputs
const formAddTask = document.getElementById("form-add-task");
const inputTaskTitle = document.getElementById("task-title");
const selectTaskCategory = document.getElementById("task-category");
const selectTaskRecurring = document.getElementById("task-recurring");

const inputOrgName = document.getElementById("input-org-name");
const inputNewCategory = document.getElementById("input-new-category");

// Action Buttons
const btnResetChecklist = document.getElementById("btn-reset-checklist");
const btnToggleEdit = document.getElementById("btn-toggle-edit");
const btnManageTasks = document.getElementById("btn-manage-tasks");
const btnAddTaskModal = document.getElementById("btn-add-task-modal");
const btnShareReport = document.getElementById("btn-share-report");
const btnCloseAddModal = document.getElementById("btn-close-add-modal");
const btnCloseManageModal = document.getElementById("btn-close-manage-modal");

const btnResetDefault = document.getElementById("btn-reset-default");
const btnClearAll = document.getElementById("btn-clear-all");
const btnAddCategory = document.getElementById("btn-add-category");

const btnCloseCalendar = document.getElementById("btn-close-calendar");
const btnPrevMonth = document.getElementById("btn-prev-month");
const btnNextMonth = document.getElementById("btn-next-month");
const calendarMonthYear = document.getElementById("calendar-month-year");
const calendarDaysGrid = document.getElementById("calendar-days-grid");

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    // Load theme
    const storedTheme = localStorage.getItem("checklist_theme") || "default";
    applyTheme(storedTheme);

    // Set initial date to today
    selectedDate = getLocalDateString(new Date());
    updateDateDisplay();

    // Load organization name
    const storedOrgName = localStorage.getItem("checklist_org_name");
    if (storedOrgName) {
        orgTagEl.textContent = storedOrgName;
        inputOrgName.value = storedOrgName;
    } else {
        inputOrgName.value = "Checklist Organizacional";
        orgTagEl.textContent = "Checklist Organizacional";
    }

    // Prefill Supabase credentials (using code constants now)

    // Connect to Supabase
    connectSupabase();

    // Setup Auth and listen to session changes
    setupSupabaseAuth();

    // Initialize Lucide Icons
    lucide.createIcons();
}

// ----------------------------------------------------
// Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
    // Custom Calendar Modal Events
    btnOpenCalendar.addEventListener("click", () => {
        // Initialize calendar view to the currently selected date
        currentCalendarMonth = new Date(selectedDate + "T12:00:00");
        renderCalendarGrid();
        openModal(modalCalendar);
    });

    btnCloseCalendar.addEventListener("click", () => {
        closeModal(modalCalendar);
    });

    btnPrevMonth.addEventListener("click", () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
        renderCalendarGrid();
    });

    btnNextMonth.addEventListener("click", () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
        renderCalendarGrid();
    });

    // Toggle Task Complete (using event delegation)
    tasksListEl.addEventListener("click", (e) => {
        if (isEditMode || isHistoryMode) return;
        if (e.target.closest(".btn-task-action")) return;

        const item = e.target.closest(".task-item");
        if (!item) return;
        
        const isCompleting = !item.classList.contains("completed");
        if (isCompleting) {
            const checkbox = item.querySelector(".task-checkbox");
            if (checkbox) {
                const rect = checkbox.getBoundingClientRect();
                const x = rect.left + rect.width / 2 + window.scrollX;
                const y = rect.top + rect.height / 2 + window.scrollY;
                createConfettiBurst(x, y);
            }
        }
        
        const taskId = parseInt(item.dataset.id) || item.dataset.id; // handle uuid string or int
        toggleTask(taskId);
    });

    // Toggle Edit Mode
    btnToggleEdit.addEventListener("click", () => {
        isEditMode = !isEditMode;
        btnToggleEdit.classList.toggle("active", isEditMode);
        
        if (isEditMode) {
            btnToggleEdit.innerHTML = '<i data-lucide="check"></i>';
            btnToggleEdit.title = "Finalizar Edição";
            appContainer.classList.add("edit-mode-active");
        } else {
            btnToggleEdit.innerHTML = '<i data-lucide="edit-3"></i>';
            btnToggleEdit.title = "Editar Checklist";
            appContainer.classList.remove("edit-mode-active");
        }
        
        renderCategories();
        renderChecklist();
        lucide.createIcons();
    });

    // Edit Organization Name Inline
    orgTagEl.addEventListener("click", () => {
        const currentName = orgTagEl.textContent;
        const newName = prompt("Editar nome da organização:", currentName);
        if (newName && newName.trim()) {
            const trimmed = newName.trim();
            orgTagEl.textContent = trimmed;
            inputOrgName.value = trimmed;
            localStorage.setItem("checklist_org_name", trimmed);
        }
    });

    // Settings Modal
    btnManageTasks.addEventListener("click", () => openModal(modalManageTasks));
    btnCloseManageModal.addEventListener("click", () => closeModal(modalManageTasks));

    // Save Settings Inputs
    inputOrgName.addEventListener("input", (e) => {
        const val = e.target.value.trim() || "Checklist Organizacional";
        orgTagEl.textContent = val;
        localStorage.setItem("checklist_org_name", val);
    });

    // Add New Category (Settings Modal)
    btnAddCategory.addEventListener("click", async () => {
        const val = inputNewCategory.value.trim();
        if (val) {
            if (btnAddCategory.disabled) return;
            btnAddCategory.disabled = true;
            const originalText = btnAddCategory.innerHTML;
            btnAddCategory.innerHTML = "Salvando...";

            try {
                await addCategory(val);
                inputNewCategory.value = "";
            } finally {
                btnAddCategory.disabled = false;
                btnAddCategory.innerHTML = originalText;
            }
        }
    });

    // Add Task Modal
    btnAddTaskModal.addEventListener("click", () => {
        if (isHistoryMode) {
            alert("Não é possível adicionar tarefas no histórico.");
            return;
        }
        if (categories.length === 0) {
            alert("Cadastre pelo menos uma categoria/local nas configurações antes de adicionar tarefas.");
            return;
        }

        // Pré-selecionar a categoria/local atualmente ativo na barra de filtros
        if (currentFilter !== "all") {
            selectTaskCategory.value = currentFilter;
        } else if (categories.length > 0) {
            selectTaskCategory.value = categories[0].name;
        }

        // Pré-definir a data da tarefa com a data atualmente selecionada no calendário
        const taskDateInput = document.getElementById("task-date");
        if (taskDateInput) {
            taskDateInput.value = selectedDate;
        }

        openModal(modalAddTask);
    });
    btnCloseAddModal.addEventListener("click", () => closeModal(modalAddTask));

    // Form Add Task Submit
    formAddTask.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btnSubmit = formAddTask.querySelector("button[type='submit']");
        if (!btnSubmit || btnSubmit.disabled) return;
        
        btnSubmit.disabled = true;
        const originalText = btnSubmit.innerHTML;
        btnSubmit.innerHTML = `<span class="loading-spinner"></span> Salvando...`;

        const taskDateInput = document.getElementById("task-date");
        const taskDate = taskDateInput ? taskDateInput.value : null;

        try {
            await addTask(inputTaskTitle.value.trim(), selectTaskCategory.value, selectTaskRecurring.value, taskDate);
            inputTaskTitle.value = "";
            closeModal(modalAddTask);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }
    });

    // Reset Today's Checklist Progress
    btnResetChecklist.addEventListener("click", async () => {
        if (isHistoryMode) {
            alert("Não é possível reiniciar o histórico.");
            return;
        }
        if (confirm("Deseja desmarcar todas as tarefas e reiniciar o progresso de hoje?")) {
            await resetChecklistProgress();
        }
    });

    // Restore default database state
    btnResetDefault.addEventListener("click", async () => {
        if (confirm("Atenção: Isso restaurará as categorias (Tio Nan, Cassol, PUCRS) e tarefas padrão. O histórico anterior será mantido. Continuar?")) {
            await restoreDefaultSettings();
            closeModal(modalManageTasks);
        }
    });

    // Clear all tasks
    btnClearAll.addEventListener("click", async () => {
        if (confirm("Atenção: Isso ocultará todas as tarefas atuais. Suas categorias e histórico serão mantidos. Deseja continuar?")) {
            await clearAllTasks();
            closeModal(modalManageTasks);
        }
    });

    // Share report via WhatsApp
    btnShareReport.addEventListener("click", shareReport);

    // Theme Selection Event Listeners
    const themeBtns = document.querySelectorAll(".theme-selector-btn");
    themeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            applyTheme(btn.dataset.theme);
            renderChecklist();
        });
    });

    // Auth Listeners & Forms
    const formAuth = document.getElementById("form-auth");
    const inputAuthEmail = document.getElementById("auth-email");
    const inputAuthPassword = document.getElementById("auth-password");
    const btnAuthSubmit = document.getElementById("btn-auth-submit");
    const btnAuthToggle = document.getElementById("btn-auth-toggle");
    const authTitle = document.getElementById("auth-title");
    const authSubtitle = document.getElementById("auth-subtitle");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const btnLogout = document.getElementById("btn-logout");

    if (btnAuthToggle) {
        btnAuthToggle.addEventListener("click", () => {
            isAuthModeLogin = !isAuthModeLogin;
            authErrorMsg.style.display = "none";
            
            if (isAuthModeLogin) {
                authTitle.textContent = "Checklist Nuvem";
                authSubtitle.textContent = "Entre com seus dados para sincronizar suas tarefas e locais com segurança.";
                btnAuthSubmit.textContent = "Entrar";
                document.getElementById("auth-toggle-text").textContent = "Não tem uma conta?";
                btnAuthToggle.textContent = "Cadastre-se";
            } else {
                authTitle.textContent = "Criar Conta";
                authSubtitle.textContent = "Cadastre-se gratuitamente para manter seu checklist salvo na nuvem.";
                btnAuthSubmit.textContent = "Cadastrar Conta";
                document.getElementById("auth-toggle-text").textContent = "Já tem uma conta?";
                btnAuthToggle.textContent = "Fazer Login";
            }
        });
    }

    if (formAuth) {
        formAuth.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!supabaseClient) {
                alert("Erro: Conexão com Supabase não disponível.");
                return;
            }

            authErrorMsg.style.display = "none";
            btnAuthSubmit.disabled = true;
            const originalText = btnAuthSubmit.innerHTML;
            btnAuthSubmit.innerHTML = `<span class="loading-spinner"></span> Carregando...`;

            const email = inputAuthEmail.value.trim();
            const password = inputAuthPassword.value;

            try {
                if (isAuthModeLogin) {
                    const { error } = await supabaseClient.auth.signInWithPassword({
                        email,
                        password
                    });
                    if (error) throw error;
                } else {
                    const { data, error } = await supabaseClient.auth.signUp({
                        email,
                        password
                    });
                    if (error) throw error;
                    
                    // Se o Supabase retornar uma sessão imediatamente (confirmação desativada), loga automático!
                    if (data && data.session) {
                        // O onAuthStateChange cuidará do resto
                    } else {
                        alert("Conta criada com sucesso! Faça login para começar.");
                        isAuthModeLogin = true;
                        btnAuthToggle.click();
                    }
                }
            } catch (error) {
                console.error("Erro na autenticação:", error);
                authErrorMsg.textContent = error.message || "Erro desconhecido. Verifique suas credenciais.";
                authErrorMsg.style.display = "block";
            } finally {
                btnAuthSubmit.disabled = false;
                btnAuthSubmit.innerHTML = originalText;
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener("click", async () => {
            if (confirm("Deseja sair da sua conta?")) {
                if (supabaseClient) {
                    // Limpa todo o cache local do usuário anterior para evitar contaminação
                    localStorage.removeItem("offline_categories");
                    localStorage.removeItem("offline_tasks");
                    localStorage.removeItem("offline_completions");
                    
                    await supabaseClient.auth.signOut();
                    closeModal(modalManageTasks);
                }
            }
        });
    }
}

// ----------------------------------------------------
// Connection setup
// ----------------------------------------------------
function connectSupabase() {
    if (SUPABASE_URL && SUPABASE_KEY) {
        try {
            if (typeof supabase !== 'undefined') {
                supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
                console.log("Supabase conectado com chaves fixas.");
            } else {
                console.warn("Script SDK Supabase não carregado.");
                supabaseClient = null;
            }
        } catch (e) {
            console.error("Falha ao criar cliente Supabase: ", e);
            supabaseClient = null;
        }
    } else {
        supabaseClient = null;
    }
}

// ----------------------------------------------------
// UI Logic & Rendering
// ----------------------------------------------------
function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateObj = new Date(selectedDate + "T12:00:00"); // Avoid timezone shifting
    let dateString = dateObj.toLocaleDateString('pt-BR', options);
    dateString = dateString.charAt(0).toUpperCase() + dateString.slice(1);
    currentDateEl.textContent = dateString;
}

async function loadChecklistAndProgress() {
    await loadData();
    renderCategories();
    renderChecklist();
    updateProgress();
}

async function loadData() {
    if (supabaseClient) {
        try {
            // 1. Fetch categories
            let { data: dbCats, error: errCats } = await supabaseClient
                .from('categories')
                .select('*')
                .eq('is_active', true);
            
            if (errCats) throw errCats;
            
            // Seed default categories ONLY if the user has absolutely ZERO categories in their account (active or inactive)
            const { count, error: errCount } = await supabaseClient
                .from('categories')
                .select('*', { count: 'exact', head: true });

            if (!errCount && count === 0) {
                const seedCats = DEFAULT_CATEGORIES.map(name => ({ 
                    name, 
                    is_active: true,
                    user_id: currentUser ? currentUser.id : null
                }));
                const { data: seededCats, error: errSeedCats } = await supabaseClient
                    .from('categories')
                    .upsert(seedCats, { onConflict: 'name,user_id' })
                    .select();
                if (errSeedCats) throw errSeedCats;
                dbCats = seededCats;

                // Seed default tasks (in our case it's empty by default, but kept for structure)
                if (DEFAULT_TASKS.length > 0) {
                    const seedTasks = DEFAULT_TASKS.map(t => ({
                        title: t.title,
                        category: t.category,
                        is_recurring: t.is_recurring,
                        is_active: true,
                        user_id: currentUser ? currentUser.id : null
                    }));
                    await supabaseClient.from('tasks').insert(seedTasks);
                }
            }
            categories = dbCats;

            // 2. Fetch active tasks
            const { data: dbTasks, error: errTasks } = await supabaseClient
                .from('tasks')
                .select('*')
                .eq('is_active', true);
            
            if (errTasks) throw errTasks;

            // Fetch completions for today
            const { data: dbCompletionsToday, error: errCompToday } = await supabaseClient
                .from('completions')
                .select('*')
                .eq('date', selectedDate);
                
            if (errCompToday) throw errCompToday;

            // Fetch completions before today
            const { data: dbCompletionsBefore, error: errCompBefore } = await supabaseClient
                .from('completions')
                .select('task_id')
                .lt('date', selectedDate);
                
            if (errCompBefore) throw errCompBefore;

            const completedBeforeIds = new Set(dbCompletionsBefore.map(c => c.task_id));
            const completedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed).map(c => c.task_id));

            // Map tasks with Rollover and Recurrence
            tasks = dbTasks.filter(task => {
                const taskCreatedDate = task.created_at.split('T')[0];
                
                if (task.is_recurring) {
                    // Tarefas recorrentes aparecem a partir da data de criação
                    return taskCreatedDate <= selectedDate;
                } else {
                    // Tarefas únicas aparecem estritamente no dia para o qual foram programadas
                    return taskCreatedDate === selectedDate;
                }
            }).map(task => ({
                id: task.id,
                title: task.title,
                category: task.category,
                is_recurring: task.is_recurring,
                completed: completedTodayIds.has(task.id)
            }));

        } catch (error) {
            console.error("Erro ao consultar Supabase. Usando fallback offline.", error);
            loadDataOffline();
        }
    } else {
        loadDataOffline();
    }
}

function loadDataOffline() {
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const isSeeded = localStorage.getItem("checklist_categories_seeded");
    if (localCats.length === 0 && !isSeeded) {
        localCats = DEFAULT_CATEGORIES.map((name, i) => ({
            id: i + 1,
            name: name,
            is_active: true
        }));
        localStorage.setItem("checklist_categories_seeded", "true");
        localStorage.setItem("offline_categories", JSON.stringify(localCats));
    }
    categories = localCats.filter(c => c.is_active);

    // 2. Fetch tasks offline
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    if (localTasks.length === 0) {
        localTasks = DEFAULT_TASKS.map((t, i) => ({
            id: i + 1,
            title: t.title,
            category: t.category,
            is_recurring: true,
            is_active: true,
            created_at: new Date().toISOString()
        }));
        localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    }

    // 3. Fetch completions
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];

    const completedBeforeIds = new Set(
        localCompletions.filter(c => c.date < selectedDate && c.completed).map(c => c.task_id)
    );
    const completedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed).map(c => c.task_id)
    );

    // Map tasks
    tasks = localTasks.filter(task => {
        if (!task.is_active) return false;
        
        const taskCreatedDate = task.created_at.split('T')[0];
        
        if (task.is_recurring) {
            // Tarefas recorrentes aparecem a partir da data de criação
            return taskCreatedDate <= selectedDate;
        } else {
            // Tarefas únicas aparecem estritamente no dia para o qual foram programadas
            return taskCreatedDate === selectedDate;
        }
    }).map(task => ({
        id: task.id,
        title: task.title,
        category: task.category,
        is_recurring: task.is_recurring,
        completed: completedTodayIds.has(task.id)
    }));
}

function renderCategories() {
    const bar = document.getElementById("categories-bar");
    const select = document.getElementById("task-category");
    const manageList = document.getElementById("manage-categories-list");

    // 1. Render Category Filter Chips
    const activeCategory = currentFilter;
    bar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.className = `category-chip ${activeCategory === 'all' ? 'active' : ''}`;
    allChip.dataset.category = "all";
    allChip.innerHTML = `
        <i data-lucide="layers" class="chip-icon"></i>
        <span>Todos</span>
    `;
    
    allChip.addEventListener("click", () => {
        document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
        allChip.classList.add("active");
        currentFilter = "all";
        renderChecklist();
    });
    bar.appendChild(allChip);

    categories.forEach(cat => {
        const chip = document.createElement("button");
        chip.className = `category-chip ${activeCategory === cat.name ? 'active' : ''}`;
        chip.dataset.category = cat.name;
        chip.innerHTML = `
            <i data-lucide="map-pin" class="chip-icon"></i>
            <span>${escapeHTML(cat.name)}</span>
        `;

        if (isEditMode) {
            chip.setAttribute("draggable", "true");
            setupDragAndDrop(chip, cat);
        }
        
        chip.addEventListener("click", () => {
            if (isEditMode) return; // Disable filtering click in edit mode
            document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentFilter = cat.name;
            renderChecklist();
        });
        bar.appendChild(chip);
    });

    // 2. Render options in task category dropdown
    select.innerHTML = "";
    categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.name;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });

    // 3. Render categories list in Settings Modal
    manageList.innerHTML = "";
    if (categories.length === 0) {
        manageList.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding: 10px;">Nenhum local cadastrado.</p>`;
    } else {
        categories.forEach(cat => {
            const item = document.createElement("div");
            item.className = "manage-item";
            item.style.cssText = "background:rgba(255,255,255,0.02); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;";
            item.innerHTML = `
                <span style="font-size:0.88rem; font-weight:600;">${escapeHTML(cat.name)}</span>
                <button class="btn-delete-cat" data-id="${cat.id}" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:4px; transition:var(--transition-smooth); display:flex; align-items:center; justify-content:center;">
                    <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                </button>
            `;
            
            const btnDel = item.querySelector(".btn-delete-cat");
            btnDel.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
            });
            
            manageList.appendChild(item);
        });
    }
}

function renderChecklist() {
    tasksListEl.innerHTML = "";
    
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
        if (currentFilter === "all") return true;
        return task.category === currentFilter;
    });

    if (isEditMode) {
        tasksListEl.classList.add("edit-mode");
    } else {
        tasksListEl.classList.remove("edit-mode");
    }

    if (filteredTasks.length === 0) {
        emptyStateEl.classList.remove("hidden");
        tasksListEl.classList.add("hidden");
    } else {
        emptyStateEl.classList.add("hidden");
        tasksListEl.classList.remove("hidden");

        // Sort: unchecked first, completed last. Within groups, sort by ID
        const sortedTasks = isEditMode
            ? [...filteredTasks].sort((a, b) => {
                const idA = typeof a.id === 'number' ? a.id : parseFloat(a.id) || 0;
                const idB = typeof b.id === 'number' ? b.id : parseFloat(b.id) || 0;
                return idA - idB;
            })
            : [...filteredTasks].sort((a, b) => {
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1;
                }
                const idA = typeof a.id === 'number' ? a.id : parseFloat(a.id) || 0;
                const idB = typeof b.id === 'number' ? b.id : parseFloat(b.id) || 0;
                return idA - idB;
            });

        sortedTasks.forEach(task => {
            const taskEl = document.createElement("div");
            taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
            taskEl.dataset.id = task.id;

            // Generate premium dynamic tag style based on category name
            const colorStyle = getCategoryColorStyle(task.category);
            const tagStyle = `color: ${colorStyle.color}; background: ${colorStyle.bg}; border: 1px solid rgba(255,255,255,0.03);`;

            taskEl.innerHTML = `
                <div class="task-checkbox-wrapper">
                    <div class="task-checkbox">
                        <i data-lucide="check"></i>
                    </div>
                </div>
                <div class="task-content">
                    <span class="task-title">${escapeHTML(task.title)}</span>
                    <div class="task-meta">
                        <span class="task-tag" style="${tagStyle}">${escapeHTML(task.category)}</span>
                        <span class="task-tag" style="background: rgba(255,255,255,0.02);">${task.is_recurring ? 'Diária' : 'Única'}</span>
                    </div>
                </div>
                <div class="task-edit-actions">
                    <button class="btn-task-action rename" title="Renomear">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-task-action delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            `;

            // Setup button event listeners
            const btnDelete = taskEl.querySelector(".btn-task-action.delete");
            btnDelete.addEventListener("click", (e) => {
                e.stopPropagation();
                // Play smooth deletion animation first
                taskEl.classList.add("deleting");
                setTimeout(() => {
                    deleteTask(task.id);
                }, 400);
            });

            const btnRename = taskEl.querySelector(".btn-task-action.rename");
            btnRename.addEventListener("click", (e) => {
                e.stopPropagation();
                const newTitle = prompt("Editar descrição da tarefa:", task.title);
                if (newTitle && newTitle.trim()) {
                    renameTask(task.id, newTitle.trim());
                }
            });

            tasksListEl.appendChild(taskEl);
        });
        
        lucide.createIcons();
    }
}

function renderChecklistWithAnimation() {
    // 1. FIRST
    const items = Array.from(tasksListEl.children);
    const firstPositions = {};
    items.forEach(item => {
        const id = item.dataset.id;
        if (id) {
            firstPositions[id] = item.getBoundingClientRect();
        }
    });

    // 2. State change (render DOM)
    renderChecklist();

    // 3. LAST, INVERT & PLAY
    const newItems = Array.from(tasksListEl.children);
    newItems.forEach(item => {
        const id = item.dataset.id;
        if (id && firstPositions[id]) {
            const firstRect = firstPositions[id];
            const lastRect = item.getBoundingClientRect();
            const deltaY = firstRect.top - lastRect.top;

            if (deltaY !== 0) {
                item.style.transition = 'none';
                item.style.transform = `translateY(${deltaY}px)`;
                item.offsetHeight; // force reflow

                item.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
                item.style.transform = 'translateY(0)';
                
                item.addEventListener('transitionend', function cleanup() {
                    item.style.transition = '';
                    item.style.transform = '';
                    item.removeEventListener('transitionend', cleanup);
                });
            }
        }
    });
}

function updateProgress() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    // Update text
    progressPercentageEl.textContent = `${percentage}%`;
    progressTasksCountEl.textContent = `${completed} de ${total} concluídos`;

    // Update Linear progress bar
    progressBarFill.style.width = `${percentage}%`;

    // Update Circular progress ring
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    const offset = circumference - (percentage / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;

    if (percentage === 100 && total > 0) {
        progressRingWrapper.classList.add("completed");
    } else {
        progressRingWrapper.classList.remove("completed");
    }
}

// ----------------------------------------------------
// State Management & Storage
// ----------------------------------------------------
async function toggleTask(id) {
    if (isHistoryMode) return;
    
    // Prevent duplicate triggers if request is already in progress
    if (pendingToggles.has(id)) return;
    pendingToggles.add(id);

    // Toggle local state immediately for visual response
    tasks = tasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, completed: !t.completed };
        return t;
    });
    updateProgress();
    renderChecklistWithAnimation();
    
    if (navigator.vibrate) {
        navigator.vibrate(12);
    }

    const task = tasks.find(t => String(t.id) === String(id));
    if (!task) {
        pendingToggles.delete(id);
        return;
    }

    if (supabaseClient) {
        try {
            if (task.completed) {
                const { error } = await supabaseClient
                    .from('completions')
                    .upsert({
                        task_id: id,
                        date: selectedDate,
                        completed: true
                    }, { onConflict: 'task_id,date' });
                if (error) throw error;
            } else {
                const { error } = await supabaseClient
                    .from('completions')
                    .delete()
                    .eq('task_id', id)
                    .eq('date', selectedDate);
                if (error) throw error;
            }
        } catch (error) {
            console.error("Erro ao atualizar conclusão no Supabase. Salvando offline.", error);
            saveCompletionOffline(id, selectedDate, task.completed);
        } finally {
            pendingToggles.delete(id);
        }
    } else {
        saveCompletionOffline(id, selectedDate, task.completed);
        pendingToggles.delete(id);
    }
}

function saveCompletionOffline(taskId, date, completed) {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => !(String(c.task_id) === String(taskId) && c.date === date));
    
    if (completed) {
        localCompletions.push({
            task_id: taskId,
            date: date,
            completed: true
        });
    }
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
}

async function addTask(title, category, isRecurringString, customDate) {
    if (!title) return;
    const isRecurring = isRecurringString === "true";
    const tempId = Date.now();
    
    // Evita problemas de fuso horário definindo a data ao meio-dia
    const createdAtDate = customDate ? new Date(customDate + "T12:00:00") : new Date();
    const createdAt = createdAtDate.toISOString();

    const newTask = {
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };
    if (currentUser) {
        newTask.user_id = currentUser.id;
    }

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .insert(newTask);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao inserir no Supabase. Salvando offline.", error);
            addTaskOffline(title, category, isRecurring, tempId, createdAt);
        }
    } else {
        addTaskOffline(title, category, isRecurring, tempId, createdAt);
    }
}

function addTaskOffline(title, category, isRecurring, id, createdAt) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks.push({
        id: id,
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function renameTask(id, newTitle) {
    if (!newTitle) return;

    // Atualização otimista local imediata
    tasks = tasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, title: newTitle };
        return t;
    });
    renderChecklist();

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .update({ title: newTitle })
                .eq('id', id);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao renomear no Supabase. Renomeando offline.", error);
            renameTaskOffline(id, newTitle);
        }
    } else {
        renameTaskOffline(id, newTitle);
    }
}

function renameTaskOffline(id, newTitle) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, title: newTitle };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
}

async function deleteTask(id) {
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);

    // Atualização otimista local imediata (remove da lista local antes de bater no banco)
    tasks = tasks.filter(t => String(t.id) !== String(id));
    updateProgress();

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .update({ is_active: false })
                .eq('id', id);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao deletar no Supabase. Deletando offline.", error);
            deleteTaskOffline(id);
        } finally {
            pendingDeletes.delete(id);
        }
    } else {
        deleteTaskOffline(id);
        pendingDeletes.delete(id);
    }
}

function deleteTaskOffline(id) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, is_active: false };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function addCategory(name) {
    if (!name) return;

    const newCat = {
        name: name,
        is_active: true
    };
    if (currentUser) {
        newCat.user_id = currentUser.id;
    }

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('categories')
                .insert(newCat);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao inserir categoria no Supabase: ", e);
            addCategoryOffline(name);
        }
    } else {
        addCategoryOffline(name);
    }
}

function addCategoryOffline(name) {
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    if (localCats.some(c => c.name.toLowerCase() === name.toLowerCase() && c.is_active)) {
        alert("Este local/categoria já existe.");
        return;
    }
    localCats.push({
        id: Date.now(),
        name: name,
        is_active: true
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadCategoriesOffline();
    renderCategories();
}

async function deleteCategory(id) {
    if (confirm("Deseja mesmo excluir este local? As tarefas dele não aparecerão hoje. O histórico passado será mantido.")) {
        if (supabaseClient) {
            try {
                const { error } = await supabaseClient
                    .from('categories')
                    .update({ is_active: false })
                    .eq('id', id);
                if (error) throw error;
                
                await loadChecklistAndProgress();
            } catch (e) {
                console.error("Erro ao deletar categoria no Supabase: ", e);
                deleteCategoryOffline(id);
            }
        } else {
            deleteCategoryOffline(id);
        }
    }
}

function deleteCategoryOffline(id) {
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => {
        if (String(c.id) === String(id)) return { ...c, is_active: false };
        return c;
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadCategoriesOffline();
    renderCategories();
    
    const cat = categories.find(c => String(c.id) === String(id));
    if (cat && currentFilter === cat.name) {
        currentFilter = "all";
    }
    
    loadChecklistAndProgress();
}

async function resetChecklistProgress() {
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('completions')
                .delete()
                .eq('date', selectedDate);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao resetar progresso no Supabase.", e);
            resetChecklistProgressOffline();
        }
    } else {
        resetChecklistProgressOffline();
    }
}

function resetChecklistProgressOffline() {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => c.date !== selectedDate);
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function restoreDefaultSettings() {
    if (supabaseClient) {
        try {
            // Soft-delete current categories and tasks
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            await supabaseClient.from('categories').update({ is_active: false }).eq('is_active', true);
            
            // Insert default categories
            const seedCats = DEFAULT_CATEGORIES.map(name => ({ 
                name, 
                is_active: true,
                user_id: currentUser ? currentUser.id : null
            }));
            const { data: seededCats, error: errSeedCats } = await supabaseClient
                .from('categories')
                .upsert(seedCats, { onConflict: 'name,user_id' })
                .select();
            if (errSeedCats) throw errSeedCats;
            
            // Insert default tasks
            const seedTasks = DEFAULT_TASKS.map(t => ({
                title: t.title,
                category: t.category,
                is_recurring: t.is_recurring,
                is_active: true,
                user_id: currentUser ? currentUser.id : null
            }));
            await supabaseClient.from('tasks').insert(seedTasks);
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao restaurar padrões online. Restaurando offline.", e);
            restoreDefaultSettingsOffline();
        }
    } else {
        restoreDefaultSettingsOffline();
    }
}

function restoreDefaultSettingsOffline() {
    // Categories
    localStorage.removeItem("checklist_categories_seeded");
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => ({ ...c, is_active: false }));
    DEFAULT_CATEGORIES.forEach((name, i) => {
        localCats.push({
            id: Date.now() + i,
            name: name,
            is_active: true
        });
    });
    localStorage.setItem("checklist_categories_seeded", "true");
    localStorage.setItem("offline_categories", JSON.stringify(localCats));

    // Tasks
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => ({ ...t, is_active: false }));
    const createdAt = new Date().toISOString();
    DEFAULT_TASKS.forEach((t, i) => {
        localTasks.push({
            id: Date.now() + i + 100,
            title: t.title,
            category: t.category,
            is_recurring: t.is_recurring,
            is_active: true,
            created_at: createdAt
        });
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));

    loadDataOffline();
    renderCategories();
    renderChecklist();
    updateProgress();
}

async function clearAllTasks() {
    if (supabaseClient) {
        try {
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao limpar tarefas online. Limpando offline.", e);
            clearAllTasksOffline();
        }
    } else {
        clearAllTasksOffline();
    }
}

function clearAllTasksOffline() {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => ({ ...t, is_active: false }));
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

// ----------------------------------------------------
// Helper Utilities
// ----------------------------------------------------
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function shareReport() {
    if (tasks.length === 0) {
        alert("Adicione tarefas antes de exportar um relatório.");
        return;
    }

    const dateObj = new Date(selectedDate + "T12:00:00");
    const formattedDateStr = dateObj.toLocaleDateString('pt-BR');
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    let reportText = `📋 *RELATÓRIO CHECKLIST DIÁRIO*\n`;
    reportText += `📅 *Data:* ${formattedDateStr}\n`;
    reportText += `📊 *Progresso:* ${percentage}% (${completed} de ${total} concluídos)\n\n`;

    // Agrupar tarefas pelas categorias ativas no checklist de hoje
    const activeCatsInTasks = [...new Set(tasks.map(t => t.category))];
    
    activeCatsInTasks.forEach(catName => {
        const catTasks = tasks.filter(t => t.category === catName);
        if (catTasks.length > 0) {
            reportText += `*${catName}:*\n`;
            catTasks.forEach(task => {
                const mark = task.completed ? "✅" : "❌";
                reportText += `${mark} ${task.title}\n`;
            });
            reportText += `\n`;
        }
    });

    navigator.clipboard.writeText(reportText).then(() => {
        const encodedText = encodeURIComponent(reportText);
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        alert("Relatório copiado para a área de transferência! Abrindo o WhatsApp...");
        window.open(whatsappUrl, "_blank");
    }).catch(err => {
        console.error("Falha ao copiar relatório: ", err);
        const encodedText = encodeURIComponent(reportText);
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        window.open(whatsappUrl, "_blank");
    });
}

function createConfettiBurst(x, y) {
    const particleCount = 10;
    const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement("span");
        particle.className = "confetti-particle";
        
        const color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.background = color;
        particle.style.boxShadow = `0 0 6px ${color}`;
        
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        
        const angle = (i / particleCount) * 2 * Math.PI + (Math.random() * 0.4 - 0.2);
        const distance = 20 + Math.random() * 20;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        
        particle.style.setProperty('--tx', `${tx}px`);
        particle.style.setProperty('--ty', `${ty}px`);
        
        document.body.appendChild(particle);
        
        setTimeout(() => {
            particle.remove();
        }, 700);
    }
}

function getCategoryColorStyle(categoryName) {
    const name = categoryName || "Outros";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 80%, 65%)`;
    const bg = `hsla(${hue}, 80%, 65%, 0.12)`;
    return { color, bg };
}

// Modal Helpers
function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove("active");
    document.body.style.overflow = "";
}

// Theme Helper
function applyTheme(themeName) {
    currentTheme = themeName;
    localStorage.setItem("checklist_theme", themeName);

    // Remove active classes
    document.body.classList.remove("theme-light", "theme-girly");

    // Add selected theme class
    if (themeName === "light") {
        document.body.classList.add("theme-light");
    } else if (themeName === "girly") {
        document.body.classList.add("theme-girly");
    }

    // Update active state on buttons inside Settings modal
    document.querySelectorAll(".theme-selector-btn").forEach(btn => {
        if (btn.dataset.theme === themeName) {
            btn.classList.add("active");
            btn.style.borderColor = "var(--primary)";
        } else {
            btn.classList.remove("active");
            btn.style.borderColor = "var(--border-color)";
        }
    });
}

// Supabase Auth and Sync helpers
function setupSupabaseAuth() {
    if (!supabaseClient) {
        document.getElementById("auth-container").style.display = "none";
        document.querySelector(".app-container").style.display = "flex";
        loadChecklistAndProgress();
        return;
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log("Supabase Auth Change:", event, session);
        if (session) {
            currentUser = session.user;
            document.getElementById("auth-container").style.display = "none";
            document.querySelector(".app-container").style.display = "flex";
            
            // Sync local data to cloud
            await syncOfflineDataToCloud();
            
            await loadChecklistAndProgress();
            lucide.createIcons();
        } else {
            currentUser = null;
            document.getElementById("auth-container").style.display = "flex";
            document.querySelector(".app-container").style.display = "none";
            
            // Limpa o cache local ao deslogar para evitar contaminação
            localStorage.removeItem("offline_categories");
            localStorage.removeItem("offline_tasks");
            localStorage.removeItem("offline_completions");
            
            tasks = [];
            categories = [];
            renderCategories();
            renderChecklist();
        }
    });
}

async function syncOfflineDataToCloud() {
    if (!supabaseClient || !currentUser) return;
    
    const offlineCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const offlineTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    
    if (offlineCats.length === 0 && offlineTasks.length === 0) return;
    
    try {
        console.log("Sincronizando dados locais com o Supabase Auth...");
        
        for (const cat of offlineCats) {
            const { data } = await supabaseClient
                .from('categories')
                .select('id')
                .eq('name', cat.name)
                .maybeSingle();
                
            if (!data) {
                await supabaseClient
                    .from('categories')
                    .insert({ name: cat.name, is_active: cat.is_active });
            }
        }
        
        for (const task of offlineTasks) {
            const { data } = await supabaseClient
                .from('tasks')
                .select('id')
                .eq('title', task.title)
                .eq('category', task.category)
                .maybeSingle();
                
            if (!data) {
                await supabaseClient
                    .from('tasks')
                    .insert({
                        title: task.title,
                        category: task.category,
                        is_recurring: task.is_recurring,
                        is_active: task.is_active
                    });
            }
        }
        
        localStorage.removeItem("offline_categories");
        localStorage.removeItem("offline_tasks");
        console.log("Sincronização concluída.");
    } catch (e) {
        console.error("Erro na sincronização:", e);
    }
}

function renderCalendarGrid() {
    calendarDaysGrid.innerHTML = "";

    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();

    // Set month and year title
    const monthNames = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    calendarMonthYear.textContent = `${monthNames[month]} ${year}`;

    // First day of the month
    const firstDayIndex = new Date(year, month, 1).getDay();

    // Last day of the current month
    const lastDay = new Date(year, month + 1, 0).getDate();

    // Last day of the previous month
    const prevLastDay = new Date(year, month, 0).getDate();

    // Days from previous month (to fill the start grid gap)
    for (let i = firstDayIndex; i > 0; i--) {
        const dayNum = prevLastDay - i + 1;
        const btn = document.createElement("button");
        btn.className = "calendar-day other-month";
        btn.disabled = true;
        btn.textContent = dayNum;
        calendarDaysGrid.appendChild(btn);
    }

    // Days of the current month
    const todayStr = getLocalDateString(new Date());
    for (let i = 1; i <= lastDay; i++) {
        const btn = document.createElement("button");
        btn.className = "calendar-day";
        
        // Format this date
        const dayStr = String(i).padStart(2, '0');
        const monthStr = String(month + 1).padStart(2, '0');
        const dateStr = `${year}-${monthStr}-${dayStr}`;

        // Highlights
        if (dateStr === selectedDate) {
            btn.classList.add("selected");
        }
        if (dateStr === todayStr) {
            btn.classList.add("today");
        }

        btn.textContent = i;

        btn.addEventListener("click", async () => {
            selectedDate = dateStr;
            
            // Check if viewing history
            isHistoryMode = (selectedDate !== todayStr);
            
            if (isHistoryMode) {
                appContainer.classList.add("history-mode");
                isEditMode = false; // Turn off editing when viewing history
                btnToggleEdit.classList.remove("active");
                btnToggleEdit.innerHTML = '<i data-lucide="edit-3"></i>';
                btnToggleEdit.title = "Editar Checklist";
            } else {
                appContainer.classList.remove("history-mode");
            }

            updateDateDisplay();
            await loadChecklistAndProgress();
            closeModal(modalCalendar);
            lucide.createIcons();
        });

        calendarDaysGrid.appendChild(btn);
    }

    // Fill remaining grid space (days of next month to make a nice grid)
    const totalCells = firstDayIndex + lastDay;
    const nextMonthCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= nextMonthCells; i++) {
        const btn = document.createElement("button");
        btn.className = "calendar-day other-month";
        btn.disabled = true;
        btn.textContent = i;
        calendarDaysGrid.appendChild(btn);
    }
}

// Drag & Drop Category Reordering logic
let draggedElement = null;

function setupDragAndDrop(chip, cat) {
    // Mouse dragging
    chip.addEventListener("dragstart", (e) => {
        if (!isEditMode) {
            e.preventDefault();
            return;
        }
        draggedElement = chip;
        chip.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });

    chip.addEventListener("dragover", (e) => {
        if (!isEditMode || !draggedElement) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        
        const rect = chip.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        
        if (e.clientX < midpoint) {
            chip.parentNode.insertBefore(draggedElement, chip);
        } else {
            chip.parentNode.insertBefore(draggedElement, chip.nextSibling);
        }
    });

    chip.addEventListener("dragend", () => {
        if (!isEditMode) return;
        chip.classList.remove("dragging");
        draggedElement = null;
        saveCategoryOrder();
    });

    // Touch support for mobile dragging
    chip.addEventListener("touchstart", (e) => {
        if (!isEditMode) return;
        draggedElement = chip;
        chip.classList.add("dragging");
    });

    chip.addEventListener("touchmove", (e) => {
        if (!isEditMode || !draggedElement) return;
        
        const touch = e.touches[0];
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!elementUnderTouch) return;

        const targetChip = elementUnderTouch.closest(".category-chip");
        if (targetChip && targetChip !== draggedElement && targetChip.dataset.category !== "all") {
            const rect = targetChip.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            
            if (touch.clientX < midpoint) {
                targetChip.parentNode.insertBefore(draggedElement, targetChip);
            } else {
                targetChip.parentNode.insertBefore(draggedElement, targetChip.nextSibling);
            }
            e.preventDefault(); // Prevent scroll while dragging
        }
    });

    chip.addEventListener("touchend", () => {
        if (!isEditMode || !draggedElement) return;
        draggedElement.classList.remove("dragging");
        draggedElement = null;
        saveCategoryOrder();
    });
}

async function saveCategoryOrder() {
    const bar = document.getElementById("categories-bar");
    const chips = Array.from(bar.querySelectorAll(".category-chip"));
    
    // Extract names in order
    const orderedNames = chips
        .map(c => c.dataset.category)
        .filter(name => name !== "all");

    // Reorder state array
    const reorderedCategories = [];
    orderedNames.forEach(name => {
        const cat = categories.find(c => c.name === name);
        if (cat) {
            reorderedCategories.push(cat);
        }
    });

    categories.forEach(cat => {
        if (!reorderedCategories.some(c => c.id === cat.id)) {
            reorderedCategories.push(cat);
        }
    });

    categories = reorderedCategories;

    // Save offline
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const orderedLocalCats = [];
    categories.forEach(cat => {
        const localCat = localCats.find(c => String(c.id) === String(cat.id));
        if (localCat) orderedLocalCats.push(localCat);
    });
    localCats.forEach(localCat => {
        if (!orderedLocalCats.some(c => String(c.id) === String(localCat.id))) {
            orderedLocalCats.push(localCat);
        }
    });
    localStorage.setItem("offline_categories", JSON.stringify(orderedLocalCats));

    // Save order online to Supabase if order column is available
    if (supabaseClient) {
        try {
            const promises = categories.map((cat, index) => {
                return supabaseClient
                    .from('categories')
                    .update({ sort_order: index })
                    .eq('id', cat.id);
            });
            await Promise.all(promises);
            console.log("Ordem de categorias atualizada no Supabase.");
        } catch (e) {
            console.warn("Dica: Adicione a coluna 'sort_order' na tabela 'categories' para salvar a ordem online!");
        }
    }
}
