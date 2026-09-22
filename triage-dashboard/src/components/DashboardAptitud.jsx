"use client";
import React, { useState, useEffect } from 'react';
import ValidacionAptitud from './ValidacionAptitud';

export default function DashboardAptitud() {
  const [colaEstudiantes, setColaEstudiantes] = useState([]);
  const [estudianteSeleccionado, setEstudianteSeleccionado] = useState(null);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://totem-backend-g6yh.onrender.com/ws/dashboard';
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('Conectado al WebSocket de Render:', wsUrl);
    };

    socket.onerror = (error) => {
      console.error('Error en WebSocket:', error);
    };

    socket.onmessage = (event) => {
      const nuevoEstudiante = JSON.parse(event.data);
      const estudianteConEstado = {
        ...nuevoEstudiante,
        idUnico: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        estado: 'pendiente'
      };
      setColaEstudiantes((prevCola) => [estudianteConEstado, ...prevCola]);
      setEstudianteSeleccionado((prev) => (prev ? prev : estudianteConEstado));
    };

    return () => socket.close();
  }, []);

  const handleValidarEstudiante = (idUnicoEstudiante, nivelConfirmado) => {
    setColaEstudiantes((prev) => 
      prev.map((est) => 
        est.idUnico === idUnicoEstudiante 
          ? { ...est, estado: 'validado', nivelFinal: nivelConfirmado } 
          : est
      )
    );
    setEstudianteSeleccionado((prev) => 
      prev && prev.idUnico === idUnicoEstudiante 
        ? { ...prev, estado: 'validado', nivelFinal: nivelConfirmado } 
        : prev
    );
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

  // --- NUEVA LÓGICA DE ORDENAMIENTO (Gravedad A1 -> A4) ---
  const obtenerPrioridad = (estudiante) => {
    const nivel = estudiante.nivelFinal || estudiante.iaSugerida;
    // Asignamos un número: 1 es más urgente (arriba), 4 es menos urgente (abajo)
    const prioridades = { 'A1': 1, 'A2': 2, 'A3': 3, 'A4': 4 };
    return prioridades[nivel] || 5; 
  };

  const colaOrdenada = [...colaEstudiantes].sort((a, b) => {
    // 1. Primero separamos por estado (Pendientes arriba, Validados abajo)
    const estadoA = a.estado === 'validado' ? 1 : 0;
    const estadoB = b.estado === 'validado' ? 1 : 0;
    
    if (estadoA !== estadoB) {
      return estadoA - estadoB;
    }
    
    // 2. Si tienen el mismo estado, los ordenamos por gravedad (1 al 5)
    return obtenerPrioridad(a) - obtenerPrioridad(b);
  });
  // --------------------------------------------------------

  const kpiPendientes = colaEstudiantes.filter(e => e.estado === 'pendiente').length;
  const kpiValidados = colaEstudiantes.filter(e => e.estado === 'validado').length;
  const kpiDerivados = colaEstudiantes.filter(e => e.nivelFinal === 'A1').length;
  const kpiAlertas = colaEstudiantes.filter(e => e.alerta && e.estado === 'pendiente').length;

  const countA = (nivel) => colaEstudiantes.filter(e => (e.nivelFinal || e.iaSugerida) === nivel).length;
  const totalGraph = Math.max(1, colaEstudiantes.length);

  return (
    <div className="min-h-screen bg-slate-100 p-6 flex flex-col font-sans">
      <div className="flex gap-4 mb-6">
        {[
          { l: 'POR VALIDAR', v: kpiPendientes, c: 'text-slate-800' },
          { l: 'VALIDADOS', v: kpiValidados, c: 'text-green-500' }, 
          { l: 'RIESGO ALTO (A1)', v: kpiDerivados, c: 'text-red-500' }, 
          { l: 'ALERTAS PENDIENTES', v: kpiAlertas, c: 'text-orange-500' }
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-lg p-4 shadow-sm flex-1 border border-slate-100">
            <span className="text-xs font-semibold text-slate-400 block mb-1">{kpi.l}</span>
            <span className={`text-2xl font-bold ${kpi.c}`}>{kpi.v}</span>
          </div>
        ))}
      </div>

      <main className="flex gap-6 h-[calc(100vh-160px)]">
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
                <span className="text-xs text-slate-400">{kpiPendientes} pendientes</span>
             </div>
             
             {colaOrdenada.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">Esperando evaluaciones desde el Tótem...</div>
             )}

             {colaOrdenada.map((estudiante) => {
               const esSeleccionado = estudianteSeleccionado?.idUnico === estudiante.idUnico;
               const nivelVisible = estudiante.nivelFinal || estudiante.iaSugerida;
               
               return (
                 <div key={estudiante.idUnico} onClick={() => setEstudianteSeleccionado(estudiante)} className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-100 transition-all ${esSeleccionado ? 'bg-slate-50 border-l-4 border-slate-400' : 'bg-white hover:bg-slate-50 border-l-4 border-transparent'} ${estudiante.estado === 'validado' ? 'opacity-50 grayscale-[50%]' : ''}`}>
                    <div className={`w-10 h-10 text-white font-bold rounded-lg flex items-center justify-center ${nivelVisible === 'A1' ? 'bg-red-500' : nivelVisible === 'A2' ? 'bg-orange-500' : nivelVisible === 'A3' ? 'bg-yellow-500' : 'bg-green-500'}`}>
                      {nivelVisible}
                    </div>
                    <div className="flex-1">
                       <div className="flex items-center gap-2">
                         <span className="font-bold text-slate-800 text-sm">{estudiante.nombre}</span>
                         {estudiante.estado === 'validado' ? (
                           <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex items-center gap-1">✓ VALIDADO</span>
                         ) : (
                           <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">SUGERIDA</span>
                         )}
                         {estudiante.alerta && estudiante.estado !== 'validado' && <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{estudiante.alerta}</span>}
                       </div>
                       <div className="text-xs text-slate-500 mt-0.5">{estudiante.objetivo} · {estudiante.carrera}</div>
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
                  <p className="text-sm text-slate-500 font-mono mt-1">{estudianteSeleccionado.id} · {estudianteSeleccionado.edad} años · {estudianteSeleccionado.carrera}</p>
                </div>
              </div>

              <div className={`${estudianteSeleccionado.iaSugerida === 'A2' ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200'} rounded-xl p-5 border mb-6`}>
                 <div className="flex justify-between items-center mb-3">
                   <span className={`text-xs font-bold uppercase tracking-wider ${estudianteSeleccionado.iaSugerida === 'A2' ? 'text-orange-800' : 'text-yellow-800'}`}>Clasificación Inicial IA</span>
                   <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                     CONFIANZA <div className={`w-16 h-1.5 rounded-full ${estudianteSeleccionado.iaSugerida === 'A2' ? 'bg-orange-500' : 'bg-red-500'}`}></div> 70%
                   </div>
                 </div>
                 <div className="flex items-center gap-3 mb-2">
                    <div className={`w-12 h-12 text-white font-bold text-xl rounded-xl flex items-center justify-center ${estudianteSeleccionado.iaSugerida === 'A2' ? 'bg-orange-500' : 'bg-yellow-500'}`}>
                      {estudianteSeleccionado.iaSugerida}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">{estudianteSeleccionado.iaSugerida === 'A2' ? 'Precaución' : 'Apto moderado'}</h3>
                      <p className="text-sm text-slate-600">Sugerencia previa a validación profesional</p>
                    </div>
                 </div>
                 {estudianteSeleccionado.alerta && estudianteSeleccionado.estado !== 'validado' && (
                   <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg flex gap-2 items-start mt-4">
                     <span className="font-bold">⚠</span>
                     <p>Confianza bajo el umbral: presenta síntoma(s) de riesgo. Derivar a evaluación profesional.</p>
                   </div>
                 )}
              </div>

              <div className="mb-6">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 block">Mediciones del tótem</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">PA</span><span className={`text-xl font-bold ${obtenerColorMetrica('presion', estudianteSeleccionado.mediciones?.presionSys, estudianteSeleccionado.mediciones?.presionDia)}`}>{estudianteSeleccionado.mediciones?.presionSys || '--'}/{estudianteSeleccionado.mediciones?.presionDia || '--'}</span> <span className="text-xs text-slate-400 ml-1">mmHg</span></div>
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">FC REPOSO</span><span className={`text-xl font-bold ${obtenerColorMetrica('fc', estudianteSeleccionado.mediciones?.fcReposo)}`}>{estudianteSeleccionado.mediciones?.fcReposo || '--'}</span> <span className="text-xs text-slate-400 ml-1">lpm</span></div>
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">FC RECUP.</span><span className="text-xl font-bold text-slate-800">{estudianteSeleccionado.mediciones?.fcRecup || '--'}</span> <span className="text-xs text-slate-400 ml-1">lpm</span></div>
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">IMC</span><span className={`text-xl font-bold ${obtenerColorMetrica('imc', estudianteSeleccionado.mediciones?.imc)}`}>{estudianteSeleccionado.mediciones?.imc || '--'}</span> <span className="text-xs text-slate-400 ml-1">kg/m²</span></div>
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">GRASA</span><span className="text-xl font-bold text-slate-800">{estudianteSeleccionado.mediciones?.grasa || '--'}</span> <span className="text-xs text-slate-400 ml-1">%</span></div>
                  <div className="border border-slate-200 p-3 rounded-lg bg-white"><span className="text-[10px] font-bold text-slate-400 block mb-1">VO₂ MÁX</span><span className="text-xl font-bold text-slate-800">{estudianteSeleccionado.mediciones?.vo2Max || '--'}</span> <span className="text-xs text-slate-400 ml-1">ml/kg</span></div>
                </div>
              </div>

              <div className="mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Cuestionario de Salud</span>
                <div className="flex flex-wrap gap-2">
                   {estudianteSeleccionado.salud?.sintomas?.map((sintoma, idx) => (<span key={idx} className="px-3 py-1 bg-red-50 text-red-600 border border-red-100 text-xs rounded-full font-medium">{sintoma}</span>))}
                   {estudianteSeleccionado.salud?.condiciones?.map((cond, idx) => (<span key={idx} className="px-3 py-1 bg-orange-50 text-orange-600 border border-orange-100 text-xs rounded-full font-medium">{cond}</span>))}
                   {(!estudianteSeleccionado.salud?.sintomas?.length && !estudianteSeleccionado.salud?.condiciones?.length) && <span className="text-sm text-slate-400">Sin condiciones reportadas</span>}
                </div>
              </div>
              
              <ValidacionAptitud 
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
  );
}