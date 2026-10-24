"use client";
import React, { useState, useEffect } from 'react';
import ValidacionAptitud from './ValidacionAptitud';
import TendenciaSocio from './TendenciaSocio';
import PanelLateral from './PanelLateral';
import TopNav from './TopNav';
import { ETIQUETA_SEVERIDAD, coincidenciaIA, nivelConfianza, nombreCategoria, porcentajeConfianza } from '../lib/ia';
import { hayCalibracionVencida, resumirDispositivos, resumirErrores } from '../lib/mediciones';
import { describirContacto, etiquetaDias, horaLocal } from '../lib/formato';
import { FILTROS, alertaPendiente, describirOrigen, duracionEvaluacion, estadoRevision, filtrarCola, filtrarCondicion, ordenarCola } from '../lib/cola';
import { IconoCorazon, IconoPulso, IconoGota, IconoBalanza, IconoRegla, IconoPersona, IconoPesa, IconoRayo, IconoReloj, IconoCheck, IconoAlerta, IconoCampana, IconoDiana } from './iconos';

const CONDICIONES = [
  { id: 'todas', label: 'Todos' },
  { id: 'buenas', label: 'Buenas' },
  { id: 'observacion', label: 'Con observación' },
];

export default function DashboardAptitud({ sesion, onSesionInvalida, onLogout, sinSeguridad = false, vista = 'dashboard', onNavegar, condicionInicial = 'todas' }) {
  const [condicion, setCondicion] = useState(condicionInicial);
  const [colaEstudiantes, setColaEstudiantes] = useState([]);
  const [estudianteSeleccionado, setEstudianteSeleccionado] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [orden, setOrden] = useState('riesgo');
  const [historial, setHistorial] = useState({ clave: null, datos: [] });
  const [errorAlerta, setErrorAlerta] = useState('');
  const [errorMediciones, setErrorMediciones] = useState('');

  // URL base del backend (NEXT_PUBLIC_BACKEND_URL; por defecto el publicado en Render)
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://totem-backend-g6yh.onrender.com';
  const WS_URL = BACKEND_URL.replace(/^http/, 'ws') + '/ws/dashboard';
  const authHeaders = sesion.token ? { Authorization: `Bearer ${sesion.token}` } : {};

  useEffect(() => {
    // 1. RECUPERAR HISTORIAL AL RECARGAR LA PÁGINA (Faltaba esto)
    fetch(`${BACKEND_URL}/api/evaluaciones`, { headers: authHeaders })
      .then(res => {
        if (res.status === 401) { onSesionInvalida(); throw new Error('sesión inválida'); }
        return res.json();
      })
      .then(data => {
        setColaEstudiantes(data);
        if (data.length > 0) setEstudianteSeleccionado(data[0]);
      })
      .catch(err => console.error("✗ Error cargando base de datos:", err));

    // 2. CONEXIÓN WEBSOCKET PARA TIEMPO REAL
    let activo = true;   // en desarrollo React monta dos veces: el primer socket se cierra antes de conectar y no es un error
    const socket = new WebSocket(WS_URL);

    // El token se envía en el primer mensaje; el servidor cierra la conexión si no es válido.
    socket.onopen = () => { if (sesion.token) socket.send(JSON.stringify({ token: sesion.token })); };
    socket.onclose = (ev) => { if (activo && ev.code === 4401) onSesionInvalida(); };
    socket.onerror = (error) => { if (activo) console.error('✗ Error en WebSocket:', error); };

    socket.onmessage = (event) => {
      try {
        console.log('Mensaje recibido vía WebSocket:', event.data);
        const nuevoEstudiante = JSON.parse(event.data);
        const estudianteConEstado = {
          ...nuevoEstudiante,
          idUnico: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          estado: 'pendiente'
        };
        setColaEstudiantes((prevCola) => [estudianteConEstado, ...prevCola]);
        setEstudianteSeleccionado((prev) => (prev ? prev : estudianteConEstado));
      } catch (err) {
        console.warn('El mensaje recibido no es un JSON válido:', event.data);
      }
    };

    return () => { activo = false; socket.close(); };
  }, []);

  // Evaluaciones anteriores del socio seleccionado, para ver su evolución.
  const rutSeleccionado = estudianteSeleccionado?.id;
  const idSeleccionado = estudianteSeleccionado?.idBaseDatos;
  useEffect(() => {
    if (!rutSeleccionado || !idSeleccionado) return undefined;
    let activo = true;
    fetch(`${BACKEND_URL}/api/socios/${encodeURIComponent(rutSeleccionado)}/evaluaciones`, { headers: authHeaders })
      .then((res) => {
        if (res.status === 401) { onSesionInvalida(); throw new Error('sesión inválida'); }
        return res.ok ? res.json() : null;
      })
      .then((datos) => { if (activo) setHistorial({ clave: idSeleccionado, datos }); })
      .catch(() => { if (activo) setHistorial({ clave: idSeleccionado, datos: null }); });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutSeleccionado, idSeleccionado]);
  const historialActual = historial.clave === idSeleccionado ? historial.datos : undefined;

  // 3. GUARDAR LA DECISIÓN DEL ENCARGADO (confirmar, ajustar o derivar)
  // La UI se actualiza con lo que el servidor confirmó (no de forma optimista): así nunca muestra un caso
  // como cerrado si no quedó guardado.
  const aplicarEvaluacion = (idUnico, evaluacion) => {
    const combinar = (est) => ({ ...est, ...evaluacion, idUnico: est.idUnico });
    setColaEstudiantes((prev) => prev.map((est) => (est.idUnico === idUnico ? combinar(est) : est)));
    setEstudianteSeleccionado((prev) => (prev && prev.idUnico === idUnico ? combinar(prev) : prev));
  };

  const mensajeError = (data) => (typeof data?.detail === 'string' ? data.detail : 'Revisa los datos ingresados.');

  const enviarAccion = async (idUnico, ruta, metodo, cuerpo) => {
    const est = colaEstudiantes.find((e) => e.idUnico === idUnico);
    if (!est?.idBaseDatos) return { ok: false, error: 'La evaluación aún no está guardada en el servidor.' };
    try {
      const res = await fetch(`${BACKEND_URL}/api/evaluaciones/${est.idBaseDatos}${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
      if (res.status === 401) { onSesionInvalida(); return { ok: false, error: 'Tu sesión expiró.' }; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: mensajeError(data) };
      aplicarEvaluacion(idUnico, data.evaluacion);
      return { ok: true };
    } catch {
      return { ok: false, error: 'No se pudo comunicar con el servidor.' };
    }
  };

  const handleValidarEstudiante = (idUnico, nivelFinal, extra = {}) =>
    enviarAccion(idUnico, '', 'PUT', { nivel_final: nivelFinal, ...extra });

  // El encargado confirma (o retira la confirmación de) las mediciones capturadas por el tótem.
  const handleValidarMediciones = async (idUnico, validado) => {
    setErrorMediciones('');
    const resultado = await enviarAccion(idUnico, '/mediciones/validar', 'POST', { validado });
    if (!resultado.ok) setErrorMediciones(resultado.error);
  };

  const handleRevisarAlerta = async (idUnico) => {
    setErrorAlerta('');
    const resultado = await enviarAccion(idUnico, '/alerta/revisar', 'POST');
    if (!resultado.ok) setErrorAlerta(resultado.error);
  };

  const obtenerColorMetrica = (tipo, valor1, valor2 = 0) => {
    if (!valor1 || valor1 === '--') return 'text-slate-800';
    const v1 = parseFloat(valor1);
    const v2 = parseFloat(valor2);
    let esAnormal = false;
    switch(tipo) {
      case 'presion': esAnormal = v1 >= 130 || v1 < 90 || v2 >= 85 || v2 < 60; break;
      case 'fc': esAnormal = v1 > 100 || v1 < 60; break;
      case 'imc': esAnormal = v1 >= 25.0 || v1 < 18.5; break;
    }
    return esAnormal ? 'text-red-600' : 'text-slate-800';
  };

  // R.123 y R.135: orden por riesgo o fecha, y filtro por estado de revisión.
  const colaOrdenada = filtrarCondicion(filtrarCola(ordenarCola(colaEstudiantes, orden), filtro), condicion);
  const med = estudianteSeleccionado?.mediciones || {};

  const kpiPendientes = colaEstudiantes.filter(e => estadoRevision(e) === 'pendiente').length;
  const kpiValidados = colaEstudiantes.filter(e => estadoRevision(e) !== 'pendiente').length;
  const kpiDerivados = colaEstudiantes.filter(e => e.nivelFinal === 'A1').length;
  const kpiAlertas = colaEstudiantes.filter(alertaPendiente).length;
  const coincidencia = coincidenciaIA(colaEstudiantes);
  const contarFiltro = (id) => filtrarCola(colaEstudiantes, id).length;

  const countA = (nivel) => colaEstudiantes.filter(e => (e.nivelFinal || e.iaSugerida) === nivel).length;
  const totalGraph = Math.max(1, colaEstudiantes.length);

  return (
    <div className="min-h-screen bg-[var(--background)] font-sans">
      <TopNav vista={vista} onNavegar={onNavegar} sinSeguridad={sinSeguridad}>
        {!sinSeguridad && (
          <PanelLateral sesion={sesion} backendUrl={BACKEND_URL} authHeaders={authHeaders}
                        evaluaciones={colaEstudiantes}
                        onSesionInvalida={onSesionInvalida} onLogout={onLogout} />
        )}
      </TopNav>
      <div className="p-6 flex flex-col">
      {sinSeguridad && (
        <div role="alert" className="mb-4 font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 text-sm">
          Seguridad desactivada: cualquiera con la URL del backend puede ver y modificar estos datos.
        </div>
      )}
      <div className="flex gap-4 mb-6">
        {[
          { l: 'POR VALIDAR', v: kpiPendientes, c: 'text-slate-800', icon: <IconoReloj className="w-4 h-4" />, chip: 'bg-slate-100 text-slate-500' },
          { l: 'VALIDADOS', v: kpiValidados, c: 'text-green-500', icon: <IconoCheck className="w-4 h-4" />, chip: 'bg-green-50 text-green-600' },
          { l: 'RIESGO ALTO (A1)', v: kpiDerivados, c: 'text-red-500', icon: <IconoAlerta className="w-4 h-4" />, chip: 'bg-red-50 text-red-500' },
          { l: 'ALERTAS PENDIENTES', v: kpiAlertas, c: 'text-orange-500', icon: <IconoCampana className="w-4 h-4" />, chip: 'bg-orange-50 text-orange-500' },
          { l: 'COINCIDENCIA IA', v: coincidencia.porcentaje === null ? '--' : `${coincidencia.porcentaje}%`, c: 'text-slate-800',
            s: `${coincidencia.coinciden} de ${coincidencia.total} casos cerrados`, icon: <IconoDiana className="w-4 h-4" />, chip: 'bg-duoc-50 text-duoc-700' }
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm flex-1 border border-slate-100">
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg align-middle mr-2 ${kpi.chip}`}>{kpi.icon}</span>
            <span className="text-xs font-semibold text-slate-400 align-middle">{kpi.l}</span>
            <span className={`block text-2xl font-bold mt-2 ${kpi.c}`}>{kpi.v}</span>
            {kpi.s && <span className="text-[10px] text-slate-400 block">{kpi.s}</span>}
          </div>
        ))}
      </div>

      <main className="flex gap-6 h-[calc(100vh-210px)]">
        <section className="w-[450px] flex flex-col gap-6">
          <div className="bg-white rounded-xl shadow-sm p-5 border border-slate-100">
            <h2 className="text-sm font-bold mb-4 text-slate-800">Distribución de aptitud</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3"><span className="w-24 text-slate-600">A1 - Riesgo alto</span><div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-red-500 h-full transition-all duration-500" style={{width: `${(countA('A1')/totalGraph)*100}%`}}></div></div><span className="text-slate-400 w-4 text-right">{countA('A1')}</span></div>
              <div className="flex items-center gap-3"><span className="w-24 text-slate-600">A2 - Precaución</span><div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-orange-500 h-full transition-all duration-500" style={{width: `${(countA('A2')/totalGraph)*100}%`}}></div></div><span className="text-slate-400 w-4 text-right">{countA('A2')}</span></div>
              <div className="flex items-center gap-3"><span className="w-24 text-slate-600">A3 - Apto mod.</span><div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-yellow-500 h-full transition-all duration-500" style={{width: `${(countA('A3')/totalGraph)*100}%`}}></div></div><span className="text-slate-400 w-4 text-right">{countA('A3')}</span></div>
              <div className="flex items-center gap-3"><span className="w-24 text-slate-600">A4 - Apto</span><div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-green-500 h-full transition-all duration-500" style={{width: `${(countA('A4')/totalGraph)*100}%`}}></div></div><span className="text-slate-400 w-4 text-right">{countA('A4')}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-0 border border-slate-100 flex-1 overflow-y-auto">
             <div className="p-4 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/95 backdrop-blur z-10">
                <h2 className="text-sm font-bold text-slate-800">Cola de evaluación</h2>
                <label className="text-xs text-slate-400 flex items-center gap-1">
                  Ordenar por
                  <select value={orden} onChange={(e) => setOrden(e.target.value)} className="border border-slate-200 rounded px-1 py-0.5 text-slate-600">
                    <option value="riesgo">Riesgo</option>
                    <option value="reciente">Más reciente</option>
                  </select>
                </label>
             </div>
             <div role="tablist" aria-label="Filtrar por estado" className="px-4 py-2 flex gap-2 border-b border-slate-100 bg-white">
                {FILTROS.map((f) => (
                  <button key={f.id} role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${filtro === f.id ? 'bg-duoc-700 text-white border-duoc-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {f.label} ({contarFiltro(f.id)})
                  </button>
                ))}
             </div>
             <div aria-label="Filtrar por condición" className="px-4 py-2 flex items-center gap-2 border-b border-slate-100 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Condición</span>
                {CONDICIONES.map((c) => (
                  <button key={c.id} onClick={() => setCondicion(c.id)} aria-pressed={condicion === c.id}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${condicion === c.id ? 'bg-duoc-50 text-duoc-700 border-duoc-200' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {c.label}
                  </button>
                ))}
             </div>

             {colaOrdenada.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">
                  {colaEstudiantes.length === 0 ? 'Esperando evaluaciones desde el Tótem...' : 'No hay evaluaciones en este filtro.'}
                </div>
             )}

             {colaOrdenada.map((estudiante) => {
               const esSeleccionado = estudianteSeleccionado?.idUnico === estudiante.idUnico;
               const nivelVisible = estudiante.nivelFinal || estudiante.iaSugerida;
               
               return (
                 <div key={estudiante.idUnico} onClick={() => setEstudianteSeleccionado(estudiante)} className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-100 transition-all ${esSeleccionado ? 'bg-duoc-50 border-l-4 border-duoc-500' : 'bg-white hover:bg-slate-50 border-l-4 border-transparent'} ${estadoRevision(estudiante) !== 'pendiente' ? 'opacity-50 grayscale-[50%]' : ''}`}>
                    <div className={`w-10 h-10 text-white font-bold rounded-lg flex items-center justify-center ${nivelVisible === 'A1' ? 'bg-red-500' : nivelVisible === 'A2' ? 'bg-orange-500' : nivelVisible === 'A3' ? 'bg-yellow-500' : 'bg-green-500'}`}>
                      {nivelVisible}
                    </div>
                    <div className="flex-1">
                       <div className="flex items-center gap-2">
                         <span className="font-bold text-slate-800 text-sm">{estudiante.nombre}</span>
                         {estadoRevision(estudiante) === 'derivada' ? (
                           <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">DERIVADA</span>
                         ) : estadoRevision(estudiante) === 'revisada' ? (
                           <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex items-center gap-1">✓ VALIDADO</span>
                         ) : (
                           <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">SUGERIDA</span>
                         )}
                         {alertaPendiente(estudiante) && (estudiante.alertaNivel === 'critica'
                           ? <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">ALERTA CRÍTICA</span>
                           : <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{estudiante.alerta}</span>)}
                       </div>
                       <div className="text-xs text-slate-500 mt-0.5">{estudiante.objetivo} · {estudiante.planMembresia}</div>
                    </div>
                    <div className="text-right text-xs">
                       <div className="font-medium text-slate-700">{estudiante.id}</div>
                       <div className="text-slate-400">{estudiante.tiempoEspera}</div>
                    </div>
                 </div>
               )
             })}
          </div>
        </section>

        <section className="flex-1 bg-white rounded-xl shadow-sm p-8 border border-slate-100 overflow-y-auto relative">
          {estudianteSeleccionado ? (
            <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-800">{estudianteSeleccionado.nombre}</h1>
                  <p className="text-sm text-slate-500 font-mono mt-1">{estudianteSeleccionado.id} · {estudianteSeleccionado.edad} años · {estudianteSeleccionado.planMembresia}</p>
                  {describirContacto(estudianteSeleccionado) && <p className="text-xs text-slate-500 mt-1">{describirContacto(estudianteSeleccionado)}</p>}
                  {(describirOrigen(estudianteSeleccionado) || duracionEvaluacion(estudianteSeleccionado) !== null) && (
                    <p className="text-xs text-slate-400 mt-1">
                      {describirOrigen(estudianteSeleccionado)}
                      {duracionEvaluacion(estudianteSeleccionado) !== null && `${describirOrigen(estudianteSeleccionado) ? ' · ' : ''}Duración: ${duracionEvaluacion(estudianteSeleccionado)} min`}
                    </p>
                  )}
                </div>
              </div>

              <div className={`${estudianteSeleccionado.iaSugerida === 'A1' ? 'bg-red-50 border-red-200' : estudianteSeleccionado.iaSugerida === 'A2' ? 'bg-orange-50 border-orange-200' : estudianteSeleccionado.iaSugerida === 'A4' ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'} rounded-xl p-5 border mb-6`}>
                 <div className="flex justify-between items-center mb-3">
                   <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Clasificación Inicial IA</span>
                   <div className="flex items-center gap-2 text-xs font-bold text-slate-600" aria-label="Confianza de la sugerencia">
                     CONFIANZA
                     <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                       <div className={`h-full ${nivelConfianza(estudianteSeleccionado.confianza) === 'baja' ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${porcentajeConfianza(estudianteSeleccionado.confianza) ?? 0}%` }}></div>
                     </div>
                     {porcentajeConfianza(estudianteSeleccionado.confianza) === null ? 'N/D' : `${porcentajeConfianza(estudianteSeleccionado.confianza)}%`}
                   </div>
                 </div>
                 <div className="flex items-center gap-3 mb-2">
                    <div className={`w-12 h-12 text-white font-bold text-xl rounded-xl flex items-center justify-center ${estudianteSeleccionado.iaSugerida === 'A1' ? 'bg-red-500' : estudianteSeleccionado.iaSugerida === 'A2' ? 'bg-orange-500' : estudianteSeleccionado.iaSugerida === 'A4' ? 'bg-green-500' : 'bg-yellow-500'}`}>
                      {estudianteSeleccionado.iaSugerida}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">{nombreCategoria(estudianteSeleccionado.iaSugerida)}</h3>
                      <p className="text-sm text-slate-600">{estudianteSeleccionado.intensidad ? `Intensidad recomendada: ${estudianteSeleccionado.intensidad}` : 'Sugerencia previa a validación profesional'}</p>
                    </div>
                 </div>
                 {estudianteSeleccionado.requiereRevision && (
                   <div role="note" className="bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 rounded-lg mt-3">
                     <p className="font-bold">Requiere tu revisión</p>
                     <p>{estudianteSeleccionado.motivoRevision || 'La sugerencia tiene baja confianza.'}</p>
                   </div>
                 )}
                 {estudianteSeleccionado.alerta && (
                   <div role="region" aria-label="Alerta" className={`${estudianteSeleccionado.alertaNivel === 'critica' ? 'bg-red-100 border border-red-300 text-red-800' : 'bg-red-50 text-red-700'} text-sm p-3 rounded-lg mt-4`}>
                     <div className="flex items-center justify-between gap-3">
                       <p className="font-bold">
                         ⚠ {estudianteSeleccionado.alertaNivel === 'critica' ? 'Alerta CRÍTICA' : 'Alerta de riesgo'}
                         {estudianteSeleccionado.alertaRevisada ? ' · revisada' : ''}
                       </p>
                       {!estudianteSeleccionado.alertaRevisada && (
                         <button onClick={() => handleRevisarAlerta(estudianteSeleccionado.idUnico)} className="text-xs font-bold underline whitespace-nowrap">
                           Marcar alerta como revisada
                         </button>
                       )}
                     </div>
                     <p className="mt-1">Presenta condiciones que aconsejan derivar a evaluación profesional.</p>
                     {errorAlerta && <p role="alert" className="mt-2 text-xs">{errorAlerta}</p>}
                   </div>
                 )}
              </div>

              <div className="mb-6">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Factores considerados por la sugerencia</span>
                {estudianteSeleccionado.factores?.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm text-slate-700">
                    {estudianteSeleccionado.factores.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">No se detectaron factores de riesgo.</p>
                )}
                {estudianteSeleccionado.reglasAplicadas?.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs font-semibold text-slate-500 cursor-pointer">Reglas aplicadas ({estudianteSeleccionado.reglasAplicadas.length})</summary>
                    <ul className="mt-2 text-xs text-slate-600 space-y-1">
                      {estudianteSeleccionado.reglasAplicadas.map((r) => (
                        <li key={r.id + (r.descripcion || '')}><span className="font-mono">{r.id}</span> · {ETIQUETA_SEVERIDAD[r.severidad] || r.severidad}{r.valor !== null && r.valor !== undefined ? ` · valor ${r.valor}` : ''}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  {estudianteSeleccionado.versionModelo ? `Versión: ${estudianteSeleccionado.versionModelo}. ` : ''}Reglas provisionales, pendientes de revisión por un profesional.
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-3 gap-3">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Mediciones del tótem{estudianteSeleccionado.mediciones?.capturadoEn && horaLocal(estudianteSeleccionado.mediciones.capturadoEn) ? ` · capturadas a las ${horaLocal(estudianteSeleccionado.mediciones.capturadoEn)}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${estudianteSeleccionado.mediciones?.validado ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {estudianteSeleccionado.mediciones?.validado ? '✓ MEDICIONES VALIDADAS' : 'SIN VALIDAR'}
                    </span>
                    {estadoRevision(estudianteSeleccionado) === 'pendiente' && (
                      <button
                        onClick={() => handleValidarMediciones(estudianteSeleccionado.idUnico, !estudianteSeleccionado.mediciones?.validado)}
                        className="text-xs font-bold underline whitespace-nowrap text-slate-700"
                      >
                        {estudianteSeleccionado.mediciones?.validado ? 'Retirar validación' : 'Validar mediciones'}
                      </button>
                    )}
                  </div>
                </div>
                {errorMediciones && <p role="alert" className="mb-2 text-xs text-red-600">{errorMediciones}</p>}
                {resumirDispositivos(estudianteSeleccionado.mediciones?.dispositivos).length > 0 && (
                  <ul aria-label="Dispositivos de medición" className="mb-3 text-xs text-slate-500 space-y-0.5">
                    {resumirDispositivos(estudianteSeleccionado.mediciones?.dispositivos).map((d) => (
                      <li key={d.sensor}>
                        {d.etiqueta} · {d.id} · <span className={d.vencida ? 'font-bold text-red-600' : ''}>{d.calibracionTexto}</span>{d.hora ? ` · ${d.hora}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {hayCalibracionVencida(estudianteSeleccionado.mediciones?.dispositivos) && (
                  <p role="note" className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-900 p-2 rounded">
                    Hay dispositivos con la calibración vencida: sus mediciones pueden ser menos exactas y bajan la confianza de la sugerencia.
                  </p>
                )}
                {resumirErrores(estudianteSeleccionado.mediciones?.errores).length > 0 && (
                  <details className="mb-3">
                    <summary className="text-xs font-semibold text-slate-500 cursor-pointer">
                      Errores durante la medición ({resumirErrores(estudianteSeleccionado.mediciones?.errores).length})
                    </summary>
                    <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
                      {resumirErrores(estudianteSeleccionado.mediciones?.errores).map((e, i) => (
                        <li key={i}>{e.sensor}: {e.tipo}{e.mensaje ? ` — ${e.mensaje}` : ''}{e.hora ? ` (${e.hora})` : ''}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { et: 'PA', val: `${med.presionSys || '--'}/${med.presionDia || '--'}`, u: 'mmHg', color: obtenerColorMetrica('presion', med.presionSys, med.presionDia), icon: <IconoCorazon className="w-5 h-5" />, chip: 'bg-red-50 text-red-500' },
                    { et: 'FC REPOSO', val: med.fcReposo || '--', u: 'lpm', color: obtenerColorMetrica('fc', med.fcReposo), icon: <IconoPulso className="w-5 h-5" />, chip: 'bg-red-50 text-red-500' },
                    { et: 'FC RECUP.', val: med.fcRecup || '--', u: 'lpm', color: 'text-slate-800', icon: <IconoPulso className="w-5 h-5" />, chip: 'bg-red-50 text-red-500' },
                    { et: 'SpO₂', val: med.spo2 ?? '--', u: '%', color: med.spo2 != null && med.spo2 < 95 ? 'text-red-600' : 'text-slate-800', icon: <IconoGota className="w-5 h-5" />, chip: 'bg-sky-50 text-sky-500' },
                    { et: 'PESO', val: med.peso || '--', u: 'kg', color: 'text-slate-800', icon: <IconoBalanza className="w-5 h-5" />, chip: 'bg-duoc-50 text-duoc-700' },
                    { et: 'ESTATURA', val: med.estatura || '--', u: 'cm', color: 'text-slate-800', icon: <IconoRegla className="w-5 h-5" />, chip: 'bg-duoc-50 text-duoc-700' },
                    { et: 'IMC', val: med.imc || '--', u: 'kg/m²', color: obtenerColorMetrica('imc', med.imc), icon: <IconoPersona className="w-5 h-5" />, chip: 'bg-duoc-50 text-duoc-700' },
                    { et: 'GRASA', val: med.grasa || '--', u: '%', color: 'text-slate-800', icon: <IconoGota className="w-5 h-5" />, chip: 'bg-amber-50 text-amber-500' },
                    { et: 'MASA MUSCULAR', val: med.masaMuscular || '--', u: 'kg', color: 'text-slate-800', icon: <IconoPesa className="w-5 h-5" />, chip: 'bg-duoc-50 text-duoc-700' },
                    { et: 'VO₂ MÁX', val: med.vo2Max || '--', u: 'ml/kg', color: 'text-slate-800', icon: <IconoRayo className="w-5 h-5" />, chip: 'bg-green-50 text-green-600' },
                  ].map((x) => (
                    <div key={x.et} className="border border-slate-200 p-3 rounded-xl bg-white flex items-center gap-3">
                      <span className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${x.chip}`}>{x.icon}</span>
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-slate-400 block leading-tight">{x.et}</span>
                        <span className={`text-lg font-bold ${x.color}`}>{x.val}</span>
                        <span className="text-[11px] text-slate-400 ml-1">{x.u}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Cuestionario de Salud</span>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                  <div><dt className="text-[10px] font-bold text-slate-400 uppercase">Objetivo principal</dt><dd className="text-slate-800">{estudianteSeleccionado.entrenamiento?.objetivo || estudianteSeleccionado.objetivo || 'Sin indicar'}</dd></div>
                  <div><dt className="text-[10px] font-bold text-slate-400 uppercase">Nivel de experiencia</dt><dd className="text-slate-800">{estudianteSeleccionado.entrenamiento?.experiencia || 'Sin indicar'}</dd></div>
                  <div><dt className="text-[10px] font-bold text-slate-400 uppercase">Días disponibles por semana</dt><dd className="text-slate-800">{etiquetaDias(estudianteSeleccionado.entrenamiento?.diasSemana)}</dd></div>
                  <div><dt className="text-[10px] font-bold text-slate-400 uppercase">Antecedentes crónicos</dt><dd className="text-slate-800">{estudianteSeleccionado.salud?.antecedentesCronicos ? 'Sí' : 'No'}</dd></div>
                  <div className="col-span-2"><dt className="text-[10px] font-bold text-slate-400 uppercase">Lesiones previas</dt><dd className="text-slate-800">{estudianteSeleccionado.salud?.lesionesPrevias || 'Ninguna indicada'}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                   {estudianteSeleccionado.salud?.sintomas?.map((sintoma, idx) => (<span key={idx} className="px-3 py-1 bg-red-50 text-red-600 border border-red-100 text-xs rounded-full font-medium">{sintoma}</span>))}
                   {estudianteSeleccionado.salud?.condiciones?.map((cond, idx) => (<span key={idx} className="px-3 py-1 bg-orange-50 text-orange-600 border border-orange-100 text-xs rounded-full font-medium">{cond}</span>))}
                   {(!estudianteSeleccionado.salud?.sintomas?.length && !estudianteSeleccionado.salud?.condiciones?.length) && <span className="text-sm text-slate-400">Sin condiciones reportadas</span>}
                </div>
              </div>
              
              <div className="mt-6">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Evolución del socio</span>
                <TendenciaSocio estudiante={estudianteSeleccionado} historial={historialActual} />
              </div>

              <ValidacionAptitud
                 key={estudianteSeleccionado.idUnico}
                 estudiante={estudianteSeleccionado}
                 onValidar={handleValidarEstudiante}
              />
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
               <span className="text-4xl mb-4">📋</span>
               <p>Esperando que un estudiante termine su evaluación en el tótem.</p>
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}