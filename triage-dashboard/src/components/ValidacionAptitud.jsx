"use client";
import React, { useState, useEffect } from 'react';

export default function ValidacionAptitud({ estudiante, onValidar }) {
  const nivelSugeridoIA = estudiante?.iaSugerida || 'A3';
  const yaValidado = estudiante?.estado === 'validado';
  const nivelFinal = estudiante?.nivelFinal || nivelSugeridoIA;

  const [nivelSeleccionado, setNivelSeleccionado] = useState(nivelFinal);

  useEffect(() => {
    setNivelSeleccionado(estudiante?.nivelFinal || estudiante?.iaSugerida || 'A3');
  }, [estudiante]);

  if (!estudiante) return null;

  const niveles = [
    { id: 'A1', label: 'Riesgo', txt: 'text-red-600', borderActivo: 'border-red-600', bgActivo: 'bg-red-50' },
    { id: 'A2', label: 'Precaución', txt: 'text-orange-500', borderActivo: 'border-orange-500', bgActivo: 'bg-orange-50' },
    { id: 'A3', label: 'Apto mod.', txt: 'text-yellow-600', borderActivo: 'border-yellow-500', bgActivo: 'bg-yellow-50' },
    { id: 'A4', label: 'Apto', txt: 'text-green-600', borderActivo: 'border-green-600', bgActivo: 'bg-green-50' },
  ];

  const handleSeleccion = (id) => {
    if (yaValidado) return; 
    setNivelSeleccionado(id);
  };

  const difiere = nivelSeleccionado !== nivelSugeridoIA;
  const getLabel = (id) => niveles.find(n => n.id === id)?.label;

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <div className="flex justify-between items-end mb-4">
        <h3 className="font-bold text-slate-800">Validar aptitud</h3>
        <span className="text-sm text-slate-400 font-medium">
          {yaValidado ? '🔒 Clasificación cerrada' : 'Confirma o ajusta la clasificación IA'}
        </span>
      </div>

      <div className="flex gap-3">
        {niveles.map((nivel) => {
          const activo = nivelSeleccionado === nivel.id;
          let clasesBoton = "flex-1 flex flex-col items-center justify-center py-3 rounded-xl border-2 transition-all duration-200 ";
          
          if (yaValidado) {
            clasesBoton += activo ? `${nivel.borderActivo} ${nivel.bgActivo} opacity-100` : `border-slate-100 bg-slate-50 opacity-40 cursor-not-allowed`;
          } else {
            clasesBoton += activo ? `${nivel.borderActivo} ${nivel.bgActivo}` : `bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50 cursor-pointer`;
          }

          return (
             <button key={nivel.id} onClick={() => handleSeleccion(nivel.id)} disabled={yaValidado} className={clasesBoton}>
              <span className={`text-xl font-bold ${activo ? nivel.txt : 'text-slate-400'}`}>{nivel.id}</span>
              <span className={`text-xs font-semibold mt-1 ${activo ? 'text-slate-700' : 'text-slate-400'}`}>{nivel.label}</span>
            </button>
          );
        })}
      </div>

      {yaValidado ? (
        <div className="mt-5 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 animate-fade-in-up">
           <span className="text-green-600 text-xl">✅</span>
           <div>
             <p className="text-sm font-bold text-green-800">Evaluación completada</p>
             <p className="text-xs text-green-700">El estudiante fue clasificado y su registro fue guardado.</p>
           </div>
        </div>
      ) : (
        <div className="mt-5 animate-fade-in-up">
          {difiere && (
            <div className="bg-orange-50 rounded-xl p-4 border-l-4 border-orange-500 mb-4">
              <p className="text-sm text-slate-700">Modificaste la aptitud a <strong className="text-orange-600">{getLabel(nivelSeleccionado)}</strong> (IA sugirió {getLabel(nivelSugeridoIA)}).</p>
            </div>
          )}
          <button 
            // AQUÍ ESTÁ EL CAMBIO: Usamos el idUnico en lugar de la matrícula
            onClick={() => onValidar(estudiante.idUnico, nivelSeleccionado)}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm"
          >
            {difiere ? 'Confirmar cambio y cerrar caso' : 'Confirmar sugerencia IA y cerrar caso'}
          </button>
        </div>
      )}
    </div>
  );
}