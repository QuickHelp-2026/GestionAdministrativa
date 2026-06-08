/* ============================================================
   SISTEMA DE GESTIÓN ADMINISTRATIVA — app.js
   Frontend principal — Bootstrap 5 + Vanilla JS
   ============================================================ */

'use strict';

// ============================================================
// ESTADO GLOBAL
// ============================================================
const App = {
  user:        null,
  currentView: 'dashboard',
  cache: {
    proyectos: [], listas: {}, usuarios: [],
    sla: [], records: {}, pendingAlerts: 0,
  },
  charts: {},
};

// ============================================================
// CONSTANTES
// ============================================================
const MODULOS = {
  INASISTENCIAS:    { label: 'Inasistencias',    icon: 'bi-calendar-x',          sheetKey: 'INASISTENCIAS'    },
  INCAPACIDADES:    { label: 'Incapacidades',    icon: 'bi-heart-pulse',          sheetKey: 'INCAPACIDADES'    },
  CONTRATACIONES:   { label: 'Contrataciones',   icon: 'bi-person-plus',          sheetKey: 'CONTRATACIONES'   },
  DESVINCULACIONES: { label: 'Desvinculaciones', icon: 'bi-person-dash',          sheetKey: 'DESVINCULACIONES' },
  PROCESOS:         { label: 'Procesos',         icon: 'bi-clipboard2-pulse',     sheetKey: 'PROCESOS'         },
  OTROS_SI:         { label: 'Otrosí',           icon: 'bi-file-earmark-text',    sheetKey: 'OTROS_SI'         },
  DESCUENTOS:       { label: 'Descuentos',       icon: 'bi-currency-dollar',      sheetKey: 'DESCUENTOS'       },
  NOVEDADES_MASIVAS:{ label: 'Nov. Masivas',     icon: 'bi-people',               sheetKey: 'NOVEDADES_MASIVAS'},
};

const SUBCATEGORIAS = {
  INASISTENCIAS:    ['Permiso remunerado','Permiso no remunerado','Ausencia injustificada','Licencia por luto','Licencia por paternidad','Calamidad doméstica'],
  CONTRATACIONES:   ['Vacante nueva','Reemplazo por renuncia'],
  DESVINCULACIONES: ['Renuncia','Terminación con justa causa','Terminación por obra o labor','Terminación periodo de prueba'],
  PROCESOS:         ['Proceso disciplinario','Proceso de seguridad'],
  OTROS_SI:         ['Cambio de centro de costos','Traslado horizontal','Cambio de operación','Cambio de ciudad','Cambio de cargo'],
};

// Estados del sistema
// Coordinador crea → siempre "Pendiente"
// Legalizador puede cambiar a: En Proceso, Finalizado, Cancelado
// Administrador puede cambiar a cualquiera
const ESTADOS_COLORS = {
  'Pendiente':   'badge-pendiente',
  'En Proceso':  'badge-en-proceso',
  'Finalizado':  'badge-completado',
  'Cancelado':   'badge-rechazado',
};

// Estados que puede asignar el Legalizador/Admin
const ESTADOS_GESTION = ['Pendiente', 'En Proceso', 'Finalizado', 'Cancelado'];

// ============================================================
// API — Comunicación con Google Apps Script
// ============================================================
// Orden de prioridad:
//  1. GAS_URL configurada en config.js → fetch POST al endpoint GAS
//  2. Dentro del propio GAS          → google.script.run
//  3. Sin configuración              → datos mock locales
// ============================================================
const API = {
  call(params) {
    return new Promise((resolve, reject) => {
      // 1. GitHub Pages → GAS via POST con Content-Type "text/plain".
      //    text/plain = petición "simple" → sin preflight OPTIONS (que GAS no responde).
      //    El payload viaja en el body, NO en la URL → no hay límite de longitud
      //    (antes el Base64 de los archivos saturaba ?data= y daba 413 / CORS).
      if (typeof GAS_URL !== 'undefined' && GAS_URL) {
        fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          redirect: 'follow', // GAS responde con un 302 a googleusercontent.com
          body: JSON.stringify(params),
        })
          .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(parsed => {
            if (parsed.success) resolve(parsed.data);
            else reject(new Error(parsed.error || 'Error en el servidor'));
          })
          .catch(err => reject(new Error('Error de conexión con el servidor: ' + err.message)));
        return;
      }
      // 2. Servido desde el propio GAS
      if (typeof google !== 'undefined' && google.script) {
        google.script.run
          .withSuccessHandler(res => {
            try {
              const parsed = typeof res === 'string' ? JSON.parse(res) : res;
              if (parsed.success) resolve(parsed.data);
              else reject(new Error(parsed.error || 'Error desconocido'));
            } catch(e) { reject(e); }
          })
          .withFailureHandler(err => reject(new Error(err.message || String(err))))
          .apiCall(JSON.stringify(params));
        return;
      }
      // 3. Modo demo / desarrollo local
      resolve(API.mockResponse(params));
    });
  },

  mockResponse(p) {
    const mock = {
      login: { id:'USR_001', nombre:'Administrador Demo', email:p.email, rol:'Administrador', proyecto:'Todos' },
      initSystem: { spreadsheetId:'demo', message:'Demo mode' },
      getProyectos: [
        { id:'PRY_001', nombre:'Proyecto Alpha', cliente:'Cliente A', ciudad:'Bogotá', estado:'Activo' },
        { id:'PRY_002', nombre:'Proyecto Beta',  cliente:'Cliente B', ciudad:'Medellín', estado:'Activo' },
      ],
      getListas: [
        { id:'LST_001', tipo: p.tipo, valor:'Opción 1', estado:'Activo', orden:1 },
        { id:'LST_002', tipo: p.tipo, valor:'Opción 2', estado:'Activo', orden:2 },
      ],
      getAllListas: [
        { id:'LST_001', tipo:'Ciudad',    valor:'Bogotá',   estado:'Activo', orden:1 },
        { id:'LST_002', tipo:'Ciudad',    valor:'Medellín', estado:'Activo', orden:2 },
        { id:'LST_003', tipo:'Operacion', valor:'Customer Service', estado:'Activo', orden:1 },
      ],
      getUsers: [
        { id:'USR_001', nombre:'Administrador',  email:'admin@sistema.com',        rol:'Administrador', proyecto:'Todos', estado:'Activo' },
        { id:'USR_002', nombre:'Legalizador Demo',email:'legalizador@sistema.com', rol:'Legalizador',    proyecto:'Todos', estado:'Activo' },
        { id:'USR_003', nombre:'Coordinador 1',  email:'coord@sistema.com',        rol:'Coordinador',   proyecto:'Proyecto Alpha', estado:'Activo' },
      ],
      getRecords: generateMockRecords(p.modulo || 'INASISTENCIAS', 8),
      getDashboardData: {
        stats: { total:127, pendientes:34, enProceso:21, completados:62, rechazados:10, vencidos:5 },
        porModulo: { INASISTENCIAS:28, INCAPACIDADES:22, CONTRATACIONES:18, DESVINCULACIONES:12, PROCESOS:15, OTROS_SI:20, DESCUENTOS:8, NOVEDADES_MASIVAS:4 },
        porProyecto: { 'Proyecto Alpha':65, 'Proyecto Beta':62 },
        porCoord: { 'Juan García':42, 'María López':38, 'Carlos Ruiz':30, 'Ana Torres':17 },
        porCiudad: { 'Bogotá':70, 'Medellín':40, 'Cali':17 },
        avgGestion: 36.4,
        recientes: generateMockRecords('INASISTENCIAS', 5),
      },
      getSLA: [
        { tipoGestion:'Inasistencias', horasMaximas:24, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Incapacidades', horasMaximas:24, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Contrataciones', horasMaximas:48, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Desvinculaciones', horasMaximas:48, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Procesos', horasMaximas:72, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Otros_Si', horasMaximas:72, alertaEmail:'admin@sistema.com' },
        { tipoGestion:'Descuentos', horasMaximas:48, alertaEmail:'admin@sistema.com' },
      ],
      getAuditoria: generateMockAuditoria(20),
      saveRecord:   { id: 'NEW_' + Date.now() },
      updateRecord: { id: p.id },
      saveUser:     { id: 'USR_' + Date.now() },
      updateUser:   { id: p.id },
      saveProyecto: { id: 'PRY_' + Date.now() },
      saveLista:    { id: 'LST_' + Date.now() },
      saveSLA:      { tipoGestion: p.tipoGestion },
      getHistorialColaborador: {
        INASISTENCIAS: generateMockRecords('INASISTENCIAS', 2),
        INCAPACIDADES: generateMockRecords('INCAPACIDADES', 1),
        CONTRATACIONES: generateMockRecords('CONTRATACIONES', 1),
        DESVINCULACIONES: [], PROCESOS: [], OTROS_SI: [], DESCUENTOS: [],
      },
      checkSLAAlerts: [],
      getPreguntas: [],
      deleteRecord: { id: p.id },
    };
    return mock[p.action] !== undefined ? mock[p.action] : { ok: true };
  },
};

function generateMockRecords(mod, n) {
  const estados = ['Pendiente','En Proceso','Finalizado','Cancelado'];
  const names   = ['Juan García','María López','Carlos Ruiz','Ana Torres','Luis Martín','Sara Gómez'];
  const projs   = ['Proyecto Alpha','Proyecto Beta'];
  const coords  = ['Juan García','María López'];
  const records = [];
  for (let i = 0; i < n; i++) {
    const est = estados[i % 4];
    records.push({
      ID: mod.substring(0,3)+'_'+String(1000+i),
      Fecha: '2025-06-0'+(i+1),
      Hora: '08:30:00',
      Usuario: 'admin@sistema.com',
      Proyecto: projs[i % 2],
      Ciudad: 'Bogotá',
      Operacion: 'Customer Service',
      Coordinador: coords[i % 2],
      NombreColaborador: names[i % names.length],
      Documento: String(10000000 + i*1111),
      Subcategoria: 'Permiso remunerado',
      FechaInicio: '2025-06-0'+(i+1),
      FechaFin: '2025-06-0'+(i+2),
      Observaciones: 'Observación de prueba #'+(i+1),
      Estado: est,
      FechaCierre: est === 'Completado' ? '2025-06-05' : '',
      TiempoGestion: est === 'Completado' ? (24 + i) : '',
      horasTranscurridas: 10 + i * 3,
      vencido: i === 0,
      slaHoras: 24,
    });
  }
  return records;
}
function generateMockAuditoria(n) {
  const acciones = ['LOGIN','CREATE','UPDATE','DELETE','UPLOAD'];
  const modulos  = ['Usuarios','Inasistencias','Incapacidades','Proyectos'];
  const res = [];
  for (let i = 0; i < n; i++) {
    res.push({ id:'AUD_'+i, fecha:'2025-06-0'+((i%9)+1), hora:'10:'+String(i).padStart(2,'0')+':00',
      usuario:'admin@sistema.com', accion:acciones[i%5], modulo:modulos[i%4],
      registro:'ID_'+i, estAnt:'Pendiente', estNuevo:'En Proceso' });
  }
  return res;
}

// ============================================================
// ROUTER
// ============================================================
function navigate(view, params = {}) {
  App.currentView = view;
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  UI.setPageTitle(getPageTitle(view));
  renderView(view, params);
}

function getPageTitle(view) {
  const titles = {
    dashboard: 'Dashboard', historial: 'Historial Colaborador',
    auditoria: 'Auditoría del Sistema', usuarios: 'Gestión de Usuarios',
    configuracion: 'Configuración Administrativa', sla: 'Configuración SLA',
    proyectos_config: 'Gestión de Proyectos', listas_config: 'Listas Desplegables',
    preguntas_config: 'Preguntas Personalizadas',
  };
  return titles[view] || (MODULOS[view] ? MODULOS[view].label : view);
}

async function renderView(view, params) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="loading-spinner"></div></div>';

  try {
    if (view === 'dashboard')              await renderDashboard(content);
    else if (MODULOS[view])               await renderModulo(content, view, params);
    else if (view === 'panel_legalizador') await renderPanelLegalizador(content);
    else if (view === 'historial')         await renderHistorial(content);
    else if (view === 'auditoria')         await renderAuditoria(content);
    else if (view === 'usuarios')          await renderUsuarios(content);
    else if (view === 'configuracion')     renderConfiguracion(content);
    else if (view === 'proyectos_config')  await renderProyectosConfig(content);
    else if (view === 'listas_config')     await renderListasConfig(content);
    else if (view === 'preguntas_config')  await renderPreguntasConfig(content);
    else if (view === 'sla')               await renderSLA(content);
    else content.innerHTML = '<div class="empty-state"><div class="es-icon">🚧</div><h6>Vista en construcción</h6></div>';
  } catch(err) {
    content.innerHTML = `<div class="alert alert-danger"><b>Error:</b> ${err.message}</div>`;
  }
}

// ============================================================
// VISTA: DASHBOARD
// ============================================================
async function renderDashboard(el) {
  const data = await API.call({ action: 'getDashboardData' });
  const { stats, porModulo, porProyecto, porCoord, porCiudad, avgGestion, recientes } = data;

  el.innerHTML = `
  <div class="fade-in">
    <!-- Stats row -->
    <div class="row g-3 mb-4">
      ${statCard('Total Solicitudes', stats.total, 'bi-inbox-fill', 'blue', '')}
      ${statCard('Pendientes', stats.pendientes, 'bi-hourglass-split', 'orange', '')}
      ${statCard('En Proceso', stats.enProceso, 'bi-arrow-repeat', 'info', '')}
      ${statCard('Completadas', stats.completados, 'bi-check-circle-fill', 'green', '')}
      ${statCard('Rechazadas', stats.rechazados, 'bi-x-circle-fill', 'red', '')}
      ${statCard('Vencidas SLA', stats.vencidos, 'bi-alarm-fill', 'purple', '')}
    </div>

    <!-- Charts row -->
    <div class="row g-3 mb-4">
      <div class="col-lg-8">
        <div class="chart-card h-100">
          <h6><i class="bi bi-bar-chart-fill me-2 text-danger"></i>Solicitudes por Módulo</h6>
          <div class="chart-container"><canvas id="chartModulos"></canvas></div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="chart-card h-100">
          <h6><i class="bi bi-pie-chart-fill me-2 text-danger"></i>Por Estado</h6>
          <div class="chart-container"><canvas id="chartEstados"></canvas></div>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-6">
        <div class="chart-card h-100">
          <h6><i class="bi bi-geo-alt-fill me-2 text-danger"></i>Por Ciudad</h6>
          <div class="chart-container" style="height:180px"><canvas id="chartCiudad"></canvas></div>
        </div>
      </div>
      <div class="col-lg-6">
        <div class="chart-card h-100">
          <h6><i class="bi bi-trophy-fill me-2 text-warning"></i>Ranking Coordinadores</h6>
          <div id="rankingCoord"></div>
        </div>
      </div>
    </div>

    <!-- Indicador tiempo + Recientes -->
    <div class="row g-3">
      <div class="col-lg-3">
        <div class="card-panel h-100">
          <div class="card-panel-header">
            <i class="bi bi-clock-history text-danger"></i>
            <h6>Tiempo Promedio</h6>
          </div>
          <div class="card-panel-body text-center py-4">
            <div style="font-size:3rem;font-weight:900;color:var(--primary)">${avgGestion}</div>
            <div class="text-muted">horas de gestión</div>
            <div class="mt-3">
              <small class="text-muted">Solicitudes completadas</small><br>
              <strong>${stats.completados}</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="col-lg-9">
        <div class="card-panel">
          <div class="card-panel-header">
            <i class="bi bi-clock text-danger"></i>
            <h6>Solicitudes Recientes</h6>
          </div>
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead><tr>
                <th>ID</th><th>Módulo</th><th>Colaborador</th><th>Coordinador</th><th>Fecha</th><th>Estado</th>
              </tr></thead>
              <tbody>
              ${recientes.map(r => `<tr class="${r.vencido?'row-vencido':''}">
                <td><code>${r.ID||''}</code></td>
                <td><span class="badge bg-secondary">${r.modulo||''}</span></td>
                <td>${r.NombreColaborador||''}</td>
                <td>${r.Coordinador||''}</td>
                <td>${r.Fecha||''}</td>
                <td>${estadoBadge(r.Estado)}</td>
              </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  // Charts
  renderBarChart('chartModulos', Object.keys(porModulo), Object.values(porModulo));
  renderDonutChart('chartEstados',
    ['Pendiente','En Proceso','Completado','Rechazado'],
    [stats.pendientes, stats.enProceso, stats.completados, stats.rechazados]
  );
  renderHBarChart('chartCiudad', Object.keys(porCiudad), Object.values(porCiudad));

  // Ranking
  const sorted = Object.entries(porCoord).sort((a,b) => b[1]-a[1]);
  document.getElementById('rankingCoord').innerHTML = sorted.slice(0,6).map(([name,val],i) =>
    `<div class="ranking-item">
      <div class="ranking-pos ${i<3?'rank-'+(i+1):'rank-n'}">${i+1}</div>
      <div class="ranking-name">${name}</div>
      <div class="ranking-val">${val}</div>
    </div>`
  ).join('');
}

function statCard(label, val, icon, color, delta) {
  return `<div class="col-6 col-lg-2">
    <div class="stat-card">
      <div class="stat-icon ${color}"><i class="bi ${icon}"></i></div>
      <div class="stat-body">
        <div class="stat-value">${val}</div>
        <div class="stat-label">${label}</div>
      </div>
    </div>
  </div>`;
}

// ============================================================
// VISTA: MÓDULOS DE GESTIÓN
// ============================================================
async function renderModulo(el, modulo, params = {}) {
  const meta = MODULOS[modulo];
  el.innerHTML = `
  <div class="fade-in">
    <div class="table-wrapper">
      <div class="table-toolbar">
        <h6 class="mb-0"><i class="bi ${meta.icon} me-2 text-danger"></i>${meta.label}</h6>
        <div class="filter-group ms-auto">
          <input id="fBusq" type="text" placeholder="Buscar..." style="width:160px">
          <select id="fEstado"><option value="">Todos los estados</option>
            <option>Pendiente</option><option>En Proceso</option><option>Completado</option><option>Rechazado</option>
          </select>
          <select id="fProyecto"><option value="">Todos los proyectos</option>
            ${(App.cache.proyectos||[]).map(p=>`<option>${p.nombre}</option>`).join('')}
          </select>
          ${puedeCrear() ? `<button class="btn-primary-custom" onclick="openFormModal('${modulo}')">
            <i class="bi bi-plus-lg"></i> Nuevo
          </button>` : ''}
          <button class="btn-outline-custom" onclick="exportarTabla('${modulo}')">
            <i class="bi bi-download"></i>
          </button>
        </div>
      </div>
      <div id="vencidos-alert"></div>
      <div class="table-responsive">
        <table class="table table-hover mb-0" id="tblModulo">
          <thead id="tblHead"></thead>
          <tbody id="tblBody"></tbody>
        </table>
      </div>
      <div class="p-3 text-muted" style="font-size:.8rem" id="tblCount"></div>
    </div>
  </div>`;

  await loadModuloData(modulo);

  document.getElementById('fBusq').addEventListener('input', () => loadModuloData(modulo));
  document.getElementById('fEstado').addEventListener('change', () => loadModuloData(modulo));
  document.getElementById('fProyecto').addEventListener('change', () => loadModuloData(modulo));
}

async function loadModuloData(modulo) {
  const busq    = document.getElementById('fBusq')?.value || '';
  const estado  = document.getElementById('fEstado')?.value || '';
  const proyecto= document.getElementById('fProyecto')?.value || '';

  showLoading();
  try {
    const records = await API.call({
      action: 'getRecords', modulo,
      usuario: App.user.email, rol: App.user.rol,
      filtros: { busqueda: busq, estado, proyecto },
    });
    App.cache.records[modulo] = records;
    renderTablaModulo(modulo, records);
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

function renderTablaModulo(modulo, records) {
  const headEl = document.getElementById('tblHead');
  const bodyEl = document.getElementById('tblBody');
  const cntEl  = document.getElementById('tblCount');
  const alertEl= document.getElementById('vencidos-alert');
  if (!headEl) return;

  const vencidos = records.filter(r => r.vencido).length;
  alertEl.innerHTML = vencidos ? `
    <div class="sla-alert-bar">
      <i class="bi bi-alarm-fill"></i>
      <span class="alert-count">${vencidos}</span>
      ${vencidos === 1 ? 'solicitud ha' : 'solicitudes han'} superado el SLA
    </div>` : '';

  const cols = getColumnasPorModulo(modulo);
  // Columna ID Servicio solo visible para Legalizador y Admin
  const colsVisible = puedeVerTodos()
    ? [...cols, { key:'ID_Servicio', label:'ID Servicio' }]
    : cols;
  headEl.innerHTML = `<tr>${colsVisible.map(c=>`<th>${c.label}</th>`).join('')}<th>Acciones</th></tr>`;

  if (!records.length) {
    bodyEl.innerHTML = `<tr><td colspan="${cols.length+1}">
      <div class="empty-state"><div class="es-icon">📭</div><h6>Sin registros</h6><p>No hay datos con los filtros actuales</p></div>
    </td></tr>`;
    cntEl.textContent = '';
    return;
  }

  bodyEl.innerHTML = records.map(r => `
    <tr class="${r.vencido ? 'row-vencido' : ''}">
      ${colsVisible.map(c => `<td>${formatCellValue(c, r)}</td>`).join('')}
      <td>
        <div class="action-btns">
          <button class="btn-action view" onclick="verDetalle('${modulo}','${r.ID}')" title="Ver detalle"><i class="bi bi-eye"></i></button>
          ${puedeActualizarGestion(r) ? `<button class="btn-action edit" style="background:rgba(32,201,151,.15);color:#20c997" onclick="openGestionModal('${modulo}','${r.ID}')" title="Actualizar gestión"><i class="bi bi-pencil-square"></i></button>` : ''}
          ${puedeEliminar() ? `<button class="btn-action del" onclick="eliminarRegistro('${modulo}','${r.ID}')" title="Eliminar"><i class="bi bi-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`).join('');

  cntEl.textContent = `Mostrando ${records.length} registros`;
}

function getColumnasPorModulo(mod) {
  const base = [
    { key:'ID', label:'ID' },
    { key:'Fecha', label:'Fecha' },
    { key:'Proyecto', label:'Proyecto' },
    { key:'NombreColaborador', label:'Colaborador' },
    { key:'Documento', label:'Documento' },
    { key:'Estado', label:'Estado', type:'estado' },
    { key:'sla', label:'SLA', type:'sla' },
  ];
  const extras = {
    INASISTENCIAS:    [{ key:'Subcategoria', label:'Tipo' }],
    INCAPACIDADES:    [{ key:'TipoIncapacidad', label:'Tipo' },{ key:'DiasIncapacidad', label:'Días' }],
    CONTRATACIONES:   [{ key:'Subcategoria', label:'Tipo' },{ key:'Cargo', label:'Cargo' }],
    DESVINCULACIONES: [{ key:'Subcategoria', label:'Motivo' },{ key:'FechaRetiro', label:'Fecha Retiro' }],
    PROCESOS:         [{ key:'Subcategoria', label:'Tipo' }],
    OTROS_SI:         [{ key:'Subcategoria', label:'Tipo' },{ key:'Cargo', label:'Cargo' }],
    DESCUENTOS:       [{ key:'TipoDescuento', label:'Tipo' },{ key:'Valor', label:'Valor' }],
    NOVEDADES_MASIVAS:[{ key:'TipoNovedad', label:'Tipo' },{ key:'CantidadColaboradores', label:'N° Colab.' }],
  };
  return [...base.slice(0,5), ...(extras[mod]||[]), ...base.slice(5)];
}

function formatCellValue(col, row) {
  const val = row[col.key];
  if (col.type === 'estado') return estadoBadge(val);
  if (col.type === 'sla') {
    const pct = Math.min((row.horasTranscurridas / row.slaHoras) * 100, 100);
    const cls = pct >= 100 ? 'sla-over' : pct >= 75 ? 'sla-warn' : 'sla-ok';
    if (row.Estado === 'Completado' || row.Estado === 'Rechazado') return '<span class="text-muted">—</span>';
    return `<div class="${cls} sla-bar" title="${row.horasTranscurridas}h / ${row.slaHoras}h">
      <div class="sla-fill" style="width:${pct}%"></div></div>
      <small>${Math.round(row.horasTranscurridas)}h</small>`;
  }
  if (col.key === 'ID') return `<code style="font-size:.75rem">${val||''}</code>`;
  return val || '—';
}

function estadoBadge(estado) {
  const cls = ESTADOS_COLORS[estado] || '';
  const dots = { 'Pendiente':'🟡','En Proceso':'🔵','Completado':'🟢','Rechazado':'🔴' };
  return `<span class="badge-estado ${cls}">${dots[estado]||''} ${estado||'—'}</span>`;
}

// ============================================================
// MODAL FORMULARIO — NUEVO / EDITAR
// ============================================================
async function openFormModal(modulo, recordId = null) {
  const meta     = MODULOS[modulo];
  const isEdit   = !!recordId;
  const existing = isEdit ? (App.cache.records[modulo]||[]).find(r => r.ID === recordId) : null;

  // Ensure proyectos cargados
  if (!App.cache.proyectos.length) {
    App.cache.proyectos = await API.call({ action: 'getProyectos', soloActivos: true });
  }

  const modalEl = document.getElementById('formModal');
  document.getElementById('formModalTitle').textContent = (isEdit ? 'Editar' : 'Nueva') + ' — ' + meta.label;

  // Cargar preguntas personalizadas para este módulo
  try {
    App.cache.preguntas = App.cache.preguntas || {};
    if (!App.cache.preguntas[modulo]) {
      App.cache.preguntas[modulo] = await API.call({ action: 'getPreguntas', modulo });
    }
  } catch(e) {
    App.cache.preguntas = App.cache.preguntas || {};
    App.cache.preguntas[modulo] = [];
  }

  const body = document.getElementById('formModalBody');
  // IMPORTANTE: pasar {} en lugar de null para que los defaults del formulario funcionen
  body.innerHTML = renderFormulario(modulo, existing || {});

  // Si edición, deshabilitar campos base y mostrar campos de cierre
  if (isEdit) setupFormEdit(existing);

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  document.getElementById('btnGuardarForm').onclick = () => guardarForm(modulo, recordId);
}

function renderFormulario(modulo, data = {}) {
  const proyOpts = App.cache.proyectos.map(p => `<option ${data.Proyecto===p.nombre?'selected':''}>${p.nombre}</option>`).join('');
  const ciudades = (App.cache.listas['Ciudad']||[]).map(l => `<option ${data.Ciudad===l.valor?'selected':''}>${l.valor}</option>`).join('');
  const operaciones = (App.cache.listas['Operacion']||[]).map(l => `<option ${data.Operacion===l.valor?'selected':''}>${l.valor}</option>`).join('');
  const subcats  = (SUBCATEGORIAS[modulo]||[]).map(s => `<option ${data.Subcategoria===s?'selected':''}>${s}</option>`).join('');
  const cargos   = (App.cache.listas['Cargo']||[]).map(l => `<option ${data.Cargo===l.valor?'selected':''}>${l.valor}</option>`).join('');

  const v = (f) => data[f] || '';

  let specificFields = '';
  switch(modulo) {
    case 'INASISTENCIAS':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo <span class="required">*</span></label>
          <select class="form-select" name="Subcategoria" required><option value="">Seleccione...</option>${subcats}</select></div>
        <div class="col-md-3"><label class="form-label">Fecha Inicio <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaInicio" value="${v('FechaInicio')}" required></div>
        <div class="col-md-3"><label class="form-label">Fecha Fin <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaFin" value="${v('FechaFin')}" required></div>`;
      break;
    case 'INCAPACIDADES':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo Incapacidad <span class="required">*</span></label>
          <select class="form-select" name="TipoIncapacidad" required><option value="">Seleccione...</option>
            ${(App.cache.listas['TipoIncapacidad']||[]).map(l=>`<option ${v('TipoIncapacidad')===l.valor?'selected':''}>${l.valor}</option>`).join('')}
          </select></div>
        <div class="col-md-6"><label class="form-label">Diagnóstico CIE</label>
          <input type="text" class="form-control" name="DiagnosticoCIE" value="${v('DiagnosticoCIE')}" placeholder="Ej: J06.9"></div>
        <div class="col-md-3"><label class="form-label">Fecha Inicio <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaInicio" value="${v('FechaInicio')}" required></div>
        <div class="col-md-3"><label class="form-label">Fecha Fin <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaFin" value="${v('FechaFin')}" required></div>
        <div class="col-md-3"><label class="form-label">Días Incapacidad</label>
          <input type="number" class="form-control" name="DiasIncapacidad" value="${v('DiasIncapacidad')}"></div>`;
      break;
    case 'CONTRATACIONES':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo <span class="required">*</span></label>
          <select class="form-select" name="Subcategoria" required><option value="">Seleccione...</option>${subcats}</select></div>
        <div class="col-md-6"><label class="form-label">Cargo <span class="required">*</span></label>
          <select class="form-select" name="Cargo" required><option value="">Seleccione...</option>${cargos}</select></div>
        <div class="col-md-4"><label class="form-label">Fecha Ingreso <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaIngreso" value="${v('FechaIngreso')}" required></div>
        <div class="col-md-4"><label class="form-label">Salario</label>
          <input type="number" class="form-control" name="Salario" value="${v('Salario')}"></div>
        <div class="col-md-4"><label class="form-label">Tipo Contrato</label>
          <select class="form-select" name="TipoContrato">
            <option value="">Seleccione...</option>
            ${(App.cache.listas['TipoContrato']||[]).map(l=>`<option ${v('TipoContrato')===l.valor?'selected':''}>${l.valor}</option>`).join('')}
          </select></div>`;
      break;
    case 'DESVINCULACIONES':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Motivo <span class="required">*</span></label>
          <select class="form-select" name="Subcategoria" required><option value="">Seleccione...</option>${subcats}</select></div>
        <div class="col-md-6"><label class="form-label">Cargo</label>
          <select class="form-select" name="Cargo"><option value="">Seleccione...</option>${cargos}</select></div>
        <div class="col-md-4"><label class="form-label">Fecha Retiro <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaRetiro" value="${v('FechaRetiro')}" required></div>
        <div class="col-12"><label class="form-label">Motivo Detallado</label>
          <textarea class="form-control" name="MotivoDetallado" rows="2">${v('MotivoDetallado')}</textarea></div>`;
      break;
    case 'PROCESOS':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo <span class="required">*</span></label>
          <select class="form-select" name="Subcategoria" required><option value="">Seleccione...</option>${subcats}</select></div>
        <div class="col-md-3"><label class="form-label">Fecha Inicio Proceso <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaInicio" value="${v('FechaInicio')}" required></div>
        <div class="col-md-3"><label class="form-label">Fecha del Hecho</label>
          <input type="date" class="form-control" name="FechaHecho" value="${v('FechaHecho')}"></div>
        <div class="col-12"><label class="form-label">Descripción del Hecho <span class="required">*</span></label>
          <textarea class="form-control" name="DescripcionHecho" rows="3" required>${v('DescripcionHecho')}</textarea></div>`;
      break;
    case 'OTROS_SI':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo Otrosí <span class="required">*</span></label>
          <select class="form-select" name="Subcategoria" required><option value="">Seleccione...</option>${subcats}</select></div>
        <div class="col-md-6"><label class="form-label">Cargo</label>
          <select class="form-select" name="Cargo"><option value="">Seleccione...</option>${cargos}</select></div>
        <div class="col-md-4"><label class="form-label">Fecha Efectiva <span class="required">*</span></label>
          <input type="date" class="form-control" name="FechaEfectiva" value="${v('FechaEfectiva')}" required></div>
        <div class="col-12"><label class="form-label">Detalle de la Novedad <span class="required">*</span></label>
          <textarea class="form-control" name="DetalleNovedad" rows="3" required>${v('DetalleNovedad')}</textarea></div>`;
      break;
    case 'DESCUENTOS':
      specificFields = `
        <div class="col-md-6"><label class="form-label">Tipo Descuento <span class="required">*</span></label>
          <select class="form-select" name="TipoDescuento" required><option value="">Seleccione...</option>
            ${(App.cache.listas['TipoDescuento']||[]).map(l=>`<option ${v('TipoDescuento')===l.valor?'selected':''}>${l.valor}</option>`).join('')}
          </select></div>
        <div class="col-md-3"><label class="form-label">Valor <span class="required">*</span></label>
          <input type="number" class="form-control" name="Valor" value="${v('Valor')}" required></div>
        <div class="col-md-3"><label class="form-label">Período</label>
          <input type="month" class="form-control" name="PeriodoDescuento" value="${v('PeriodoDescuento')}"></div>
        <div class="col-12"><label class="form-label">Justificación <span class="required">*</span></label>
          <textarea class="form-control" name="Justificacion" rows="2" required>${v('Justificacion')}</textarea></div>`;
      break;
    case 'NOVEDADES_MASIVAS':
      return renderFormularioMasivo(data);
  }

  return `
  <form id="mainForm">
    <div class="form-section">
      <div class="form-section-title">Información General</div>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">Proyecto <span class="required">*</span></label>
          <select class="form-select" name="Proyecto" required><option value="">Seleccione...</option>${proyOpts}</select></div>
        <div class="col-md-4"><label class="form-label">Ciudad <span class="required">*</span></label>
          <select class="form-select" name="Ciudad" required><option value="">Seleccione...</option>${ciudades}</select></div>
        <div class="col-md-4"><label class="form-label">Operación</label>
          <select class="form-select" name="Operacion"><option value="">Seleccione...</option>${operaciones}</select></div>
        <div class="col-md-6"><label class="form-label">Coordinador <span class="required">*</span></label>
          <input type="text" class="form-control" name="Coordinador" value="${v('Coordinador')}" required></div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title">Datos del Colaborador</div>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">Nombre Completo <span class="required">*</span></label>
          <input type="text" class="form-control" name="NombreColaborador" value="${v('NombreColaborador')}" required></div>
        <div class="col-md-6"><label class="form-label">Número de Documento <span class="required">*</span></label>
          <input type="text" class="form-control" name="Documento" value="${v('Documento')}" required>
          <div class="form-text">
            <a href="#" onclick="buscarHistorial(this)" class="text-danger">Ver historial del colaborador</a>
          </div>
        </div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title">Detalles de la Novedad</div>
      <div class="row g-3">
        ${specificFields}
        <div class="col-12"><label class="form-label">Observaciones</label>
          <textarea class="form-control" name="Observaciones" rows="3">${v('Observaciones')}</textarea></div>
      </div>
    </div>
    <div class="form-section" id="seccionCierre" style="display:none">
      <div class="form-section-title">Cierre de Solicitud</div>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">Estado</label>
          <select class="form-select" name="Estado">
            <option>Pendiente</option><option>En Proceso</option><option>Completado</option><option>Rechazado</option>
          </select></div>
        <div class="col-12"><label class="form-label">Observación de Cierre</label>
          <textarea class="form-control" name="ObservacionCierre" rows="2">${v('ObservacionCierre')}</textarea></div>
      </div>
    </div>
    ${renderCamposPersonalizados(modulo, data)}
    <div class="form-section">
      <div class="form-section-title">Adjuntar Documentos</div>
      <div class="upload-zone" id="uploadZone" onclick="document.getElementById('fileInput').click()">
        <input type="file" id="fileInput" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" style="display:none" onchange="handleFileSelect(event)">
        <div class="upload-icon"><i class="bi bi-cloud-upload"></i></div>
        <p>Haga clic o arrastre archivos aquí</p>
        <p><strong>PDF, JPG, PNG, Excel</strong> — máx. 10 MB c/u</p>
      </div>
      <div class="file-list" id="fileList"></div>
    </div>
  </form>`;
}

function renderFormularioMasivo(data = {}) {
  const v = (f) => data[f] || '';
  const proyOpts = App.cache.proyectos.map(p => `<option>${p.nombre}</option>`).join('');
  const ciudades = (App.cache.listas['Ciudad']||[]).map(l => `<option>${l.valor}</option>`).join('');
  const operaciones = (App.cache.listas['Operacion']||[]).map(l => `<option>${l.valor}</option>`).join('');

  return `
  <form id="mainForm">
    <div class="form-section">
      <div class="form-section-title">Información General</div>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">Proyecto <span class="required">*</span></label>
          <select class="form-select" name="Proyecto" required><option value="">Seleccione...</option>${proyOpts}</select></div>
        <div class="col-md-4"><label class="form-label">Ciudad <span class="required">*</span></label>
          <select class="form-select" name="Ciudad" required><option value="">Seleccione...</option>${ciudades}</select></div>
        <div class="col-md-4"><label class="form-label">Operación</label>
          <select class="form-select" name="Operacion"><option value="">Seleccione...</option>${operaciones}</select></div>
        <div class="col-md-6"><label class="form-label">Coordinador <span class="required">*</span></label>
          <input type="text" class="form-control" name="Coordinador" required></div>
        <div class="col-md-6"><label class="form-label">Tipo de Novedad <span class="required">*</span></label>
          <select class="form-select" name="TipoNovedad" required><option value="">Seleccione...</option>
            ${Object.values(MODULOS).map(m=>`<option>${m.label}</option>`).join('')}
          </select></div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title d-flex justify-content-between align-items-center">
        <span>Colaboradores</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="addColaboradorRow()">
          <i class="bi bi-plus"></i> Agregar
        </button>
      </div>
      <div id="colaboradoresContainer">
        ${colaboradorRowHTML(1)}
      </div>
    </div>
    <div class="col-12"><label class="form-label">Observaciones Generales</label>
      <textarea class="form-control" name="Observaciones" rows="3"></textarea></div>
  </form>`;
}

function colaboradorRowHTML(n) {
  return `<div class="colaborador-row" id="colRow${n}">
    <button type="button" class="remove-row" onclick="removeColRow(${n})"><i class="bi bi-x"></i></button>
    <div class="row g-2">
      <div class="col-md-6"><input type="text" class="form-control" placeholder="Nombre Completo" name="col_nombre_${n}"></div>
      <div class="col-md-3"><input type="text" class="form-control" placeholder="Documento" name="col_doc_${n}"></div>
      <div class="col-md-3"><input type="text" class="form-control" placeholder="Novedad específica" name="col_novedad_${n}"></div>
    </div>
  </div>`;
}

// ============================================================
// CAMPOS PERSONALIZADOS (Preguntas configurables por módulo)
// ============================================================
function renderCamposPersonalizados(modulo, data = {}) {
  const preguntas = (App.cache.preguntas && App.cache.preguntas[modulo]) || [];
  if (!preguntas.length) return '';

  const campos = preguntas.map(q => {
    const nombre = q.name || ('custom_' + q.id);
    const valor  = data[nombre] || '';
    const req    = (q.requerido === true || q.requerido === 'true') ? 'required' : '';
    const reqMark= req ? '<span class="text-danger">*</span>' : '';

    let input = '';
    switch (q.tipo) {
      case 'Texto largo':
        input = `<textarea class="form-control" name="${nombre}" rows="3" ${req}>${valor}</textarea>`; break;
      case 'Número':
        input = `<input type="number" class="form-control" name="${nombre}" value="${valor}" ${req}>`; break;
      case 'Fecha':
        input = `<input type="date" class="form-control" name="${nombre}" value="${valor}" ${req}>`; break;
      case 'Hora':
        input = `<input type="time" class="form-control" name="${nombre}" value="${valor}" ${req}>`; break;
      case 'Sí/No':
        input = `<select class="form-select" name="${nombre}" ${req}>
          <option value="">Seleccione...</option>
          <option value="Sí" ${valor==='Sí'?'selected':''}>Sí</option>
          <option value="No" ${valor==='No'?'selected':''}>No</option>
        </select>`; break;
      case 'Lista desplegable':
      case 'Selección múltiple': {
        const opts = (q.opciones || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<select class="form-select" name="${nombre}" ${req}>
          <option value="">Seleccione...</option>
          ${opts.map(o => `<option value="${o}" ${valor===o?'selected':''}>${o}</option>`).join('')}
        </select>`; break;
      }
      default: // Texto
        input = `<input type="text" class="form-control" name="${nombre}" value="${valor}" ${req}>`;
    }
    return `<div class="col-md-6">
      <label class="form-label">${q.label} ${reqMark}</label>
      ${input}
    </div>`;
  }).join('');

  return `
  <div class="form-section">
    <div class="form-section-title" style="color:#6f42c1">
      <i class="bi bi-stars me-1"></i>Campos Adicionales
    </div>
    <div class="row g-3">${campos}</div>
  </div>`;
}

let colRowCount = 1;
function addColaboradorRow() {
  colRowCount++;
  const container = document.getElementById('colaboradoresContainer');
  container.insertAdjacentHTML('beforeend', colaboradorRowHTML(colRowCount));
}
function removeColRow(n) {
  const el = document.getElementById('colRow'+n);
  if (el) el.remove();
}

function setupFormEdit(record) {
  const secCierre = document.getElementById('seccionCierre');
  if (secCierre) secCierre.style.display = '';
  const form = document.getElementById('mainForm');
  if (!form || !record) return;
  // Fill form values
  Object.keys(record).forEach(k => {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el) return;
    if (el.tagName === 'SELECT') el.value = record[k] || '';
    else if (el.tagName === 'TEXTAREA') el.value = record[k] || '';
    else el.value = record[k] || '';
  });
}

async function guardarForm(modulo, recordId) {
  const form = document.getElementById('mainForm');
  if (!form) return;
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const formData = {};
  new FormData(form).forEach((val, key) => { formData[key] = val; });

  // Masivas: recoger colaboradores
  if (modulo === 'NOVEDADES_MASIVAS') {
    const colaboradores = [];
    let c = 1;
    while (document.getElementById('colRow'+c)) {
      const nombre  = form.querySelector(`[name="col_nombre_${c}"]`)?.value;
      const doc     = form.querySelector(`[name="col_doc_${c}"]`)?.value;
      const novedad = form.querySelector(`[name="col_novedad_${c}"]`)?.value;
      if (nombre) colaboradores.push({ nombre, doc, novedad });
      c++;
    }
    formData.Colaboradores  = JSON.stringify(colaboradores);
    formData.CantidadColaboradores = colaboradores.length;
  }

  showLoading();
  try {
    const pendingFiles = App._pendingFiles || [];
    if (recordId) {
      await API.call({ action: 'updateRecord', modulo, id: recordId, data: formData, usuario: App.user.email });
      toast('success', 'Registro actualizado');
    } else {
      const res = await API.call({ action: 'saveRecord', modulo, data: formData, usuario: App.user.email });
      // Upload files
      for (const f of pendingFiles) {
        await uploadFile(f, modulo, res.id);
      }
      toast('success', 'Registro guardado — ID: ' + res.id);
    }
    App._pendingFiles = [];
    bootstrap.Modal.getInstance(document.getElementById('formModal')).hide();
    await loadModuloData(modulo);
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

// ============================================================
// DETALLE / VER REGISTRO
// ============================================================
function verDetalle(modulo, id) {
  const record = (App.cache.records[modulo]||[]).find(r => r.ID === id);
  if (!record) return;

  const ignoreKeys = ['horasTranscurridas','vencido','slaHoras','modulo'];
  const rows = Object.entries(record)
    .filter(([k]) => !ignoreKeys.includes(k))
    .map(([k,v]) => {
      const val = k === 'Estado' ? estadoBadge(v) : (String(v||'—'));
      return `<div class="detail-row"><div class="detail-label">${k}</div><div class="detail-value">${val}</div></div>`;
    }).join('');

  const modal = document.getElementById('detailModal');
  document.getElementById('detailModalTitle').textContent = MODULOS[modulo]?.label + ' — ' + id;
  document.getElementById('detailModalBody').innerHTML = rows;

  // Botones de acción
  const footer = document.getElementById('detailModalFooter');
  if (puedeEditar(record)) {
    footer.innerHTML = `
      <button class="btn-primary-custom" onclick="editarRegistro('${modulo}','${id}');bootstrap.Modal.getInstance(document.getElementById('detailModal')).hide()">
        <i class="bi bi-pencil"></i> Editar
      </button>
      <button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>`;
  } else {
    footer.innerHTML = `<button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>`;
  }

  bootstrap.Modal.getOrCreateInstance(modal).show();
}

function editarRegistro(modulo, id) { openFormModal(modulo, id); }

async function eliminarRegistro(modulo, id) {
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  showLoading();
  try {
    await API.call({ action: 'deleteRecord', modulo, id, usuario: App.user.email });
    toast('success', 'Registro eliminado');
    await loadModuloData(modulo);
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

// ============================================================
// HISTORIAL COLABORADOR
// ============================================================
async function renderHistorial(el) {
  el.innerHTML = `
  <div class="fade-in">
    <div class="card-panel mb-3">
      <div class="card-panel-header"><i class="bi bi-person-lines-fill text-danger me-2"></i><h6>Buscar Colaborador</h6></div>
      <div class="card-panel-body">
        <div class="input-group" style="max-width:400px">
          <input type="text" class="form-control" id="inputDocumento" placeholder="Número de documento...">
          <button class="btn btn-danger" onclick="cargarHistorial()"><i class="bi bi-search me-1"></i>Buscar</button>
        </div>
      </div>
    </div>
    <div id="historialResultado"></div>
  </div>`;
}

async function cargarHistorial() {
  const doc = document.getElementById('inputDocumento')?.value?.trim();
  if (!doc) { toast('warning', 'Ingrese un número de documento'); return; }
  showLoading();
  try {
    const hist = await API.call({ action: 'getHistorialColaborador', documento: doc });
    renderHistorialView(hist, doc);
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

function renderHistorialView(hist, doc) {
  const el = document.getElementById('historialResultado');
  const allItems = [];
  Object.entries(hist).forEach(([mod, records]) => {
    records.forEach(r => allItems.push({ ...r, modulo: mod }));
  });
  allItems.sort((a,b) => new Date(b.Fecha) - new Date(a.Fecha));

  if (!allItems.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">🔍</div><h6>Sin historial</h6><p>No se encontraron registros para el documento <strong>${doc}</strong></p></div>`;
    return;
  }

  const nombre = allItems[0].NombreColaborador || 'Colaborador';
  el.innerHTML = `
  <div class="card-panel mb-3">
    <div class="card-panel-body d-flex align-items-center gap-3">
      <div class="user-avatar" style="width:52px;height:52px;font-size:1.4rem">${nombre.charAt(0)}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:700">${nombre}</div>
        <div class="text-muted">Documento: ${doc}</div>
        <div class="text-muted">${allItems.length} novedad(es) registrada(s)</div>
      </div>
    </div>
  </div>
  <div class="historial-timeline mt-3">
    ${allItems.map(r => `
    <div class="timeline-item">
      <div class="timeline-dot ${(r.Estado||'').toLowerCase().replace(' ','-')}"></div>
      <div class="timeline-content">
        <div class="tc-header">
          <span class="tc-module">${r.modulo}</span>
          ${estadoBadge(r.Estado)}
          <span class="tc-date">${r.Fecha||''}</span>
        </div>
        <div>${r.Subcategoria||r.TipoIncapacidad||r.TipoDescuento||r.Subcategoria||r.TipoNovedad||'—'}</div>
        ${r.Observaciones ? `<div class="text-muted mt-1" style="font-size:.82rem">${r.Observaciones}</div>` : ''}
      </div>
    </div>`).join('')}
  </div>`;
}

function buscarHistorial(linkEl) {
  const form = linkEl.closest('form') || document.getElementById('mainForm');
  const doc  = form?.querySelector('[name="Documento"]')?.value;
  if (!doc) { toast('warning', 'Ingrese el documento primero'); return; }
  bootstrap.Modal.getInstance(document.getElementById('formModal'))?.hide();
  navigate('historial');
  setTimeout(() => {
    const inp = document.getElementById('inputDocumento');
    if (inp) { inp.value = doc; cargarHistorial(); }
  }, 400);
}

// ============================================================
// AUDITORÍA
// ============================================================
async function renderAuditoria(el) {
  showLoading();
  const logs = await API.call({ action: 'getAuditoria' }).finally(hideLoading);
  el.innerHTML = `
  <div class="fade-in table-wrapper">
    <div class="table-toolbar">
      <h6 class="mb-0"><i class="bi bi-journal-text me-2 text-danger"></i>Log de Auditoría</h6>
      <div class="filter-group ms-auto">
        <input id="audBusq" type="text" placeholder="Buscar..." oninput="filtrarAuditoria()" style="width:180px">
        <button class="btn-outline-custom" onclick="exportarAuditoria()"><i class="bi bi-download"></i></button>
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-hover mb-0" id="tblAud">
        <thead><tr>
          <th>Fecha</th><th>Hora</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Registro</th><th>Estado Ant.</th><th>Estado Nuevo</th>
        </tr></thead>
        <tbody id="tblAudBody">
          ${[...logs].reverse().map(l => `<tr>
            <td>${l.fecha}</td><td>${l.hora}</td>
            <td><small>${l.usuario}</small></td>
            <td><span class="badge ${accionBadge(l.accion)}">${l.accion}</span></td>
            <td>${l.modulo}</td><td><code style="font-size:.72rem">${l.registro}</code></td>
            <td>${l.estAnt||'—'}</td><td>${l.estNuevo||'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
  App._auditoriaData = logs;
}

function accionBadge(accion) {
  const map = { LOGIN:'bg-info', CREATE:'bg-success', UPDATE:'bg-warning text-dark', DELETE:'bg-danger', UPLOAD:'bg-secondary' };
  return map[accion] || 'bg-secondary';
}
function filtrarAuditoria() {
  const q = document.getElementById('audBusq').value.toLowerCase();
  document.querySelectorAll('#tblAudBody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function exportarAuditoria() { exportCSV(App._auditoriaData||[], 'auditoria'); }

// ============================================================
// USUARIOS
// ============================================================
async function renderUsuarios(el) {
  if (App.user.rol !== 'Administrador') {
    el.innerHTML = '<div class="alert alert-warning">Acceso restringido.</div>'; return;
  }
  showLoading();
  const users = await API.call({ action: 'getUsers' }).finally(hideLoading);
  App.cache.usuarios = users;

  el.innerHTML = `
  <div class="fade-in table-wrapper">
    <div class="table-toolbar">
      <h6 class="mb-0"><i class="bi bi-people-fill me-2 text-danger"></i>Usuarios del Sistema</h6>
      <div class="filter-group ms-auto">
        <button class="btn-primary-custom" onclick="openUserModal()"><i class="bi bi-plus-lg"></i> Nuevo Usuario</button>
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-hover mb-0">
        <thead><tr><th>ID</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Proyecto</th><th>Estado</th><th>Último Acceso</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.map(u => `<tr>
            <td><code style="font-size:.75rem">${u.id}</code></td>
            <td><strong>${u.nombre}</strong></td>
            <td>${u.email}</td>
            <td><span class="badge bg-primary">${u.rol}</span></td>
            <td>${u.proyecto||'—'}</td>
            <td><span class="badge ${u.estado==='Activo'?'bg-success':'bg-secondary'}">${u.estado}</span></td>
            <td>${u.ultimoAcceso||'—'}</td>
            <td>
              <div class="action-btns">
                <button class="btn-action edit" onclick="openUserModal('${u.id}')"><i class="bi bi-pencil"></i></button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function openUserModal(userId = null) {
  const user  = userId ? App.cache.usuarios.find(u => u.id === userId) : null;
  const isEdit= !!user;
  const proyOpts = (App.cache.proyectos||[]).map(p => `<option ${user?.proyecto===p.nombre?'selected':''}>${p.nombre}</option>`).join('');

  document.getElementById('userModalTitle').textContent = isEdit ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('userModalBody').innerHTML = `
  <form id="userForm">
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label">Nombre Completo <span class="required">*</span></label>
        <input class="form-control" name="nombre" value="${user?.nombre||''}" required></div>
      <div class="col-md-6"><label class="form-label">Email <span class="required">*</span></label>
        <input type="email" class="form-control" name="email" value="${user?.email||''}" required ${isEdit?'readonly':''}></div>
      <div class="col-md-6"><label class="form-label">Rol <span class="required">*</span></label>
        <select class="form-select" name="rol" required>
          <option value="">Seleccione...</option>
          ${['Administrador','Legalizador','Coordinador'].map(r=>`<option ${user?.rol===r?'selected':''}>${r}</option>`).join('')}
        </select></div>
      <div class="col-md-6"><label class="form-label">Proyecto Asignado</label>
        <select class="form-select" name="proyecto">
          <option value="Todos">Todos los proyectos</option>${proyOpts}
        </select></div>
      ${isEdit ? `
      <div class="col-md-6"><label class="form-label">Estado</label>
        <select class="form-select" name="estado">
          <option ${user?.estado==='Activo'?'selected':''}>Activo</option>
          <option ${user?.estado==='Inactivo'?'selected':''}>Inactivo</option>
        </select></div>
      <div class="col-12">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="chkResetPwd" onchange="document.getElementById('newPwdField').style.display=this.checked?'':'none'">
          <label class="form-check-label" for="chkResetPwd">Restablecer contraseña</label>
        </div>
        <div id="newPwdField" style="display:none;margin-top:8px">
          <input type="password" class="form-control" name="newPassword" placeholder="Nueva contraseña">
        </div>
      </div>` :
      `<div class="col-md-6"><label class="form-label">Contraseña inicial <span class="required">*</span></label>
        <input type="password" class="form-control" name="password" required placeholder="Mín. 8 caracteres"></div>`}
    </div>
  </form>`;

  document.getElementById('btnGuardarUser').onclick = () => guardarUser(userId);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal')).show();
}

async function guardarUser(userId) {
  const form = document.getElementById('userForm');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const fd = {};
  new FormData(form).forEach((v,k) => { fd[k] = v; });
  fd.usuarioAdmin = App.user.email;

  showLoading();
  try {
    const resetPwd = document.getElementById('chkResetPwd')?.checked;
    if (userId) {
      await API.call({ action: 'updateUser', id: userId, resetPassword: resetPwd, ...fd });
      toast('success', 'Usuario actualizado');
    } else {
      await API.call({ action: 'saveUser', ...fd });
      toast('success', 'Usuario creado');
    }
    bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
    await renderUsuarios(document.getElementById('content'));
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

// ============================================================
// CONFIGURACIÓN ADMINISTRATIVA
// ============================================================
function renderConfiguracion(el) {
  if (!tieneAccesoConfig()) {
    el.innerHTML = `<div class="alert alert-warning mt-2">
      <i class="bi bi-shield-exclamation me-2"></i>
      <strong>Acceso restringido.</strong> Solo el Administrador puede acceder a la configuración.
    </div>`;
    return;
  }
  el.innerHTML = `
  <div class="fade-in">
    <div class="config-grid">
      ${cfgCard('🏗️','Proyectos','Administrar proyectos activos e inactivos','proyectos_config')}
      ${cfgCard('📋','Listas Desplegables','Ciudades, cargos, tipos y más opciones','listas_config')}
      ${cfgCard('❓','Preguntas por Formulario','Añadir campos personalizados a cada módulo','preguntas_config')}
      ${cfgCard('⏱️','SLA y Alertas','Tiempos máximos por tipo de gestión','sla')}
      ${cfgCard('👥','Usuarios','Crear y administrar cuentas de usuario','usuarios')}
      ${cfgCard('📊','Auditoría','Log completo de cambios del sistema','auditoria')}
    </div>
  </div>`;
}

function cfgCard(icon, title, desc, view) {
  return `<div class="config-card" onclick="navigate('${view}')">
    <div class="cc-icon">${icon}</div>
    <h6>${title}</h6>
    <p>${desc}</p>
    <small class="text-danger fw-bold">Configurar →</small>
  </div>`;
}

// ============================================================
// PROYECTOS CONFIG
// ============================================================
async function renderProyectosConfig(el) {
  showLoading();
  const proyectos = await API.call({ action: 'getProyectos' }).finally(hideLoading);
  App.cache.proyectos = proyectos.filter(p => p.estado === 'Activo');

  el.innerHTML = `
  <div class="fade-in table-wrapper">
    <div class="table-toolbar">
      <h6 class="mb-0"><i class="bi bi-building me-2 text-danger"></i>Proyectos</h6>
      <div class="ms-auto"><button class="btn-primary-custom" onclick="openProyectoModal()"><i class="bi bi-plus-lg"></i> Nuevo</button></div>
    </div>
    <div class="table-responsive">
      <table class="table table-hover mb-0">
        <thead><tr><th>ID</th><th>Nombre</th><th>Cliente</th><th>Ciudad</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${proyectos.map(p => `<tr>
            <td><code style="font-size:.75rem">${p.id}</code></td>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.cliente||'—'}</td>
            <td>${p.ciudad||'—'}</td>
            <td><span class="badge ${p.estado==='Activo'?'bg-success':'bg-secondary'}">${p.estado}</span></td>
            <td>
              <div class="action-btns">
                <button class="btn-action edit" onclick="openProyectoModal('${p.id}','${p.nombre}','${p.cliente||''}','${p.ciudad||''}','${p.estado}')"><i class="bi bi-pencil"></i></button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function openProyectoModal(id='',nombre='',cliente='',ciudad='',estado='Activo') {
  const ciudades = (App.cache.listas['Ciudad']||[]).map(l => `<option ${ciudad===l.valor?'selected':''}>${l.valor}</option>`).join('');
  document.getElementById('proyModalTitle').textContent = id ? 'Editar Proyecto' : 'Nuevo Proyecto';
  document.getElementById('proyModalBody').innerHTML = `
  <form id="proyForm">
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-control" name="nombre" value="${nombre}" required></div>
      <div class="col-md-6"><label class="form-label">Cliente</label>
        <input class="form-control" name="cliente" value="${cliente}"></div>
      <div class="col-md-6"><label class="form-label">Ciudad</label>
        <select class="form-select" name="ciudad"><option value="">Seleccione...</option>${ciudades}</select></div>
      <div class="col-md-6"><label class="form-label">Estado</label>
        <select class="form-select" name="estado">
          <option ${estado==='Activo'?'selected':''}>Activo</option>
          <option ${estado==='Inactivo'?'selected':''}>Inactivo</option>
        </select></div>
    </div>
  </form>`;
  document.getElementById('btnGuardarProy').onclick = async () => {
    const form = document.getElementById('proyForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = {}; new FormData(form).forEach((v,k) => { fd[k] = v; });
    showLoading();
    try {
      await API.call({ action: 'saveProyecto', id, ...fd, usuario: App.user.email });
      toast('success', id ? 'Proyecto actualizado' : 'Proyecto creado');
      bootstrap.Modal.getInstance(document.getElementById('proyModal')).hide();
      await renderProyectosConfig(document.getElementById('content'));
    } catch(e) { toast('error', e.message); }
    finally { hideLoading(); }
  };
  bootstrap.Modal.getOrCreateInstance(document.getElementById('proyModal')).show();
}

// ============================================================
// LISTAS CONFIG
// ============================================================
async function renderListasConfig(el) {
  showLoading();
  const listas = await API.call({ action: 'getAllListas' }).finally(hideLoading);
  const tipos  = [...new Set(listas.map(l => l.tipo))].sort();

  el.innerHTML = `
  <div class="fade-in">
    <div class="row g-3">
      <div class="col-md-3">
        <div class="card-panel">
          <div class="card-panel-header"><h6>Categorías</h6></div>
          <div class="card-panel-body p-0">
            <div id="listaTipos">
              ${tipos.map(t => `<div class="sidebar-item" onclick="mostrarLista('${t}',this)" data-tipo="${t}">
                <i class="bi bi-list-ul si-icon"></i>
                <span class="si-text">${t}</span>
              </div>`).join('')}
            </div>
            <div class="p-3">
              <button class="btn-primary-custom w-100" onclick="openNuevaTipo()"><i class="bi bi-plus-lg"></i> Nueva Categoría</button>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-9">
        <div class="card-panel" id="listEditor">
          <div class="card-panel-header"><h6>Seleccione una categoría</h6></div>
          <div class="card-panel-body">
            <div class="empty-state"><div class="es-icon">👈</div><p>Seleccione una categoría para ver sus valores</p></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  App._allListas = listas;
}

function mostrarLista(tipo, clickedEl) {
  document.querySelectorAll('#listaTipos .sidebar-item').forEach(el => el.classList.remove('active'));
  clickedEl.classList.add('active');
  const items = (App._allListas||[]).filter(l => l.tipo === tipo);
  const editor = document.getElementById('listEditor');
  editor.innerHTML = `
  <div class="card-panel-header">
    <h6>${tipo}</h6>
    <button class="btn-primary-custom ms-auto" onclick="openListaModal(null,'${tipo}')"><i class="bi bi-plus-lg"></i> Agregar</button>
  </div>
  <div class="card-panel-body p-0">
    ${items.map(l => `
    <div class="list-editor-item">
      <div class="lei-val"><strong>${l.valor}</strong></div>
      <span class="badge ${l.estado==='Activo'?'bg-success':'bg-secondary'} ms-2">${l.estado}</span>
      <div class="action-btns ms-auto">
        <button class="btn-action edit" onclick="openListaModal('${l.id}','${tipo}','${l.valor}','${l.estado}')"><i class="bi bi-pencil"></i></button>
        <button class="btn-action del" onclick="toggleLista('${l.id}','${l.tipo}','${l.valor}','${l.estado}')">
          <i class="bi bi-${l.estado==='Activo'?'eye-slash':'eye'}"></i></button>
      </div>
    </div>`).join('')}
    ${!items.length ? '<div class="p-4 text-center text-muted">Sin valores configurados</div>' : ''}
  </div>`;
}

function openListaModal(id, tipo, valor='', estado='Activo') {
  const modal = document.getElementById('listaModal');
  document.getElementById('listaModalTitle').textContent = id ? 'Editar Valor' : 'Nuevo Valor — '+tipo;
  document.getElementById('listaModalBody').innerHTML = `
  <form id="listaForm">
    <div class="mb-3"><label class="form-label">Valor <span class="required">*</span></label>
      <input class="form-control" name="valor" value="${valor}" required></div>
    ${id ? `<div class="mb-3"><label class="form-label">Estado</label>
      <select class="form-select" name="estado">
        <option ${estado==='Activo'?'selected':''}>Activo</option>
        <option ${estado==='Inactivo'?'selected':''}>Inactivo</option>
      </select></div>` : ''}
  </form>`;
  document.getElementById('btnGuardarLista').onclick = async () => {
    const form = document.getElementById('listaForm');
    const fd = {}; new FormData(form).forEach((v,k)=>{fd[k]=v;});
    showLoading();
    try {
      await API.call({ action: 'saveLista', id, tipo, ...fd });
      toast('success', id ? 'Valor actualizado' : 'Valor agregado');
      bootstrap.Modal.getInstance(modal).hide();
      const el = document.querySelector(`#listaTipos .sidebar-item[data-tipo="${tipo}"]`);
      if (el) { const r = await API.call({ action:'getAllListas' }); App._allListas=r; mostrarLista(tipo,el); }
    } catch(e) { toast('error',e.message); }
    finally { hideLoading(); }
  };
  bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function toggleLista(id, tipo, valor, estadoActual) {
  const nuevoEstado = estadoActual === 'Activo' ? 'Inactivo' : 'Activo';
  showLoading();
  try {
    await API.call({ action:'saveLista', id, tipo, valor, estado: nuevoEstado });
    toast('success', `Valor ${nuevoEstado.toLowerCase()}`);
    const listas = await API.call({ action:'getAllListas' });
    App._allListas = listas;
    const el = document.querySelector(`#listaTipos .sidebar-item[data-tipo="${tipo}"]`);
    if (el) mostrarLista(tipo, el);
  } catch(e) { toast('error',e.message); }
  finally { hideLoading(); }
}

function openNuevaTipo() {
  const tipo = prompt('Nombre de la nueva categoría:');
  if (!tipo?.trim()) return;
  openListaModal(null, tipo.trim());
}

// ============================================================
// SLA CONFIG
// ============================================================
async function renderSLA(el) {
  showLoading();
  const slaList = await API.call({ action: 'getSLA' }).finally(hideLoading);

  el.innerHTML = `
  <div class="fade-in">
    <div class="card-panel mb-3">
      <div class="card-panel-header"><i class="bi bi-alarm me-2 text-danger"></i><h6>Configuración SLA</h6></div>
      <div class="card-panel-body">
        <p class="text-muted mb-3">Configure los tiempos máximos de atención por tipo de gestión. Cuando se supere el SLA, se enviará alerta por correo.</p>
        <div class="table-responsive">
          <table class="table mb-0">
            <thead><tr><th>Tipo de Gestión</th><th>Horas Máximas</th><th>Email de Alerta</th><th>Acción</th></tr></thead>
            <tbody>
              ${slaList.map(s => `<tr>
                <td><strong>${s.tipoGestion}</strong></td>
                <td>
                  <input type="number" class="form-control form-control-sm" style="width:100px" value="${s.horasMaximas}" id="slaH_${s.tipoGestion}">
                </td>
                <td>
                  <input type="email" class="form-control form-control-sm" value="${s.alertaEmail||''}" id="slaE_${s.tipoGestion}" placeholder="email@ejemplo.com">
                </td>
                <td>
                  <button class="btn btn-sm btn-danger" onclick="guardarSLA('${s.tipoGestion}')">Guardar</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card-panel">
      <div class="card-panel-header"><i class="bi bi-bell me-2 text-warning"></i><h6>Verificar SLA Ahora</h6></div>
      <div class="card-panel-body">
        <p class="text-muted">Verifica manualmente si existen solicitudes vencidas y envía alertas.</p>
        <button class="btn-primary-custom" onclick="verificarSLA()"><i class="bi bi-search me-1"></i>Verificar SLA</button>
        <div id="slaResult" class="mt-3"></div>
      </div>
    </div>
  </div>`;
}

async function guardarSLA(tipo) {
  const hEl = document.getElementById('slaH_'+tipo);
  const eEl = document.getElementById('slaE_'+tipo);
  if (!hEl) return;
  showLoading();
  try {
    await API.call({ action:'saveSLA', tipoGestion: tipo, horasMaximas: parseInt(hEl.value)||24, alertaEmail: eEl?.value||'' });
    toast('success', 'SLA actualizado para '+tipo);
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

async function verificarSLA() {
  showLoading();
  try {
    const alerts = await API.call({ action: 'checkSLAAlerts' });
    const el = document.getElementById('slaResult');
    if (!alerts.length) {
      el.innerHTML = '<div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>No hay solicitudes vencidas.</div>';
    } else {
      el.innerHTML = `<div class="alert alert-danger">
        <strong>${alerts.length} solicitud(es) vencida(s):</strong><br>
        ${alerts.map(a => `• [${a.modulo}] ${a.id} — Coordinador: ${a.coordinador} — ${a.hrs}h / ${a.slaH}h`).join('<br>')}
      </div>`;
    }
  } catch(e) { toast('error', e.message); }
  finally { hideLoading(); }
}

// ============================================================
// PREGUNTAS PERSONALIZADAS CONFIG
// ============================================================
async function renderPreguntasConfig(el) {
  showLoading();
  const preguntas = await API.call({ action: 'getPreguntas', modulo: '' }).finally(hideLoading);
  App._preguntas = preguntas;

  // Limpiar caché de preguntas para forzar recarga en los formularios
  App.cache.preguntas = {};

  // Agrupar por módulo
  const grupos = {};
  preguntas.forEach(p => {
    const mod = p.modulo || 'Todos';
    if (!grupos[mod]) grupos[mod] = [];
    grupos[mod].push(p);
  });

  const modulosOrden = ['Todos', ...Object.keys(MODULOS)];
  const gruposHTML = modulosOrden.map(mod => {
    const items = grupos[mod] || [];
    const modLabel = MODULOS[mod] ? MODULOS[mod].label : mod;
    return `
    <div class="card-panel mb-3">
      <div class="card-panel-header" style="background:linear-gradient(135deg,var(--primary),var(--accent))">
        <i class="bi bi-file-earmark-text text-white me-2"></i>
        <h6 class="text-white mb-0">${modLabel}</h6>
        <button class="btn-primary-custom ms-auto" style="padding:5px 14px;font-size:.8rem"
          onclick="openPreguntaModal(null,'${mod}')">
          <i class="bi bi-plus-lg"></i> Agregar campo
        </button>
      </div>
      <div class="card-panel-body p-0">
        ${items.length ? `
        <table class="table table-hover mb-0">
          <thead><tr>
            <th>Etiqueta</th><th>Nombre campo</th><th>Tipo</th><th>Opciones</th><th>Obligatorio</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            ${items.map(p => `<tr>
              <td><strong>${p.label}</strong></td>
              <td><code style="font-size:.75rem">${p.name||p.id}</code></td>
              <td><span class="badge bg-primary">${p.tipo}</span></td>
              <td><small class="text-muted">${p.opciones||'—'}</small></td>
              <td><span class="badge ${p.requerido==='true'||p.requerido===true?'bg-danger':'bg-secondary'}">${(p.requerido==='true'||p.requerido===true)?'Sí':'No'}</span></td>
              <td>
                <div class="action-btns">
                  <button class="btn-action edit" onclick="editarPregunta('${p.id}')" title="Editar"><i class="bi bi-pencil"></i></button>
                  <button class="btn-action del" onclick="eliminarPregunta('${p.id}')" title="Eliminar"><i class="bi bi-trash"></i></button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<div class="text-center text-muted py-3" style="font-size:.85rem">
          <i class="bi bi-plus-circle me-1"></i>Sin campos personalizados — haz clic en "Agregar campo" para añadir uno
        </div>`}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div class="fade-in">
    <div class="alert alert-info py-2 mb-3" style="font-size:.85rem">
      <i class="bi bi-info-circle me-2"></i>
      Los campos que agregues aquí aparecerán en los formularios de cada módulo cuando el coordinador crea una solicitud.
    </div>
    ${gruposHTML}
  </div>`;
}

function editarPregunta(id) {
  const p = (App._preguntas || []).find(q => q.id === id);
  if (p) openPreguntaModal(p, p.modulo);
}

function openPreguntaModal(existente = null, moduloPresel = '') {
  const isEdit = !!existente;
  const p = existente || {};
  const modOpts = ['Todos', ...Object.keys(MODULOS)].map(m => {
    const sel = (p.modulo || moduloPresel) === m ? 'selected' : '';
    const label = MODULOS[m] ? MODULOS[m].label : m;
    return `<option value="${m}" ${sel}>${label}</option>`;
  }).join('');

  const tipoOpts = ['Texto','Texto largo','Número','Fecha','Hora','Lista desplegable','Selección múltiple','Sí/No'].map(t =>
    `<option ${p.tipo===t?'selected':''}>${t}</option>`
  ).join('');

  document.querySelector('#preModal .modal-title').textContent =
    isEdit ? `Editar campo — ${p.label}` : 'Nuevo campo personalizado';

  document.getElementById('preModalBody').innerHTML = `
  <form id="preForm">
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Módulo donde aparece <span class="text-danger">*</span></label>
        <select class="form-select" name="modulo" required>
          <option value="">Seleccione...</option>${modOpts}
        </select>
        <div class="form-text">Elige el formulario donde se mostrará este campo</div>
      </div>
      <div class="col-md-6">
        <label class="form-label">Etiqueta (texto visible) <span class="text-danger">*</span></label>
        <input class="form-control" name="label" value="${p.label||''}" required placeholder="Ej: Número de contrato">
      </div>
      <div class="col-md-6">
        <label class="form-label">Nombre interno del campo</label>
        <input class="form-control" name="name" value="${p.name||''}" placeholder="Ej: NumeroContrato (sin espacios)">
        <div class="form-text">Se usa para guardar el valor. Si se deja vacío se genera automáticamente.</div>
      </div>
      <div class="col-md-6">
        <label class="form-label">Tipo de campo <span class="text-danger">*</span></label>
        <select class="form-select" name="tipo" required id="tipoCampo" onchange="toggleOpcionesCampo(this.value)">
          ${tipoOpts}
        </select>
      </div>
      <div class="col-12" id="seccionOpciones" style="${['Lista desplegable','Selección múltiple'].includes(p.tipo)?'':'display:none'}">
        <label class="form-label">Opciones de la lista</label>
        <input class="form-control" name="opciones" value="${p.opciones||''}"
               placeholder="Opción 1, Opción 2, Opción 3 (separadas por coma)">
        <div class="form-text">Escribe las opciones separadas por coma</div>
      </div>
      <div class="col-12">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="chkReq" ${(p.requerido==='true'||p.requerido===true)?'checked':''}>
          <label class="form-check-label" for="chkReq"><strong>Campo obligatorio</strong> — el coordinador no podrá guardar sin llenarlo</label>
        </div>
      </div>
    </div>
  </form>`;

  document.getElementById('btnGuardarPre').onclick = async () => {
    const form = document.getElementById('preForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = {};
    new FormData(form).forEach((v, k) => { fd[k] = v; });
    fd.requerido = document.getElementById('chkReq')?.checked;
    if (isEdit) fd.id = p.id; // Preservar ID para edición
    // Auto-generar nombre si está vacío
    if (!fd.name) fd.name = 'campo_' + (fd.label||'x').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'').toLowerCase();
    showLoading();
    try {
      await API.call({ action: 'savePregunta', ...fd });
      toast('success', isEdit ? 'Campo actualizado' : 'Campo agregado al formulario');
      bootstrap.Modal.getInstance(document.getElementById('preModal')).hide();
      App.cache.preguntas = {}; // Limpiar caché
      await renderPreguntasConfig(document.getElementById('content'));
    } catch(e) { toast('error', e.message); }
    finally { hideLoading(); }
  };
  bootstrap.Modal.getOrCreateInstance(document.getElementById('preModal')).show();
}

function toggleOpcionesCampo(tipo) {
  const sec = document.getElementById('seccionOpciones');
  if (sec) sec.style.display = ['Lista desplegable','Selección múltiple'].includes(tipo) ? '' : 'none';
}

async function eliminarPregunta(id) {
  if (!confirm('¿Eliminar esta pregunta?')) return;
  showLoading();
  try {
    await API.call({ action: 'deletePregunta', id });
    toast('success', 'Pregunta eliminada');
    await renderPreguntasConfig(document.getElementById('content'));
  } catch(e) { toast('error',e.message); }
  finally { hideLoading(); }
}

// ============================================================
// CARGA DE ARCHIVOS
// ============================================================
App._pendingFiles = [];

function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    if (file.size > 10 * 1024 * 1024) { toast('warning', `${file.name} supera los 10 MB`); return; }
    App._pendingFiles.push(file);
    renderFileList();
  });
}

function renderFileList() {
  const el = document.getElementById('fileList');
  if (!el) return;
  el.innerHTML = App._pendingFiles.map((f,i) => `
  <div class="file-item">
    <i class="bi ${fileIcon(f.name)} text-danger me-1"></i>
    <span class="file-name">${f.name}</span>
    <span class="file-size">${(f.size/1024).toFixed(0)} KB</span>
    <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="removeFile(${i})"><i class="bi bi-x"></i></button>
  </div>`).join('');
}

function removeFile(i) { App._pendingFiles.splice(i,1); renderFileList(); }

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ext==='pdf' ? 'bi-file-pdf' : ['jpg','jpeg','png'].includes(ext) ? 'bi-file-image' : 'bi-file-earmark';
}

async function uploadFile(file, modulo, recordId) {
  return new Promise((resolve, reject) => {
    // Base64 infla ~33%; el POST a GAS admite archivos grandes, pero >10 MB
    // se vuelve lento. Cortamos aquí con un mensaje claro al usuario.
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error(`"${file.name}" supera el límite de 10 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const base64 = e.target.result.split(',')[1];
        const res = await API.call({ action:'uploadFile', base64Data:base64, fileName:file.name, mimeType:file.type, modulo, recordId, usuario:App.user.email });
        resolve(res);
      } catch(err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', e => {
    const zone = e.target.closest('.upload-zone');
    if (zone) { e.preventDefault(); zone.classList.add('dragover'); }
  });
  document.addEventListener('dragleave', e => {
    const zone = e.target.closest('.upload-zone');
    if (zone) zone.classList.remove('dragover');
  });
  document.addEventListener('drop', e => {
    const zone = e.target.closest('.upload-zone');
    if (zone) {
      e.preventDefault(); zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      files.forEach(f => { App._pendingFiles.push(f); });
      renderFileList();
    }
  });
});

// ============================================================
// MODAL GESTIÓN — Legalizador / Admin actualiza caso
// ============================================================
function openGestionModal(modulo, id) {
  const record = (App.cache.records[modulo] || []).find(r => r.ID === id);
  if (!record) return;

  document.getElementById('gestionModalTitle').textContent =
    `Gestionar caso — ${MODULOS[modulo]?.label || modulo}`;

  document.getElementById('gestionModalBody').innerHTML = `
  <div class="mb-3 p-3 bg-light rounded">
    <div class="row g-2 text-sm">
      <div class="col-6"><small class="text-muted">ID Caso</small><div class="fw-bold"><code>${record.ID}</code></div></div>
      <div class="col-6"><small class="text-muted">Colaborador</small><div class="fw-bold">${record.NombreColaborador || '—'}</div></div>
      <div class="col-6"><small class="text-muted">Coordinador</small><div>${record.Coordinador || '—'}</div></div>
      <div class="col-6"><small class="text-muted">Fecha</small><div>${record.Fecha || '—'}</div></div>
    </div>
  </div>
  <form id="gestionForm">
    <div class="mb-3">
      <label class="form-label fw-bold">ID del Servicio <span class="text-danger">*</span>
        <small class="text-muted fw-normal ms-1">(número o código asignado al caso)</small>
      </label>
      <input type="text" class="form-control" name="ID_Servicio"
             value="${record.ID_Servicio || ''}"
             placeholder="Ej: TKT-2025-001234" required>
    </div>
    <div class="mb-3">
      <label class="form-label fw-bold">Estado del caso <span class="text-danger">*</span></label>
      <select class="form-select" name="Estado" required>
        ${ESTADOS_GESTION.map(e =>
          `<option value="${e}" ${record.Estado === e ? 'selected' : ''}>${e}</option>`
        ).join('')}
      </select>
    </div>
    <div class="mb-3">
      <label class="form-label fw-bold">Descripción de gestión</label>
      <textarea class="form-control" name="DescripcionGestion" rows="4"
                placeholder="Detalle lo realizado, motivo de cancelación, novedades adicionales...">${record.DescripcionGestion || ''}</textarea>
    </div>
  </form>`;

  document.getElementById('btnGuardarGestion').onclick = () => guardarGestion(modulo, id);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('gestionModal')).show();
}

async function guardarGestion(modulo, id) {
  const form = document.getElementById('gestionForm');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const fd = {};
  new FormData(form).forEach((v, k) => { fd[k] = v; });

  // Si se marca Finalizado o Cancelado → registrar fecha de cierre
  if (fd.Estado === 'Finalizado' || fd.Estado === 'Cancelado') {
    fd.FechaCierre   = new Date().toISOString().split('T')[0];
    fd.UsuarioCierre = App.user.email;
  }

  showLoading();
  try {
    await API.call({
      action: 'updateRecord',
      modulo, id,
      data: fd,
      usuario: App.user.email,
    });
    toast('success', 'Caso actualizado correctamente');
    bootstrap.Modal.getInstance(document.getElementById('gestionModal')).hide();
    await loadModuloData(modulo);
    // Refrescar panel legalizador si está activo
    if (App.currentView === 'panel_legalizador') await renderPanelLegalizador(document.getElementById('content'));
  } catch(e) {
    toast('error', e.message);
  } finally {
    hideLoading();
  }
}

// ============================================================
// PANEL LEGALIZADOR — Vista consolidada de todos los casos
// ============================================================
async function renderPanelLegalizador(el) {
  if (!puedeVerTodos()) {
    el.innerHTML = '<div class="alert alert-warning">Acceso restringido.</div>';
    return;
  }

  el.innerHTML = `
  <div class="fade-in">
    <div class="table-wrapper">
      <div class="table-toolbar">
        <h6 class="mb-0"><i class="bi bi-kanban-fill me-2 text-danger"></i>Panel de Gestión de Casos</h6>
        <div class="filter-group ms-auto">
          <input id="plBusq"    type="text"   placeholder="Buscar..." style="width:160px">
          <select id="plModulo"><option value="">Todos los módulos</option>
            ${Object.entries(MODULOS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
          </select>
          <select id="plEstado"><option value="">Todos los estados</option>
            ${ESTADOS_GESTION.map(e=>`<option>${e}</option>`).join('')}
          </select>
          <button class="btn-outline-custom" onclick="exportarPanelLegalizador()">
            <i class="bi bi-download"></i> Exportar
          </button>
        </div>
      </div>
      <div id="plContent">
        <div class="d-flex justify-content-center py-5"><div class="loading-spinner"></div></div>
      </div>
    </div>
  </div>`;

  // Filtros reactivos
  ['plBusq','plModulo','plEstado'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => cargarPanelLegalizador());
    document.getElementById(id)?.addEventListener('change', () => cargarPanelLegalizador());
  });

  await cargarPanelLegalizador();
}

async function cargarPanelLegalizador() {
  const busq   = document.getElementById('plBusq')?.value    || '';
  const modFil = document.getElementById('plModulo')?.value  || '';
  const estFil = document.getElementById('plEstado')?.value  || '';

  showLoading();
  try {
    // Cargar todos los módulos en paralelo
    const modulosACargar = modFil ? [modFil] : Object.keys(MODULOS);
    const resultados = await Promise.all(
      modulosACargar.map(mod =>
        API.call({ action:'getRecords', modulo:mod, usuario:App.user.email, rol:App.user.rol, filtros:{} })
          .then(recs => recs.map(r => ({ ...r, _modulo: mod })))
          .catch(() => [])
      )
    );

    let todos = resultados.flat();

    // Filtros locales
    if (estFil) todos = todos.filter(r => r.Estado === estFil);
    if (busq) {
      const q = busq.toLowerCase();
      todos = todos.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }

    // Ordenar: Pendientes primero, luego por fecha descendente
    const orden = { 'Pendiente':0, 'En Proceso':1, 'Finalizado':2, 'Cancelado':3 };
    todos.sort((a,b) => (orden[a.Estado]||0) - (orden[b.Estado]||0) || (b.Fecha > a.Fecha ? 1 : -1));

    App._panelData = todos;

    const el = document.getElementById('plContent');
    if (!todos.length) {
      el.innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><h6>Sin casos</h6><p>No hay registros con los filtros aplicados</p></div>`;
      return;
    }

    el.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover mb-0">
        <thead><tr>
          <th>ID Caso</th><th>Módulo</th><th>Coordinador</th>
          <th>Colaborador</th><th>Documento</th><th>Fecha</th>
          <th>ID Servicio</th><th>Estado</th><th>Descripción Gestión</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          ${todos.map(r => `
          <tr class="${r.vencido ? 'row-vencido' : ''}">
            <td><code style="font-size:.73rem">${r.ID}</code></td>
            <td><span class="badge bg-secondary">${MODULOS[r._modulo]?.label || r._modulo}</span></td>
            <td>${r.Coordinador || '—'}</td>
            <td>${r.NombreColaborador || '—'}</td>
            <td>${r.Documento || '—'}</td>
            <td>${r.Fecha || '—'}</td>
            <td>
              ${r.ID_Servicio
                ? `<span class="badge bg-info text-dark">${r.ID_Servicio}</span>`
                : `<span class="text-muted" style="font-size:.8rem">Sin asignar</span>`}
            </td>
            <td>${estadoBadge(r.Estado)}</td>
            <td style="max-width:200px">
              <small class="text-muted">${r.DescripcionGestion
                ? (r.DescripcionGestion.length > 60 ? r.DescripcionGestion.substring(0,60)+'...' : r.DescripcionGestion)
                : '—'}</small>
            </td>
            <td>
              <div class="action-btns">
                <button class="btn-action view" onclick="verDetalle('${r._modulo}','${r.ID}')" title="Ver detalle">
                  <i class="bi bi-eye"></i>
                </button>
                <button class="btn-action edit" style="background:rgba(32,201,151,.15);color:#20c997"
                  onclick="openGestionModal('${r._modulo}','${r.ID}')" title="Gestionar caso">
                  <i class="bi bi-pencil-square"></i>
                </button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="p-3 text-muted" style="font-size:.8rem">
      ${todos.length} caso(s) |
      Pendientes: <strong>${todos.filter(r=>r.Estado==='Pendiente').length}</strong> |
      En Proceso: <strong>${todos.filter(r=>r.Estado==='En Proceso').length}</strong> |
      Finalizados: <strong>${todos.filter(r=>r.Estado==='Finalizado').length}</strong> |
      Cancelados: <strong>${todos.filter(r=>r.Estado==='Cancelado').length}</strong>
    </div>`;

    // Cachear registros del panel para que funcione verDetalle
    Object.keys(MODULOS).forEach(mod => {
      const del_mod = todos.filter(r => r._modulo === mod);
      if (del_mod.length) App.cache.records[mod] = [...(App.cache.records[mod]||[]), ...del_mod]
        .filter((r,i,a) => a.findIndex(x=>x.ID===r.ID)===i); // deduplicar
    });

  } catch(e) {
    document.getElementById('plContent').innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
  } finally {
    hideLoading();
  }
}

function exportarPanelLegalizador() {
  exportCSV(App._panelData || [], 'panel_casos');
}

// ============================================================
// EXPORTAR
// ============================================================
function exportarTabla(modulo) {
  const records = App.cache.records[modulo] || [];
  exportCSV(records, modulo);
}

function exportCSV(data, nombre) {
  if (!data.length) { toast('warning', 'Sin datos para exportar'); return; }
  const keys = Object.keys(data[0]).filter(k => !['horasTranscurridas','vencido','slaHoras','modulo'].includes(k));
  const csv  = [keys.join(','), ...data.map(r => keys.map(k => `"${String(r[k]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob(['﻿'+csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:`${nombre}_${Date.now()}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('success', 'Archivo exportado');
}

// ============================================================
// CHARTS (Chart.js)
// ============================================================
function destroyChart(id) { if (App.charts[id]) { App.charts[id].destroy(); delete App.charts[id]; } }

function renderBarChart(id, labels, values) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  App.charts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: '#e94560', borderRadius: 6, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#f0f2f5' }, ticks: { precision: 0 } },
      },
    },
  });
}

function renderDonutChart(id, labels, values) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  App.charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#ffc107','#0d6efd','#198754','#dc3545'], borderWidth: 0, hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } } },
      cutout: '65%',
    },
  });
}

function renderHBarChart(id, labels, values) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  App.charts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: '#0f3460', borderRadius: 4, borderSkipped: false }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#f0f2f5' }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ============================================================
// CONTROL DE ACCESO — Roles:
//   Administrador     : acceso total
//   Legalizador       : ve todos los casos, actualiza estado/ID servicio/descripción
//   Coordinador       : solo crea y ve SUS propios casos, no puede editar después de subir
// ============================================================
function esAdmin()       { return App.user?.rol === 'Administrador'; }
function esLegalizador() { return App.user?.rol === 'Legalizador'; }
function esCoordinador() { return App.user?.rol === 'Coordinador'; }

function puedeCrear() {
  // Todos los roles pueden crear solicitudes
  return !!App.user;
}
function puedeEditar(record) {
  if (!App.user) return false;
  // Admin puede editar todo
  if (esAdmin()) return true;
  // Legalizador puede actualizar estado/ID servicio en cualquier caso
  if (esLegalizador()) return true;
  // Coordinador NO puede editar después de subir (solo el admin puede autorizar)
  return false;
}
function puedeActualizarGestion(record) {
  // Solo Admin y Legalizador pueden actualizar estado, ID servicio, descripción
  return esAdmin() || esLegalizador();
}
function puedeEliminar() {
  return esAdmin();
}
function tieneAccesoAdmin() {
  return esAdmin();
}
function tieneAccesoConfig() {
  // Solo Administrador accede a configuración
  return esAdmin();
}
function puedeVerTodos() {
  // Coordinador solo ve sus propios registros
  return esAdmin() || esLegalizador();
}

// ============================================================
// UI HELPERS
// ============================================================
const UI = {
  setPageTitle(t) {
    const el = document.getElementById('pageTitle');
    if (el) el.textContent = t;
  },
};

let _loadingCount = 0;
function showLoading() {
  _loadingCount++;
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.className = 'loading-overlay';
    el.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">Cargando...</div>';
    document.body.appendChild(el);
  }
}
function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    const el = document.getElementById('loadingOverlay');
    if (el) el.remove();
  }
}

let _toastId = 0;
function toast(type, msg) {
  const icons = { success:'bi-check-circle-fill', error:'bi-x-circle-fill', warning:'bi-exclamation-triangle-fill', info:'bi-info-circle-fill' };
  const id    = 'toast_' + (++_toastId);
  let cont    = document.getElementById('toast-container');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'toast-container';
    document.body.appendChild(cont);
  }
  const el = document.createElement('div');
  el.id    = id;
  el.className = `toast-msg toast-${type}`;
  el.innerHTML = `<i class="bi ${icons[type]} toast-icon"></i><span>${msg}</span><i class="bi bi-x toast-close" onclick="document.getElementById('${id}').remove()"></i>`;
  cont.appendChild(el);
  setTimeout(() => { const e = document.getElementById(id); if (e) e.remove(); }, 4500);
}

// ============================================================
// BÚSQUEDA GLOBAL
// ============================================================
function setupGlobalSearch() {
  const input = document.getElementById('globalSearch');
  if (!input) return;
  input.addEventListener('keypress', async e => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      // Navigate to first module with search
      navigate('INASISTENCIAS');
      setTimeout(() => {
        const fBusq = document.getElementById('fBusq');
        if (fBusq) { fBusq.value = q; loadModuloData('INASISTENCIAS'); }
      }, 600);
    }
  });
}

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
function setupSidebarToggle() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar= document.getElementById('sidebar');
  const main   = document.getElementById('main-area');
  let collapsed= false;

  if (!toggle) return;
  toggle.addEventListener('click', () => {
    if (window.innerWidth <= 992) {
      sidebar.classList.toggle('mobile-open');
    } else {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
      main.classList.toggle('expanded', collapsed);
      toggle.style.left = collapsed ? '54px' : 'calc(var(--sidebar-w) - 16px)';
      toggle.innerHTML  = collapsed ? '<i class="bi bi-chevron-right"></i>' : '<i class="bi bi-chevron-left"></i>';
    }
  });
}

// ============================================================
// INIT
// ============================================================
async function init() {
  const loginScreen = document.getElementById('login-screen');
  const appScreen   = document.getElementById('app');

  // Event: login
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pwd   = document.getElementById('loginPassword').value;
    const btn   = document.getElementById('btnLogin');
    btn.disabled = true;
    btn.textContent = 'Ingresando...';
    try {
      const user = await API.call({ action: 'login', email, password: pwd });
      App.user   = user;
      loginScreen.style.display = 'none';
      appScreen.style.display   = '';
      await postLogin();
    } catch(e) {
      document.getElementById('loginError').textContent = e.message;
      document.getElementById('loginError').style.display = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });

  // Toggle password visibility
  document.getElementById('togglePassword')?.addEventListener('click', () => {
    const inp = document.getElementById('loginPassword');
    inp.type  = inp.type === 'password' ? 'text' : 'password';
  });
}

async function postLogin() {
  const user = App.user;

  // Render sidebar
  buildSidebar();

  // Ocultar botón de configuración del topbar para roles sin acceso
  document.querySelectorAll('#topbar .topbar-btn').forEach(btn => {
    const oc = btn.getAttribute('onclick') || '';
    if (oc.includes('configuracion') && !tieneAccesoConfig()) {
      btn.style.display = 'none';
    }
  });

  // Update user info
  document.getElementById('sidebarUserName').textContent = user.nombre;
  document.getElementById('sidebarUserRole').textContent = user.rol;
  document.getElementById('sidebarAvatar').textContent   = user.nombre.charAt(0).toUpperCase();

  setupSidebarToggle();
  setupGlobalSearch();

  // Load cache
  showLoading();
  try {
    [App.cache.proyectos, App.cache.listas['Ciudad'], App.cache.listas['Operacion'],
     App.cache.listas['Cargo'], App.cache.listas['TipoIncapacidad'], App.cache.listas['TipoDescuento'],
     App.cache.listas['TipoContrato']] = await Promise.all([
      API.call({ action: 'getProyectos', soloActivos: true }),
      API.call({ action: 'getListas', tipo: 'Ciudad' }),
      API.call({ action: 'getListas', tipo: 'Operacion' }),
      API.call({ action: 'getListas', tipo: 'Cargo' }),
      API.call({ action: 'getListas', tipo: 'TipoIncapacidad' }),
      API.call({ action: 'getListas', tipo: 'TipoDescuento' }),
      API.call({ action: 'getListas', tipo: 'TipoContrato' }),
    ]);
  } catch(e) { console.warn('Cache load partial:', e); }
  finally { hideLoading(); }

  // Check SLA alerts
  try {
    const alerts = await API.call({ action: 'checkSLAAlerts' });
    if (alerts.length) {
      App.cache.pendingAlerts = alerts.length;
      const badge = document.querySelector('.topbar-btn .notif-dot');
      if (badge) badge.title = `${alerts.length} alertas SLA`;
    }
  } catch(e) {}

  navigate('dashboard');
}

function buildSidebar() {
  const nav = document.getElementById('sidebarNav');

  // Items base — todos los roles
  const menuItems = [
    { section: 'Principal' },
    { view:'dashboard', icon:'bi-speedometer2', label:'Dashboard' },
    { section: 'Mis Solicitudes' },
    { view:'INASISTENCIAS',    icon:'bi-calendar-x',       label:'Inasistencias' },
    { view:'INCAPACIDADES',    icon:'bi-heart-pulse',      label:'Incapacidades' },
    { view:'CONTRATACIONES',   icon:'bi-person-plus',      label:'Contrataciones' },
    { view:'DESVINCULACIONES', icon:'bi-person-dash',      label:'Desvinculaciones' },
    { view:'PROCESOS',         icon:'bi-clipboard2-pulse', label:'Procesos' },
    { view:'OTROS_SI',         icon:'bi-file-earmark-text',label:'Otrosí' },
    { view:'DESCUENTOS',       icon:'bi-currency-dollar',  label:'Descuentos' },
    { view:'NOVEDADES_MASIVAS',icon:'bi-people',           label:'Nov. Masivas' },
  ];

  // Legalizador y Admin: panel de gestión de casos + historial
  if (puedeVerTodos()) {
    menuItems.push(
      { section: 'Gestión de Casos' },
      { view:'panel_legalizador', icon:'bi-kanban-fill', label:'Panel de Casos' },
      { view:'historial',         icon:'bi-clock-history', label:'Historial Colaborador' },
    );
  }

  // Solo Admin: configuración completa
  if (tieneAccesoConfig()) {
    menuItems.push(
      { section: 'Administración' },
      { view:'configuracion', icon:'bi-gear-fill',    label:'Configuración' },
      { view:'usuarios',      icon:'bi-people-fill',  label:'Usuarios' },
      { view:'auditoria',     icon:'bi-journal-text', label:'Auditoría' },
    );
  }

  nav.innerHTML = menuItems.map(item => {
    if (item.section) return `<div class="nav-section-title">${item.section}</div>`;
    return `<div class="sidebar-item" data-view="${item.view}" onclick="navigate('${item.view}')">
      <i class="bi ${item.icon} si-icon"></i>
      <span class="si-text">${item.label}</span>
    </div>`;
  }).join('');
}

// ============================================================
// BOOTSTRAP INIT
// ============================================================
document.addEventListener('DOMContentLoaded', init);
